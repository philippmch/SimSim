import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../simulation/config'
import {
  deriveLivePulse,
  formatLivePulse,
  formatLivePulseTrailEntry,
  LIVE_PULSE_COUNTER_KEYS,
  MAX_LIVE_PULSE_TRAIL_ENTRIES,
  reduceLivePulseTrail,
  hasWorldActivityTelemetry,
  shouldRenderLivePulseTrail,
  type LivePulseCreature,
  type LivePulseSummary,
  type LivePulseTrailEntry,
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

const pulseSummary = (overrides: Partial<LivePulseSummary> = {}): LivePulseSummary => ({
  status: 'same-generation',
  generation: 1,
  previousGeneration: 1,
  elapsedSeconds: .05,
  counterDeltas: { dayFoodProduced: 0, dayFoodRemoved: 0, dayFoodConsumed: 0, dayPreyConsumed: 0, dayAttackAttempts: 0, dayAttackSuccesses: 0, dayAttackFailures: 0, dayAttackContested: 0 },
  deaths: 0,
  huntedDeaths: 0,
  energyDeaths: 0,
  otherDeaths: 0,
  reachedHome: 0,
  foundersArrived: 0,
  stateChanges: { safe: 0, exploring: 0, foraging: 0, hunting: 0, fleeing: 0, returning: 0 },
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

describe('live pulse recent-activity trail', () => {
  const record = (state: readonly LivePulseTrailEntry[], summary: LivePulseSummary, dayTime = .25, tickIndex = 10) => (
    reduceLivePulseTrail(state, { type: 'snapshot', summary, dayTime, tickIndex })
  )

  it('ignores movement and state-only chatter without replacing retained activity', () => {
    const retained = record([], pulseSummary({ counterDeltas: { ...pulseSummary().counterDeltas, dayFoodConsumed: 1 } }))
    const stateOnly = pulseSummary({ stateChanges: { ...pulseSummary().stateChanges, hunting: 3 } })
    const unchanged = record(retained, stateOnly, .3, 12)

    expect(unchanged).toBe(retained)
    expect(unchanged).toHaveLength(1)
    expect(unchanged[0].text).toContain('Resources: +1 food eaten')
  })

  it.each([
    ['food counters', pulseSummary({ counterDeltas: { ...pulseSummary().counterDeltas, dayFoodProduced: 2 } }), 'food added/grown'],
    ['attacks', pulseSummary({ counterDeltas: { ...pulseSummary().counterDeltas, dayAttackAttempts: 2 } }), 'attack attempts'],
    ['deaths', pulseSummary({ deaths: 1, huntedDeaths: 1 }), 'hunted death'],
    ['home arrivals', pulseSummary({ reachedHome: 2 }), 'creatures reached home'],
    ['founder arrivals', pulseSummary({ foundersArrived: 1 }), 'founder arrived'],
  ])('retains %s with generation-and-day provenance', (_name, summary, expected) => {
    const trail = record([], summary, 1.375, 55)

    expect(trail).toHaveLength(1)
    expect(trail[0]).toMatchObject({ sequence: 1, generation: 1, dayTime: 1.375, tickIndex: 55 })
    expect(formatLivePulseTrailEntry(trail[0])).toContain(`Generation 1 · day 1.38 ·`)
    expect(trail[0].text).toContain(expected)
  })

  it('keeps the five newest salient intervals in newest-first order', () => {
    let trail: readonly LivePulseTrailEntry[] = []
    for (let day = 1; day <= MAX_LIVE_PULSE_TRAIL_ENTRIES + 1; day++) {
      trail = record(trail, pulseSummary({ counterDeltas: { ...pulseSummary().counterDeltas, dayFoodRemoved: day } }), day, day * 4)
    }

    expect(trail).toHaveLength(MAX_LIVE_PULSE_TRAIL_ENTRIES)
    expect(trail.map(entry => entry.dayTime)).toEqual([6, 5, 4, 3, 2])
    expect(trail.map(entry => entry.text)).toEqual([
      'Resources: +6 food removed',
      'Resources: +5 food removed',
      'Resources: +4 food removed',
      'Resources: +3 food removed',
      'Resources: +2 food removed',
    ])
    expect(trail.map(entry => entry.sequence)).toEqual([6, 5, 4, 3, 2])
  })

  it('retains generation boundaries alongside earlier salient intervals', () => {
    const earlier = record([], pulseSummary({ counterDeltas: { ...pulseSummary().counterDeltas, dayFoodConsumed: 1 } }), 3.9, 156)
    const boundary = pulseSummary({ status: 'boundary', generation: 2, previousGeneration: 1, elapsedSeconds: null })
    const trail = record(earlier, boundary, 0, 0)

    expect(trail).toHaveLength(2)
    expect(formatLivePulseTrailEntry(trail[0])).toBe('Generation 2 · day 0.00 · Generation 1 ended → Generation 2 started')
    expect(trail[1]).toBe(earlier[0])
  })

  it('assigns distinct sequence keys to salient same-cursor interventions', () => {
    const first = record([], pulseSummary({ foundersArrived: 1 }), 0, 0)
    const second = record(first, pulseSummary({ foundersArrived: 1 }), 0, 0)

    expect(second.map(entry => entry.sequence)).toEqual([2, 1])
    expect(second.map(entry => entry.tickIndex)).toEqual([0, 0])
  })

  it('clears on explicit reset and baseline snapshots', () => {
    const retained = record([], pulseSummary({ foundersArrived: 1 }))

    expect(reduceLivePulseTrail(retained, { type: 'reset' })).toEqual([])
    expect(record(retained, pulseSummary({ status: 'baseline' }))).toEqual([])
  })

  it('handles omitted legacy counters and corrupt provenance without throwing', () => {
    const legacy = pulseSummary()
    delete (legacy as Partial<LivePulseSummary>).counterDeltas
    expect(record([], legacy)).toEqual([])

    const corrupt = pulseSummary({ generation: Number.NaN, deaths: 1 })
    delete (corrupt as Partial<LivePulseSummary>).counterDeltas
    const trail = record([], corrupt, Number.POSITIVE_INFINITY, Number.NaN)

    expect(trail[0]).toMatchObject({ sequence: 1, generation: null, dayTime: null, tickIndex: null, text: 'Population: 1 creature death' })
    expect(formatLivePulseTrailEntry(trail[0])).toBe('Generation ? · day ? · Population: 1 creature death')
  })

  it('groups crowded retained entries into at most three readable families', () => {
    const summary = pulseSummary({
      counterDeltas: { ...pulseSummary().counterDeltas, dayFoodConsumed: 2, dayAttackAttempts: 3, dayAttackSuccesses: 1 },
      reachedHome: 4,
    })
    const trail = record([], summary)

    expect(trail[0].text).toBe('Resources: +2 food eaten · Hunts: +3 attack attempts, +1 attack success · Population: 4 creatures reached home')
    expect(trail[0].text.split(' · ')).toHaveLength(3)
    expect(formatLivePulse(summary)).toContain('+1 attack success')
    expect(formatLivePulse(summary)).toContain('4 creatures reached home')
  })

  it('keeps the aggregate trail only for legacy snapshots without activity telemetry', () => {
    const retained = record([], pulseSummary({ foundersArrived: 1 }))
    expect(hasWorldActivityTelemetry(world())).toBe(false)
    expect(hasWorldActivityTelemetry({ ...world(), activity: [] })).toBe(true)
    expect(shouldRenderLivePulseTrail(world(), retained)).toBe(true)
    expect(shouldRenderLivePulseTrail({ ...world(), activity: [] }, retained)).toBe(false)
    expect(shouldRenderLivePulseTrail({ ...world(), activity: [{ malformed: true }] }, retained)).toBe(false)
  })
})
