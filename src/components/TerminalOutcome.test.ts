import { describe, expect, it } from 'vitest'
import { formatTerminalOutcome, TERMINAL_OUTCOME_LABELS } from './TerminalOutcome'
import type { LastInspectedOutcome, TerminalEndCause } from '../simulation/types'

const outcome = (cause:TerminalEndCause):LastInspectedOutcome => ({ individualId:17, generation:4, cause })

describe('terminal outcome copy', () => {
  it('uses the exact user-facing label and concise explanation for every terminal cause', () => {
    const expected:Record<TerminalEndCause,string> = {
      hunted:'A successful hunt removed this individual from the population.',
      energy:'It had no usable energy remaining during the generation or at settlement.',
      unfed:'It ended the generation without the food required to survive.',
      late:'It did not reach home before the generation ended.',
      aged:'It reached the configured maximum age at settlement.',
    }

    for (const cause of Object.keys(expected) as TerminalEndCause[]) {
      const copy = formatTerminalOutcome(outcome(cause))
      expect(copy.label).toBe(TERMINAL_OUTCOME_LABELS[cause])
      expect(copy.individualLabel).toBe('Individual 17')
      expect(copy.endingGeneration).toBe('Generation 4 terminal outcome')
      expect(copy.status).toBe('Individual 17 is no longer in the living population.')
      expect(copy.explanation).toBe(expected[cause])
      expect(copy.announcement).toBe(`Individual 17, Generation 4 terminal outcome: ${TERMINAL_OUTCOME_LABELS[cause]}. This individual is no longer in the living population.`)
    }
  })
})
