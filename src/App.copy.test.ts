import { describe, expect, it } from 'vitest'
import { formatNextActionCopy, resolveTerminalOutcome, type NextActionCopyInput, type TerminalOutcomeCreature } from './App'
import type { LastInspectedOutcome } from './simulation/types'

const ready = (overrides: Partial<NextActionCopyInput> = {}): NextActionCopyInput => ({
  extinct: false,
  hasActiveCreatures: true,
  pending: false,
  selectedIndividualId: null,
  selectedIsActive: false,
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
      ariaLabel: 'Next action unavailable: no active living creatures',
      title: 'No active living creatures can take a next action.',
    })
    expect(formatNextActionCopy(ready({ extinct: true }))).toEqual({
      buttonLabel: 'Population extinct',
      ariaLabel: 'Next action unavailable: population extinct',
      title: 'Population extinct; no next action is available.',
    })
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
