import { describe, expect, it } from 'vitest'
import { formatNextActionCopy, type NextActionCopyInput } from './App'

const ready = (overrides: Partial<NextActionCopyInput> = {}): NextActionCopyInput => ({
  extinct: false,
  hasActiveCreatures: true,
  pending: false,
  selectedIndividualId: null,
  selectedIsActive: false,
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
