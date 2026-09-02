import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { GenerationLedger, World } from '../simulation/types'
import { defaultConfig, createWorld } from '../simulation/engine'
import { GenerationHandoff, formatGenerationHandoffDay, formatGenerationHandoffPhase, formatGenerationHandoffPopulation } from './GenerationHandoff'
import { GENERATION_HANDOFF_REVEAL_SCROLL_OPTIONS, RecordedGenerationHandoff, resolveGenerationHandoffRevealTarget } from './RecordedGenerationHandoff'

const makeLedger = (overrides: Record<string, unknown> = {}): GenerationLedger => ({
  generation: 4,
  startPopulation: 3,
  outcomes: { survived: 2, hunted: 1, energy: 0, unfed: 0, late: 0, aged: 0 },
  birthsEligible: 1,
  birthsAdmitted: 1,
  birthsCapped: 0,
  ...overrides,
} as unknown as GenerationLedger)

const makeWorld = (overrides: Record<string, unknown> = {}): World => {
  const world = createWorld({ ...defaultConfig, initialPopulation: 3 })
  Object.assign(world, { generation: 4, dayTime: 7.25, ledger: [] })
  Object.assign(world.creatures[1], { home: true })
  Object.assign(world.creatures[2], { alive: false, home: true })
  return { ...world, ...overrides } as unknown as World
}

const markup = (world: unknown, playbackStatus: 'Running' | 'Paused' | 'Awaiting settlement' | 'Extinct', playing = false) => renderToStaticMarkup(createElement(GenerationHandoff, {
  world,
  playbackStatus,
  playing,
  onReviewGeneration: vi.fn(),
}))

const recordedMarkup = (ledgers: unknown, revealGeneration: number | null = null) => renderToStaticMarkup(createElement(RecordedGenerationHandoff, {
  ledgers,
  revealGeneration,
  onReviewGeneration: vi.fn(),
}))

describe('generation handoff formatters', () => {
  it('resolves only a matching safe generation and uses a non-animated nearest scroll', () => {
    const target = { scrollIntoView: vi.fn() }
    expect(resolveGenerationHandoffRevealTarget(7, 7, target)).toEqual({ generation: 7, target, options: GENERATION_HANDOFF_REVEAL_SCROLL_OPTIONS })
    expect(resolveGenerationHandoffRevealTarget(6, 7, target)).toBeNull()
    expect(resolveGenerationHandoffRevealTarget(Number.NaN, 7, target)).toBeNull()
    expect(resolveGenerationHandoffRevealTarget(Number.POSITIVE_INFINITY, 7, target)).toBeNull()
    expect(resolveGenerationHandoffRevealTarget(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, target)).toBeNull()
    expect(resolveGenerationHandoffRevealTarget(7, 7, null)).toBeNull()
  })

  it('keeps day, population, and phase copy finite and explicit', () => {
    expect(formatGenerationHandoffDay(7.25, 30)).toBe('Day 7.3 / 30.0')
    expect(formatGenerationHandoffPopulation(2, 3)).toBe('2 living · 3 in cohort')
    expect(formatGenerationHandoffPhase('Running')).toBe('Running')
    expect(formatGenerationHandoffPhase('Paused')).toBe('Paused')
    expect(formatGenerationHandoffPhase('Awaiting settlement', true)).toBe('Awaiting settlement · playback running')
    expect(formatGenerationHandoffPhase('Extinct')).toBe('Extinct')
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, '2', undefined]) {
      expect(formatGenerationHandoffDay(value, value)).toBe('Day progress unavailable')
      expect(formatGenerationHandoffPopulation(value, value)).toBe('Living population unavailable')
    }
    expect(formatGenerationHandoffDay(31, 30)).toBe('Day progress unavailable')
    expect(formatGenerationHandoffPopulation(4, 3)).toBe('Living population unavailable')
  })
})

describe('generation handoff states', () => {
  it('places the live forecast after current state in one labeled comparison', () => {
    const world = makeWorld({ generation: 4 })
    const output = renderToStaticMarkup(createElement(GenerationHandoff, {
      world,
      playbackStatus: 'Paused',
      onReviewGeneration: vi.fn(),
    }))

    expect(output).toContain('<strong style="font-size:12px">Generation handoff</strong>')
    expect(output).toContain('Current cohort · if settled now · no recorded result yet')
    expect(output.indexOf('data-handoff-kind="current"')).toBeLessThan(output.indexOf('data-handoff-kind="forecast"'))
    expect(output).toContain('Forecast transition · Generation 4 → 5')
    expect(output).toContain('Counterfactual snapshot · not a prediction · updates as creatures act')
    expect(output).not.toContain('aria-live')
  })

  it('allows an explicit null forecast override when the preview is unavailable', () => {
    const output = renderToStaticMarkup(createElement(GenerationHandoff, {
      world: makeWorld({ generation: 4 }),
      playbackStatus: 'Paused',
      forecast: null,
      onReviewGeneration: vi.fn(),
    }))

    expect(output).toContain('Current cohort · no recorded result yet')
    expect(output).not.toContain('data-handoff-kind="forecast"')
  })

  it('includes the recorded-result step in its visible sequence once a ledger exists', () => {
    const world = makeWorld({ generation: 4, ledger: [makeLedger({ generation: 3 })] })
    const output = renderToStaticMarkup(createElement(GenerationHandoff, {
      world,
      playbackStatus: 'Paused',
      onReviewGeneration: vi.fn(),
    }))
    const currentIndex = output.indexOf('data-handoff-kind="current"')
    const forecastIndex = output.indexOf('data-handoff-kind="forecast"')
    const actualIndex = output.indexOf('data-handoff-kind="actual"')
    expect(output).toContain('Current cohort · if settled now · previous recorded result')
    expect(currentIndex).toBeLessThan(forecastIndex)
    expect(forecastIndex).toBeLessThan(actualIndex)
    expect(output).toContain('Forecast transition · Generation 4 → 5')
    expect(output).toContain('Generation 3 → 4 · recorded at settlement')
    expect(output.match(/Actual recorded result/g)).toHaveLength(1)
    expect(output.match(/aria-live="polite"/g)).toHaveLength(1)
  })

  it('shows current context and meaningful choices while running or paused', () => {
    for (const playbackStatus of ['Running', 'Paused'] as const) {
      const output = markup(makeWorld(), playbackStatus)
      expect(output).toContain('Generation handoff')
      expect(output).toContain('Current state')
      expect(output).toContain(`Generation 4 · ${playbackStatus}`)
      expect(output).toContain('Day 7.3 / 18.0 · 2 living · 3 in cohort')
      expect(output).toContain('Next action')
      expect(output).toContain('Finish generation')
      expect(output).not.toContain('Actual recorded result')
      expect(output).not.toContain('Review generation')
      expect(output).not.toContain('aria-live')
    }
  })

  it('explains why an awaiting cohort is ready and what settlement advances', () => {
    const homeWorld = makeWorld({ creatures: [{ alive: true, home: true }, { alive: true, home: true }], generation: 9 })
    const deadWorld = makeWorld({ creatures: [{ alive: false, home: true }], generation: 9 })
    const home = markup(homeWorld, 'Awaiting settlement')
    const dead = markup(deadWorld, 'Awaiting settlement', true)
    expect(home).toContain('Generation 9 is ready to settle because all living creatures are home')
    expect(home).toContain('Finish generation records it and starts Generation 10')
    expect(dead).toContain('Generation 9 is ready to settle because all creatures are dead')
    expect(dead).toContain('Awaiting settlement · playback running')
    expect(dead).not.toContain('counterfactual')
    expect(dead).not.toContain('aria-live')
  })

  it('shows the newest valid settlement as an actual handoff with an exact review action', () => {
    const review = vi.fn()
    const output = renderToStaticMarkup(createElement(RecordedGenerationHandoff, { ledgers: [makeLedger()], onReviewGeneration: review }))
    expect(output).toContain('Actual recorded result')
    expect(output).toContain('Generation 4 → 5 · recorded at settlement')
    expect(output).toContain('3 creatures evaluated → 2 survived + 1 admitted birth = 3 creatures in the next population')
    expect(output).toContain('Review generation 4')
    expect(output).toContain('Actual result · not a counterfactual forecast')
    expect(output).toContain('role="status" aria-live="polite" aria-atomic="true"')
    expect(output).toContain('Recorded settlement, Generation 4 → 5 (actual result, not a counterfactual forecast)')
    expect(output.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(review).not.toHaveBeenCalled()
  })

  it('keeps singular and zero settlement wording truthful through shared formatters', () => {
    const singular = recordedMarkup([makeLedger({ generation: 1, startPopulation: 1, outcomes: { survived: 1, hunted: 0, energy: 0, unfed: 0, late: 0, aged: 0 }, birthsEligible: 1, birthsAdmitted: 1, birthsCapped: 0 })])
    const zero = recordedMarkup([makeLedger({ generation: 1, startPopulation: 1, outcomes: { survived: 1, hunted: 0, energy: 0, unfed: 0, late: 0, aged: 0 }, birthsEligible: 0, birthsAdmitted: 0, birthsCapped: 0 })])
    expect(singular).toContain('1 creature evaluated → 1 survived + 1 admitted birth = 2 creatures in the next population')
    expect(zero).toContain('1 creature evaluated → 1 survived + 0 admitted births = 1 creature in the next population')
  })

  it('does not invent an actual equation for a malformed newest ledger', () => {
    const output = recordedMarkup([makeLedger({ generation: 6 }), makeLedger({ generation: 7, outcomes: null })])
    expect(output).toContain('Actual recorded result')
    expect(output).toContain('Latest retained record for Generation 7 is incomplete or invalid')
    expect(output).not.toContain('Review generation 7')
    expect(output).not.toContain('evaluated →')
    expect(output.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(output).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('keeps a valid actual result visible beside extinct recovery choices', () => {
    const world = makeWorld({ generation: 5, creatures: [], ledger: [makeLedger({ generation: 4, startPopulation: 2, outcomes: { survived: 0, hunted: 1, energy: 1, unfed: 0, late: 0, aged: 0 }, birthsEligible: 0, birthsAdmitted: 0, birthsCapped: 0 })] })
    const output = renderToStaticMarkup(createElement(GenerationHandoff, {
      world,
      playbackStatus: 'Extinct',
      onReviewGeneration: vi.fn(),
    }))
    const actual = recordedMarkup(world.ledger)
    expect(actual).toContain('Actual recorded result')
    expect(actual).toContain('Generation 4 → 5')
    expect(output).toContain('Founder migration')
    expect(output).toContain('Restart run')
    expect(output).toContain('No living cohort remains in the arena')
    expect(output).toContain('No current cohort · no settlement preview · previous recorded result')
    expect(output.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(`${actual}${output}`).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('renders a useful unavailable state when world telemetry is malformed', () => {
    const world = { generation: Number.NaN, dayTime: Number.POSITIVE_INFINITY, config: { dayLength: -1 }, creatures: null, ledger: [{ generation: Number.NaN }] }
    const output = renderToStaticMarkup(createElement(GenerationHandoff, { world, playbackStatus: 'Running', onReviewGeneration: vi.fn() }))
    const actual = recordedMarkup(world.ledger)
    expect(output).toContain('Generation unavailable')
    expect(output).toContain('Day progress unavailable')
    expect(output).toContain('Living population unavailable')
    expect(output).toContain('Current cohort · previous recorded result')
    expect(output).not.toContain('data-handoff-kind="forecast"')
    expect(output).toContain('Actual recorded result')
    expect(actual).toContain('incomplete or invalid')
    expect(`${actual}${output}`).not.toMatch(/NaN|Infinity|undefined/)
    expect(output.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(actual.match(/aria-live="polite"/g)).toHaveLength(1)
  })

  it('omits the built-in forecast for a partial legacy world when no override is supplied', () => {
    const world = { generation: 1, config: { seed: 1, ecologyMode: 'classic' }, creatures: [{ alive: true, home: true }] }
    const output = renderToStaticMarkup(createElement(GenerationHandoff, { world, playbackStatus: 'Paused', onReviewGeneration: vi.fn() }))

    expect(output).toContain('Generation 1 · Paused')
    expect(output).toContain('1 living · 1 in cohort')
    expect(output).toContain('Current cohort · no recorded result yet')
    expect(output).not.toContain('data-handoff-kind="forecast"')
    expect(output).not.toMatch(/NaN|Infinity|undefined/)
  })
})
