import { describe, expect, it } from 'vitest'
import { formatArenaRestingHint, formatNextActionCopy, formatCompactNextActionLabel } from './App'

describe('resting creature explanation', () => {
  it('explains the mostly-home state without claiming the remaining actor is stuck', () => {
    expect(formatArenaRestingHint(25, 1, true, 18)).toBe('25 resting at home · 1 still active. Resting uses energy; hungry creatures may forage again.')
  })

  it('preserves classic continuation copy when everyone is home', () => {
    const running = formatArenaRestingHint(26, 0, true, 18, 'classic')
    expect(running).toContain('All 26 living creatures are resting at home')
    expect(running).toContain('timer reaches 18.0')
    expect(running).toContain('Finish generation')
    const paused = formatArenaRestingHint(1, 0, false, 18, 'classic')
    expect(paused).toContain('The remaining creature is resting at home')
    expect(paused).toContain('Choose Play to continue the timer')
    expect(paused).not.toContain('next generation starts when')
  })

  it('keeps ecological rest stepping available and explains its energy cost', () => {
    const input = { extinct: false, hasActiveCreatures: false, restingCanAct: true, pending: false, selectedIndividualId: null, selectedIsActive: false, livingCreatures: 29 }
    expect(formatCompactNextActionLabel(input)).toBe('Advance rest')
    expect(formatNextActionCopy(input).title).toContain('use energy')
    expect(formatArenaRestingHint(29, 0, false, 18)).toContain('Choose Next action or Play')
    expect(formatCompactNextActionLabel({ ...input, restingCanAct: false })).toBe('No actions')
  })

  it('does not claim rest when nobody is home, including an empty population', () => {
    expect(formatArenaRestingHint(0, 0, false, 18)).not.toContain('resting')
    expect(formatArenaRestingHint(0, 42, true, 18)).toContain('Click a creature')
  })
})
