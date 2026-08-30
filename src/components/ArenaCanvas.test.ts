import { describe, expect, it } from 'vitest'
import {
  ARENA_HUNT_CONTACT_KEY,
  ARENA_PATCH_STOCK_KEY,
  ARENA_QUICK_START,
  ARENA_SELECTED_OVERLAY_KEY,
  arenaPlaybackStatus,
  formatArenaAccessibleDescription,
  formatArenaDayProgress,
  formatArenaOverlayDescription,
  formatSelectedTarget,
  showArenaQuickStart,
  type ArenaAccessibleDescriptionInput,
} from './ArenaCanvas'

const descriptionInput = (overrides: Partial<ArenaAccessibleDescriptionInput> = {}): ArenaAccessibleDescriptionInput => ({
  generation: 3,
  livingCreatures: 12,
  stateSummary: '4 safe at home, 8 exploring',
  foodCount: 18,
  patchCount: 4,
  foodBudget: 42,
  obstacleCount: 2,
  ecologyMode: 'energy-regrowth',
  hasSelectedCreature: false,
  ...overrides,
})

describe('arena clarity helpers', () => {
  it('gives extinction status precedence and formats day progress consistently', () => {
    expect(arenaPlaybackStatus(true, false)).toBe('Running')
    expect(arenaPlaybackStatus(false, false)).toBe('Paused')
    expect(arenaPlaybackStatus(true, true)).toBe('Extinct')
    expect(formatArenaDayProgress(2.25, 18, 'Running')).toBe('Day 2.3 / 18.0 · Running')
  })

  it('shows a concise workflow cue only before the first generation is completed', () => {
    expect(showArenaQuickStart(0)).toBe(true)
    expect(showArenaQuickStart(1)).toBe(false)
    expect(ARENA_QUICK_START.join(' ')).toContain('pause → inspect a creature → finish generation')
    expect(ARENA_QUICK_START.join(' ')).toContain('change one parameter')
  })

  it('describes ecological patch stock and unselected overlay affordance', () => {
    const description = formatArenaAccessibleDescription(descriptionInput())
    expect(description).toContain(ARENA_PATCH_STOCK_KEY)
    expect(description).toContain('Select a creature to reveal its focus, sight, target, memory, and same-lineage overlays.')
    expect(description).not.toContain(ARENA_SELECTED_OVERLAY_KEY)
  })

  it('describes selected overlays while keeping classic mode free of patch-ring claims', () => {
    const selectedEcological = formatArenaAccessibleDescription(descriptionInput({ hasSelectedCreature: true }))
    expect(selectedEcological).toContain(ARENA_PATCH_STOCK_KEY)
    expect(selectedEcological).toContain(ARENA_SELECTED_OVERLAY_KEY)

    const selectedClassic = formatArenaAccessibleDescription(descriptionInput({ ecologyMode: 'classic', hasSelectedCreature: true }))
    expect(selectedClassic).toContain(ARENA_SELECTED_OVERLAY_KEY)
    expect(selectedClassic).not.toContain(ARENA_PATCH_STOCK_KEY)
    expect(selectedClassic).toContain('generation pulse')
  })

  it('formats runtime targets as user-facing individual and food labels', () => {
    expect(formatSelectedTarget({ targetType: 'prey', targetId: 42 }, [{ id: 42, individualId: 7, alive: true }])).toBe('Prey · Individual 7')
    expect(formatSelectedTarget({ targetType: 'threat', targetId: 43 }, [{ id: 43, individualId: 8, alive: true }])).toBe('Threat · Individual 8')
    expect(formatSelectedTarget({ targetType: 'food', targetId: 901 }, [], [{ id: 901 }])).toBe('Food item')
    expect(formatSelectedTarget({ targetType: null, targetId: null }, [])).toBe('None')
  })

  it('hides missing, dead, or disappeared entity identifiers', () => {
    expect(formatSelectedTarget({ targetType: 'prey', targetId: 42 }, [{ id: 42, individualId: 7, alive: false }])).toBe('Prey · unavailable')
    expect(formatSelectedTarget({ targetType: 'threat', targetId: 99 }, [])).toBe('Threat · unavailable')
    expect(formatSelectedTarget({ targetType: 'food', targetId: 901 }, [], [])).toBe('Food · unavailable')
  })

  it('labels location targets without exposing implementation identifiers', () => {
    expect(formatSelectedTarget({ targetType: 'home', targetId: null }, [])).toBe('Home location')
    expect(formatSelectedTarget({ targetType: 'memory', targetId: null }, [])).toBe('Remembered location')
    expect(formatSelectedTarget({ targetType: 'explore', targetId: null }, [])).toBe('Exploration waypoint')
  })

  it('explains the contact-driven hunt rule only for a selected hunter', () => {
    const selectedHunter = formatArenaOverlayDescription('energy-regrowth', true, true)
    expect(selectedHunter).toContain(ARENA_HUNT_CONTACT_KEY)
    expect(selectedHunter).toContain('nearest eligible prey at contact')
    expect(formatArenaOverlayDescription('energy-regrowth', true, false)).not.toContain(ARENA_HUNT_CONTACT_KEY)
    expect(formatArenaAccessibleDescription(descriptionInput({ hasSelectedCreature: true, selectedIsHunting: true }))).toContain(ARENA_HUNT_CONTACT_KEY)
  })
})
