import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatNextActionCopy, formatPlaybackControlLabel, formatPlaybackPhaseAnnouncement, formatStepCompletion, GenerationAccountingFallback, PlaybackPhaseStatus, resolveTerminalOutcome, type NextActionCopyInput, type TerminalOutcomeCreature } from './App'
import { formatPerceptionTelemetry } from './components/CreatureInspector'
import { createWorld, defaultConfig } from './simulation/engine'
import type { LastInspectedOutcome, PerceptionDiagnostics } from './simulation/types'

const ready = (overrides: Partial<NextActionCopyInput> = {}): NextActionCopyInput => ({
  extinct: false,
  hasActiveCreatures: true,
  pending: false,
  selectedIndividualId: null,
  selectedIsActive: false,
  livingCreatures: 1,
  ...overrides,
})

const terminal = (overrides: Partial<LastInspectedOutcome> = {}): LastInspectedOutcome => ({
  individualId: 17,
  generation: 4,
  cause: 'hunted',
  ...overrides,
})

const creature = (overrides: Partial<TerminalOutcomeCreature> = {}): TerminalOutcomeCreature => ({
  individualId: 17,
  alive: false,
  deathCause: null,
  ...overrides,
})

describe('next action control copy', () => {
  it('names an active inspected individual without claiming other creatures stop moving', () => {
    const copy = formatNextActionCopy(ready({ selectedIndividualId: 17, selectedIsActive: true }))

    expect(copy.buttonLabel).toBe("Advance until Individual 17's next decision")
    expect(copy.ariaLabel).toContain('advance the simulation until Individual 17')
    expect(copy.ariaLabel).toContain('other creatures may also move and react')
    expect(copy.title).toContain('other creatures may also move and react')
    expect(copy.title).not.toContain('only Individual 17')
  })

  it('explains the simulation-wide action beat when no individual is active', () => {
    expect(formatNextActionCopy(ready())).toEqual({
      buttonLabel: 'Advance action beat',
      ariaLabel: 'Pause and advance the simulation to the next action beat',
      title: 'Advance the simulation to the next decision beat.',
    })
  })

  it('keeps pending, inactive, and extinct states truthful', () => {
    expect(formatNextActionCopy(ready({ pending: true, selectedIndividualId: 17, selectedIsActive: true }))).toEqual({
      buttonLabel: "Advancing to Individual 17's next decision",
      ariaLabel: 'Advancing the simulation until Individual 17 reaches its next action beat; other creatures may also move and react',
      title: 'Advancing the simulation until Individual 17 reaches its next action beat.',
    })
    expect(formatNextActionCopy(ready({ hasActiveCreatures: false }))).toEqual({
      buttonLabel: 'No active creatures',
      ariaLabel: 'Next action unavailable during awaiting settlement; use Finish generation to settle this cohort',
      title: 'No active creature actions remain; use Finish generation to settle this cohort.',
    })
    expect(formatNextActionCopy(ready({ extinct: true }))).toEqual({
      buttonLabel: 'Population extinct',
      ariaLabel: 'Next action unavailable: population extinct',
      title: 'Population extinct; no next action is available.',
    })
  })

  it('distinguishes awaiting-home and awaiting-dead guidance for a disabled next action', () => {
    const home = formatNextActionCopy(ready({ hasActiveCreatures: false, livingCreatures: 2 }))
    expect(home.ariaLabel).toContain('use Finish generation to settle this cohort')
    expect(home.title).toContain('No active creature actions remain')

    const dead = formatNextActionCopy(ready({ hasActiveCreatures: false, livingCreatures: 0 }))
    expect(dead.title).toContain('All creatures in this generation are dead')
    expect(dead.title).toContain('Finish generation to record it')
  })

  it('keeps playback controls and the phase announcement truthful at settlement', () => {
    expect(formatPlaybackControlLabel('Running', true)).toBe('Pause simulation')
    expect(formatPlaybackControlLabel('Paused', false)).toBe('Play simulation')
    expect(formatPlaybackControlLabel('Awaiting settlement', true)).toBe('Pause playback before settlement')
    expect(formatPlaybackControlLabel('Awaiting settlement', false)).toBe('Resume playback toward settlement')
    expect(formatPlaybackControlLabel('Extinct', true)).toBe('Playback unavailable: population extinct')
    const detail = 'Awaiting settlement. Finish generation to settle this cohort.'
    expect(formatPlaybackPhaseAnnouncement('Awaiting settlement', detail, true)).toContain('Playback continues toward automatic settlement')
    expect(formatPlaybackPhaseAnnouncement('Awaiting settlement', detail, false)).toContain('Playback is paused before settlement')
    expect(formatPlaybackPhaseAnnouncement('Extinct', 'Extinct. The last settlement produced no creatures.', false)).toBe('')
  })

  it('renders one stable atomic phase region with distinct awaiting pause and resume text', () => {
    const detail = 'Awaiting settlement. Finish generation to settle this cohort.'
    const paused = renderToStaticMarkup(createElement(PlaybackPhaseStatus, { status: 'Awaiting settlement', detail, playing: false }))
    const running = renderToStaticMarkup(createElement(PlaybackPhaseStatus, { status: 'Awaiting settlement', detail, playing: true }))
    const suppressed = renderToStaticMarkup(createElement(PlaybackPhaseStatus, { status: 'Awaiting settlement', detail, playing: false, suppressed: true }))
    expect(paused).toContain('id="playback-phase-status"')
    expect(paused).toContain('role="status"')
    expect(paused).toContain('aria-live="polite"')
    expect(paused).toContain('aria-atomic="true"')
    expect(paused).toContain('Playback is paused before settlement')
    expect(running).toContain('Playback continues toward automatic settlement')
    expect(suppressed).not.toContain('Awaiting settlement')
  })

  it('describes a stopped manual step as awaiting settlement until the cohort is recorded', () => {
    const home = createWorld({ ...defaultConfig, initialPopulation: 2 })
    for (const individual of home.creatures) individual.home = true
    expect(formatStepCompletion(home, { stepResult: { ticks: 0, stop: 'no-active' } })).toContain('Awaiting settlement')
    expect(formatStepCompletion(home, { stepResult: { ticks: 0, stop: 'no-active' } })).toContain('all living creatures are home')

    const dead = createWorld({ ...defaultConfig, initialPopulation: 2 })
    for (const individual of dead.creatures) individual.alive = false
    expect(formatStepCompletion(dead, { stepResult: { ticks: 0, stop: 'no-active' } })).toContain('All creatures in this generation are dead')
    expect(formatStepCompletion(dead, { stepResult: { ticks: 0, stop: 'no-active' } })).not.toContain('Extinct')

    dead.creatures = []
    expect(formatStepCompletion(dead, { stepResult: { ticks: 0, stop: 'no-active' } })).toContain('Extinct')
  })

  it('does not claim an inactive inspected individual is the step subject', () => {
    const copy = formatNextActionCopy(ready({ selectedIndividualId: 17 }))

    expect(copy.buttonLabel).not.toContain('17')
    expect(copy.ariaLabel).not.toContain('Individual 17')
  })
})

describe('terminal outcome resolution', () => {
  it('accepts a matching recorded outcome, including after later generations', () => {
    const record = terminal({ generation: 2 })

    expect(resolveTerminalOutcome({
      selectedIndividualId: 17,
      creatures: [],
      recordedOutcome: record,
      currentGeneration: 5,
    })).toEqual(record)
  })

  it('rejects a stale or future record that cannot describe the selected individual', () => {
    expect(resolveTerminalOutcome({
      selectedIndividualId: 17,
      creatures: [creature()],
      recordedOutcome: terminal({ individualId: 18 }),
      currentGeneration: 4,
    })).toBeNull()
    expect(resolveTerminalOutcome({
      selectedIndividualId: 17,
      creatures: [],
      recordedOutcome: terminal({ generation: 5 }),
      currentGeneration: 4,
    })).toBeNull()
  })

  it('falls back to the selected dead creature cause when the record is absent', () => {
    for (const cause of ['hunted', 'energy'] as const) {
      expect(resolveTerminalOutcome({
        selectedIndividualId: 17,
        creatures: [creature({ deathCause: cause })],
        recordedOutcome: null,
        currentGeneration: 4,
      })).toEqual({ individualId: 17, generation: 4, cause })
    }
  })

  it('does not resolve living or nonselected creatures into a terminal outcome', () => {
    expect(resolveTerminalOutcome({
      selectedIndividualId: 17,
      creatures: [creature({ alive: true })],
      recordedOutcome: terminal(),
      currentGeneration: 4,
    })).toBeNull()
    expect(resolveTerminalOutcome({
      selectedIndividualId: 17,
      creatures: [creature({ individualId: 18, deathCause: 'energy' })],
      recordedOutcome: terminal({ individualId: 18 }),
      currentGeneration: 4,
    })).toBeNull()
    expect(resolveTerminalOutcome({
      selectedIndividualId: null,
      creatures: [creature({ deathCause: 'energy' })],
      recordedOutcome: terminal(),
      currentGeneration: 4,
    })).toBeNull()
  })
})

describe('perception telemetry copy', () => {
  const diagnostics: PerceptionDiagnostics = {
    mode: 'realistic',
    reactionWindow: 7,
    creatures: { total: 5, detected: 3, range: 1, fov: 0, occlusion: 1, detection: 0 },
    food: { total: 4, detected: 2, range: 0, fov: 1, occlusion: 0, detection: 1 },
  }

  it('names the creature cohort and reconciles combined not-detected buckets', () => {
    expect(formatPerceptionTelemetry(diagnostics)).toEqual({
      creatures: 'Other active creatures detected 3/5',
      food: 'Food detected 2/4',
      notDetected: 'Not detected: 4 total · 1 out of range · 1 outside view · 1 blocked · 1 detection miss',
    })
  })

  it('uses plural detection misses while preserving zero rejection buckets', () => {
    expect(formatPerceptionTelemetry({
      ...diagnostics,
      creatures: { total: 2, detected: 0, range: 1, fov: 0, occlusion: 0, detection: 1 },
      food: { total: 0, detected: 0, range: 0, fov: 0, occlusion: 0, detection: 0 },
    }).notDetected).toBe('Not detected: 2 total · 1 out of range · 0 outside view · 0 blocked · 1 detection miss')
    expect(formatPerceptionTelemetry({
      ...diagnostics,
      creatures: { total: 3, detected: 0, range: 0, fov: 0, occlusion: 0, detection: 3 },
      food: { total: 0, detected: 0, range: 0, fov: 0, occlusion: 0, detection: 0 },
    }).notDetected).toContain('3 detection misses')
  })
})

describe('generation accounting loading state', () => {
  it('keeps both lazy sections visibly present and marked busy', () => {
    const markup = renderToStaticMarkup(createElement(GenerationAccountingFallback))
    expect(markup).toContain('Resource pressure')
    expect(markup).toContain('Loading resource pressure…')
    expect(markup).toContain('Generation accounting')
    expect(markup).toContain('Loading generation accounting…')
    expect(markup.match(/aria-busy="true"/g)).toHaveLength(2)
  })
})
