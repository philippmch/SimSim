import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../simulation/config'
import {
  deriveLivePulse,
  formatLivePulse,
  LIVE_PULSE_COUNTER_KEYS,
  type LivePulseCreature,
  type LivePulseSummary,
  type LivePulseWorld,
} from './LivePulse'

const creature = (individualId: number, overrides: Partial<LivePulseCreature> = {}): LivePulseCreature => ({
  individualId,
  alive: true,
  home: false,
  mode: 'exploring',
  deathCause: null,
  ...overrides,
})

const world = (overrides: Partial<LivePulseWorld> = {}): LivePulseWorld => ({
  generation: 1,
  dayTime: 0,
  tickIndex: 0,
  config: { ...defaultConfig },
  creatures: [],
  dayFoodProduced: 0,
  dayFoodRemoved: 0,
  dayFoodConsumed: 0,
  dayPreyConsumed: 0,
  dayAttackAttempts: 0,
  dayAttackSuccesses: 0,
  dayAttackFailures: 0,
  dayAttackContested: 0,
  ...overrides,
})

describe('live pulse derivation', () => {
  it('starts with a clear baseline message', () => {
    const summary = deriveLivePulse(null, world())

    expect(summary.status).toBe('baseline')
    expect(formatLivePulse(summary)).toBe('Waiting for the next simulation update.')
    expect(summary.counterDeltas.dayFoodConsumed).toBeNull()
  })

  it('resets to a baseline when primitive configuration changes', () => {
    const previous = world({ dayTime: .25, tickIndex: 10 })
    const current = world({ dayTime: .1, tickIndex: 4, config: { ...defaultConfig, dayLength: defaultConfig.dayLength + 1 } })

    expect(deriveLivePulse(previous, current).status).toBe('baseline')
  })

  it('recognizes a reset cursor after a non-identical prior snapshot', () => {
    const previous = world({ dayTime: .4, tickIndex: 16, creatures: [creature(1)] })
    const current = world({ creatures: [creature(1)] })
    const summary = deriveLivePulse(previous, current)

    expect(summary.status).toBe('baseline')
    expect(formatLivePulse(summary)).toBe('Waiting for the next simulation update.')
  })

  it('does not treat a repeated initial snapshot as a reset', () => {
    const previous = world({ creatures: [creature(1)] })
    const current = world({ creatures: [creature(1)] })
    const summary = deriveLivePulse(previous, current)

    expect(summary.status).toBe('same-generation')
    expect(formatLivePulse(summary)).toBe('Since last update · No simulated time elapsed · no discrete events recorded.')
    expect(formatLivePulse(summary)).not.toContain('Movement continues')
  })

  it('only describes ongoing movement after simulated time advances', () => {
    const previous = world({ dayTime: .1, tickIndex: 4, creatures: [creature(1)] })
    const current = world({ dayTime: .2, tickIndex: 8, creatures: [creature(1)] })

    expect(formatLivePulse(deriveLivePulse(previous, current))).toBe('Since last update · 0.10 s simulated · Movement continues · no discrete events recorded.')
  })

  it('keeps same-cursor founder arrivals visible instead of mistaking them for a reset', () => {
    const previous = world({ creatures: [creature(1)] })
    const current = world({ creatures: [creature(1), creature(2, { mode: 'foraging' })] })
    const summary = deriveLivePulse(previous, current)

    expect(summary.status).toBe('same-generation')
    expect(summary.foundersArrived).toBe(1)
    expect(formatLivePulse(summary)).toContain('1 founder arrived')
  })

  it('computes every available counter delta across skipped ticks', () => {
    const previous = world({ dayTime: .1, tickIndex: 4, ...Object.fromEntries(LIVE_PULSE_COUNTER_KEYS.map((key, index) => [key, index])) })
    const current = world({ dayTime: .35, tickIndex: 14, ...Object.fromEntries(LIVE_PULSE_COUNTER_KEYS.map((key, index) => [key, index + index + 1])) })
    const summary = deriveLivePulse(previous, current)

    expect(summary.status).toBe('same-generation')
    expect(summary.elapsedSeconds).toBeCloseTo(.25)
    expect(summary.counterDeltas).toEqual({
      dayFoodProduced: 1,
      dayFoodRemoved: 2,
      dayFoodConsumed: 3,
      dayPreyConsumed: 4,
      dayAttackAttempts: 5,
      dayAttackSuccesses: 6,
      dayAttackFailures: 7,
      dayAttackContested: 8,
    })
    expect(formatLivePulse(summary)).toContain('Since last update · 0.25 s simulated')
    expect(formatLivePulse(summary)).toContain('+1 food added/grown')
    expect(formatLivePulse(summary)).toContain('+4 prey consumed')
    expect(formatLivePulse(summary)).toContain('+5 attack attempt')
  })

  it('counts deaths, arrivals, founders, and destination state changes without double counting', () => {
    const previous = world({ creatures: [
      creature(1, { mode: 'exploring' }),
      creature(2, { mode: 'foraging' }),
      creature(3, { home: true }),
      creature(4, { mode: 'fleeing' }),
      creature(5, { mode: 'returning' }),
      creature(6, { alive: false, deathCause: 'hunted' }),
    ] })
    const current = world({ dayTime: .05, tickIndex: 2, creatures: [
      creature(1, { alive: false, deathCause: 'hunted' }),
      creature(2, { home: true, mode: 'returning' }),
      creature(3, { mode: 'hunting' }),
      creature(4, { mode: 'returning' }),
      creature(5, { home: true, mode: 'returning' }),
      creature(6, { alive: false, deathCause: 'hunted' }),
      creature(7, { mode: 'foraging' }),
    ] })
    const summary = deriveLivePulse(previous, current)

    expect(summary).toMatchObject({ deaths: 1, huntedDeaths: 1, energyDeaths: 0, otherDeaths: 0, reachedHome: 2, foundersArrived: 1 })
    expect(summary.stateChanges).toMatchObject({ hunting: 1, returning: 1, foraging: 0 })
    expect(formatLivePulse(summary)).toContain('1 hunted death')
    expect(formatLivePulse(summary)).toContain('2 creatures reached home')
    expect(formatLivePulse(summary)).toContain('1 founder arrived')
    expect(formatLivePulse(summary)).toContain('1 creature shifted to hunting prey')
    expect(formatLivePulse(summary)).toContain('1 creature shifted to going home')
  })

  it('uses individualId rather than runtime array position and suppresses vanished generation members', () => {
    const previous = world({ creatures: [creature(1, { mode: 'exploring' }), creature(2, { mode: 'foraging' })] })
    const current = world({ dayTime: .1, tickIndex: 4, creatures: [creature(2, { mode: 'hunting' })] })
    const summary = deriveLivePulse(previous, current)

    expect(summary.foundersArrived).toBe(0)
    expect(summary.deaths).toBe(0)
    expect(summary.stateChanges.hunting).toBe(1)
  })

  it('keeps generation boundaries separate from interval events', () => {
    const previous = world({ dayTime: 3.9, tickIndex: 156, creatures: [creature(1)] })
    const current = world({ generation: 2, dayTime: 0, tickIndex: 0, creatures: [creature(8)] })
    const summary = deriveLivePulse(previous, current)

    expect(summary.status).toBe('boundary')
    expect(summary.deaths).toBe(0)
    expect(summary.foundersArrived).toBe(0)
    expect(summary.counterDeltas.dayFoodConsumed).toBeNull()
    expect(formatLivePulse(summary)).toBe('Generation 1 ended → Generation 2 started; interval counters reset.')
  })

  it('marks nonmonotone and nonfinite values unavailable instead of emitting negative events', () => {
    const previous = world({ dayTime: .3, dayFoodConsumed: 4, dayFoodRemoved: 1, dayAttackAttempts: 1 })
    const current = world({ dayTime: Number.NaN, dayFoodConsumed: 2, dayFoodRemoved: Number.POSITIVE_INFINITY, dayAttackAttempts: 3 })
    const summary = deriveLivePulse(previous, current)

    expect(summary.elapsedSeconds).toBeNull()
    expect(summary.counterDeltas.dayFoodConsumed).toBeNull()
    expect(summary.counterDeltas.dayFoodRemoved).toBeNull()
    expect(summary.counterDeltas.dayAttackAttempts).toBe(2)
    expect(formatLivePulse(summary)).not.toContain('food eaten')
    expect(formatLivePulse(summary)).toContain('+2 attack attempts')
  })

  it('supports snapshots with omitted legacy counters', () => {
    const previous = world({ dayTime: .1 })
    const current = world({ dayTime: .2 })
    delete (previous as Partial<LivePulseWorld>).dayFoodConsumed
    delete (current as Partial<LivePulseWorld>).dayFoodConsumed
    const summary = deriveLivePulse(previous, current)

    expect(summary.counterDeltas.dayFoodConsumed).toBeNull()
    expect(formatLivePulse(summary)).not.toContain('food eaten')
  })

  it('keeps formatter output deterministic, pluralized, and bounded for state changes', () => {
    const summary: LivePulseSummary = {
      status: 'same-generation',
      generation: 3,
      previousGeneration: 3,
      elapsedSeconds: .1,
      counterDeltas: { dayFoodProduced: 1, dayFoodRemoved: 0, dayFoodConsumed: 0, dayPreyConsumed: 0, dayAttackAttempts: 0, dayAttackSuccesses: 0, dayAttackFailures: 0, dayAttackContested: 0 },
      deaths: 0,
      huntedDeaths: 0,
      energyDeaths: 0,
      otherDeaths: 0,
      reachedHome: 0,
      foundersArrived: 0,
      stateChanges: { safe: 1, exploring: 2, foraging: 3, hunting: 4, fleeing: 5, returning: 6 },
    }
    const formatted = formatLivePulse(summary)

    expect(formatted).toBe('Since last update · 0.10 s simulated · +1 food added/grown · 1 creature shifted to safe at home · 2 creatures shifted to exploring · 3 creatures shifted to finding food · 15 creatures shifted to other actions')
    expect(formatted.match(/shifted to/g)?.length).toBe(4)
    expect(formatLivePulse(summary)).toBe(formatted)
  })

  it('aggregates a crowded interval after a deterministic event-clause cap', () => {
    const summary: LivePulseSummary = {
      status: 'same-generation',
      generation: 1,
      previousGeneration: 1,
      elapsedSeconds: .25,
      counterDeltas: { dayFoodProduced: 1, dayFoodRemoved: 1, dayFoodConsumed: 1, dayPreyConsumed: 1, dayAttackAttempts: 1, dayAttackSuccesses: 1, dayAttackFailures: 1, dayAttackContested: 1 },
      deaths: 3,
      huntedDeaths: 1,
      energyDeaths: 1,
      otherDeaths: 1,
      reachedHome: 2,
      foundersArrived: 2,
      stateChanges: { safe: 1, exploring: 1, foraging: 1, hunting: 1, fleeing: 1, returning: 1 },
    }
    const formatted = formatLivePulse(summary)

    expect(formatted).toContain('additional updates')
    expect(formatted.split(' · ').length).toBeLessThanOrEqual(14)
    expect(formatLivePulse(summary)).toBe(formatted)
  })

  it('leaves both snapshots untouched', () => {
    const previous = world({ dayTime: .1, creatures: [creature(1)] })
    const current = world({ dayTime: .2, creatures: [creature(1, { home: true })] })
    const previousBefore = structuredClone(previous)
    const currentBefore = structuredClone(current)
    const summary = deriveLivePulse(previous, current)
    formatLivePulse(summary)

    expect(previous).toEqual(previousBefore)
    expect(current).toEqual(currentBefore)
  })
})
