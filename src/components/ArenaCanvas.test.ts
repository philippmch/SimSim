import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ARENA_COLOR_SCHEME_QUERY,
  ARENA_DARK_PALETTE,
  ARENA_FOCUS_DIM_ALPHA,
  ARENA_FOCUS_LABELS,
  ARENA_FOCUS_OPTIONS,
  ARENA_SAFE_FOCUS_TARGET_PATH_KEY,
  ARENA_FOCUS_TARGET_PATH_KEY,
  ARENA_LIGHT_PALETTE,
  ARENA_HUNT_CONTACT_KEY,
  ARENA_PATCH_QUALITY_KEY,
  ARENA_PATCH_MIN_HIT_RADIUS,
  ARENA_PATCH_STOCK_KEY,
  ARENA_QUICK_START,
  ARENA_SELECTED_OVERLAY_KEY,
  arenaCanvasCanDraw,
  arenaCanvasPalette,
  arenaPatchQualityGeometry,
  classifyArenaHeldPathEndpoint,
  dispatchArenaInspectionHit,
  arenaTargetPathEligible,
  listenToArenaColorScheme,
  type ArenaColorSchemeQuery,
  arenaPlaybackStatus,
  arenaCreatureAlpha,
  arenaLineageRingAlpha,
  arenaPatchCentralRingRadius,
  arenaPatchHitRadius,
  arenaPatchHaloRadius,
  arenaPatchOrdinal,
  arenaPatchQualityMultiplier,
  arenaPatchQualityRange,
  CREATURE_STATE_METADATA,
  formatArenaAccessibleDescription,
  formatArenaDayProgress,
  formatArenaFocusDescription,
  formatArenaFocusOption,
  formatArenaInspectionStatus,
  formatArenaOverlayDescription,
  formatArenaPlaybackDetail,
  formatArenaPatchQualityDescription,
  formatArenaSelectionStatus,
  formatObservedPath,
  formatObservedDecisionMetadata,
  formatSelectedTarget,
  hitTestArenaPatch,
  hitTestArenaInspection,
  sortArenaPatches,
  showArenaQuickStart,
  type ArenaAccessibleDescriptionInput,
  type ArenaTargetPathCreature,
} from './ArenaCanvas'
import { createWorld, defaultConfig } from '../simulation/engine'
import { advanceToNextAction } from '../simulation/scheduler'
import type { NextActionContext } from '../simulation/scheduler'
import type { World } from '../simulation/types'

describe('arena renderer boundary', () => {
  it('resolves the split renderer with both the canvas and creature picker', async () => {
    const { ArenaCanvas } = await import('./ArenaCanvasRenderer')
    const world = createWorld({...defaultConfig,initialPopulation:2})
    const markup = renderToStaticMarkup(createElement(ArenaCanvas,{
      world,
      revision:0,
      selectedIndividualId:null,
      onSelect:()=>{},
      arenaFocus:'all',
      playbackStatus:'Paused',
      playbackDetail:'Paused. Resume playback to continue active creature actions.',
    }))

    expect(markup).toContain('<canvas class="arena" role="img"')
    expect(markup).toContain('id="arena-creature-picker"')
    expect(markup).toContain('Individual 1')
    expect(markup).toContain('Individual 2')
  })

  it('renders one namespaced inspection selector for creatures and resource patches', async () => {
    const { ArenaCanvas } = await import('./ArenaCanvasRenderer')
    const world = createWorld({ ...defaultConfig, initialPopulation: 1, foodPatchCount: 2 })
    const markup = renderToStaticMarkup(createElement(ArenaCanvas, {
      world,
      revision: 0,
      selectedIndividualId: null,
      selectedPatchId: world.environment.patches[0]?.id ?? null,
      onSelect: () => {},
      onSelectPatch: () => {},
      arenaFocus: 'all',
      playbackStatus: 'Paused',
      playbackDetail: 'Paused. Resume playback to continue active creature actions.',
    }))

    expect(markup).toContain('>Inspect <select')
    expect(markup).toContain('aria-label="Inspect creatures or resource patches"')
    expect(markup).toContain('<optgroup label="Creatures">')
    expect(markup).toContain('<optgroup label="Resource patches">')
    expect(markup).toContain('Patch 1')
    expect(markup).toContain('combined selector includes living creatures and resource patches')
  })
})

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

const observedWorld = (): World => {
  const world = createWorld({ ...defaultConfig, initialPopulation: 2, perceptionMode: 'realistic' })
  const creature = world.creatures[0]
  world.inspectedIndividualId = creature.individualId
  creature.alive = true
  creature.home = false
  creature.mode = 'foraging'
  creature.targetType = 'food'
  creature.targetId = world.food[0]?.id ?? null
  creature.perceptionDiagnostics = {
    mode: 'realistic',
    reactionWindow: 3,
    creatures: { total: 2, detected: 1, range: 0, fov: 1, occlusion: 0, detection: 0 },
    food: { total: 4, detected: 2, range: 0, fov: 2, occlusion: 0, detection: 0 },
  }
  creature.decisionSummary = { chosen: 'food', reason: 'Nearby food utility', candidates: [] }
  return world
}

const observedContext = (world: World, selectedWasActive = true): NextActionContext => ({ selectedIndividualId: world.inspectedIndividualId, selectedWasActive })

describe('arena color scheme lifecycle', () => {
  it('syncs the modern listener immediately, redraws on changes, and cleans it up', () => {
    let matches = true
    let registered: (() => void) | undefined
    const calls: string[] = []
    const query: ArenaColorSchemeQuery = {
      get matches() { return matches },
      addEventListener: (_type, listener) => { calls.push('add'); registered = listener },
      removeEventListener: (_type, listener) => {
        expect(listener).toBe(registered)
        calls.push('remove')
        registered = undefined
      },
    }
    const changes: boolean[] = []
    const emit = () => registered?.()
    const cleanup = listenToArenaColorScheme(query, false, darkMode => changes.push(darkMode))

    expect(changes).toEqual([true])
    expect(calls).toEqual(['add'])
    matches = false
    emit()
    expect(changes).toEqual([true, false])
    cleanup()
    expect(calls).toEqual(['add', 'remove'])
    matches = true
    emit()
    expect(changes).toEqual([true, false])
  })

  it('falls back to legacy listeners and synchronizes the mount gap', () => {
    let matches = false
    let registered: (() => void) | undefined
    const calls: string[] = []
    const query: ArenaColorSchemeQuery = {
      get matches() { return matches },
      addListener: listener => { calls.push('add'); registered = listener },
      removeListener: listener => {
        expect(listener).toBe(registered)
        calls.push('remove')
        registered = undefined
      },
    }
    const changes: boolean[] = []
    const emit = () => registered?.()
    const cleanup = listenToArenaColorScheme(query, true, darkMode => changes.push(darkMode))

    expect(changes).toEqual([false])
    expect(calls).toEqual(['add'])
    matches = true
    emit()
    expect(changes).toEqual([false, true])
    cleanup()
    expect(calls).toEqual(['add', 'remove'])
    matches = false
    emit()
    expect(changes).toEqual([false, true])
  })
})

describe('arena clarity helpers', () => {
  it('skips transient canvas boxes that cannot contain the minimum field inset', () => {
    expect(arenaCanvasCanDraw(390, 600)).toBe(true)
    expect(arenaCanvasCanDraw(40.01, 40.01)).toBe(true)
    expect(arenaCanvasCanDraw(40, 600)).toBe(false)
    expect(arenaCanvasCanDraw(0, 0)).toBe(false)
    expect(arenaCanvasCanDraw(Number.NaN, 600)).toBe(false)
    expect(arenaCanvasCanDraw(390, Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('hit-tests an accessible patch target with nearest and stable-id precedence', () => {
    const geometry = { width: 320, height: 320, pad: 20, foodPatchSpread: .12 }
    const radius = arenaPatchCentralRingRadius(geometry.width, geometry.height, geometry.foodPatchSpread)
    expect(arenaPatchHaloRadius(320, 320, .12)).toBeGreaterThan(radius)
    expect(arenaPatchHitRadius(320, 320, .12)).toBe(ARENA_PATCH_MIN_HIT_RADIUS)
    const patches = [
      { id: 8, x: .5, y: .5 },
      { id: 4, x: .5, y: .5 },
      { id: 2, x: .57, y: .5 },
    ]
    expect(hitTestArenaPatch(patches, { x: .5, y: .5 }, geometry)?.id).toBe(4)
    expect(hitTestArenaPatch(patches, { x: .545, y: .5 }, geometry)?.id).toBe(2)
    expect(hitTestArenaPatch(patches, { x: 1.01, y: .5 }, geometry)).toBeUndefined()
    expect(hitTestArenaPatch([...patches, { id: Number.NaN, x: .5, y: .5 }], { x: .5, y: .5 }, geometry)?.id).toBe(4)
    expect(hitTestArenaPatch([{ id: 99, x: 1.04, y: .5 }], { x: 1, y: .5 }, geometry)).toBeUndefined()
    expect(hitTestArenaPatch([{ id: 1, x: .5, y: .5 }], { x: .575, y: .5 }, geometry)?.id).toBe(1)
    expect(hitTestArenaPatch([{ id: 1, x: .5, y: .5 }], { x: .58, y: .5 }, geometry)).toBeUndefined()
  })

  it('gives living creatures precedence over overlapping resource patches', () => {
    const geometry = { width: 320, height: 320, pad: 20, foodPatchSpread: .12 }
    const patches = [{ id: 9, x: .5, y: .5 }]
    expect(hitTestArenaInspection([
      { individualId: 7, x: .5, y: .5, alive: true },
      { individualId: 8, x: .5, y: .5, alive: true },
    ], patches, { x: .5, y: .5 }, geometry)).toEqual({ kind: 'creature', individualId: 7 })
    expect(hitTestArenaInspection([
      { individualId: 7, x: .5, y: .5, alive: false },
    ], patches, { x: .5, y: .5 }, geometry)).toEqual({ kind: 'patch', patchId: 9 })
    expect(hitTestArenaInspection([], patches, { x: .1, y: .1 }, geometry)).toBeNull()
  })

  it('dispatches exactly one mutually exclusive callback for each arena hit', () => {
    const calls: string[] = []
    const selectCreature = (id: number | null) => calls.push(`creature:${id}`)
    const selectPatch = (id: number | null) => calls.push(`patch:${id}`)
    dispatchArenaInspectionHit({ kind: 'creature', individualId: 7 }, selectCreature, selectPatch)
    expect(calls.splice(0)).toEqual(['creature:7'])
    dispatchArenaInspectionHit({ kind: 'patch', patchId: 23 }, selectCreature, selectPatch)
    expect(calls.splice(0)).toEqual(['patch:23'])
    dispatchArenaInspectionHit(null, selectCreature, selectPatch)
    expect(calls.splice(0)).toEqual(['creature:null'])
  })

  it('derives user-facing patch ordinals from sorted ids without exposing ids', () => {
    const patches = [{ id: 42, x: .2, y: .2 }, { id: 7, x: .8, y: .8 }, { id: 19, x: .5, y: .5 }]
    expect(sortArenaPatches(patches).map(patch => patch.id)).toEqual([7, 19, 42])
    expect(arenaPatchOrdinal(patches, 19)).toBe(2)
    expect(arenaPatchOrdinal(patches, 9001)).toBeNull()
  })

  it('keeps the light canvas palette stable and provides a legible dark palette', () => {
    expect(ARENA_COLOR_SCHEME_QUERY).toBe('(prefers-color-scheme: dark)')
    expect(arenaCanvasPalette(false)).toBe(ARENA_LIGHT_PALETTE)
    expect(arenaCanvasPalette(true)).toBe(ARENA_DARK_PALETTE)
    expect(ARENA_LIGHT_PALETTE.fieldStart).toBe('#e8eee4')
    expect(ARENA_LIGHT_PALETTE.fieldEnd).toBe('#dce7d8')
    expect(ARENA_LIGHT_PALETTE.fieldGrid).toBe('rgba(37,75,62,.22)')
    expect(ARENA_LIGHT_PALETTE.patchHaloEnd).toBe('rgba(183,190,88,0)')
    expect(ARENA_LIGHT_PALETTE.patchStockTrack).toContain('rgba')
    expect(ARENA_LIGHT_PALETTE.creatureBodyEnd).toBe('#304b35')
    expect(ARENA_LIGHT_PALETTE.creatureEdge).toBe('rgba(12,29,23,.82)')
    expect(ARENA_DARK_PALETTE.fieldStart).toBe('#14251e')
    expect(ARENA_DARK_PALETTE.fieldEnd).toBe('#1c3428')
    expect(ARENA_DARK_PALETTE.patchHaloEnd).toBe('rgba(205,216,100,0)')
    expect(ARENA_DARK_PALETTE.fieldStart).not.toBe(ARENA_LIGHT_PALETTE.fieldStart)
    expect(ARENA_DARK_PALETTE.obstacleStart).not.toBe(ARENA_DARK_PALETTE.fieldStart)
    expect(ARENA_DARK_PALETTE.foodStart).not.toBe(ARENA_DARK_PALETTE.fieldStart)
    expect(ARENA_DARK_PALETTE.creatureEye).not.toBe(ARENA_DARK_PALETTE.creatureBodyEnd)
    expect(CREATURE_STATE_METADATA.safe.color).toBe('#f8fafc')
    expect(CREATURE_STATE_METADATA.hunting.color).toBe('#fb7185')
  })

  it('keeps patch quality bounded and explains it separately from stock', () => {
    expect(arenaPatchQualityMultiplier(-4, 2)).toBe(0)
    expect(arenaPatchQualityMultiplier(4, 2)).toBe(2)
    expect(arenaPatchQualityMultiplier('bad', Number.NaN)).toBe(1)
    expect(arenaPatchQualityRange([{ qualityBias: -.8 }, { qualityBias: .6 }], .5)).toEqual([.6, 1.3])
    expect(arenaPatchQualityRange([{ qualityBias: -.8 }, { qualityBias: .6 }], 0)).toEqual([1, 1])
    expect(arenaPatchQualityRange([{ qualityBias: Number.NaN }], .5)).toEqual([1, 1])

    const quality = formatArenaPatchQualityDescription('energy-regrowth', .5, [.6, 1.3])
    expect(quality).toContain('Patch quality currently ranges from 0.60× to 1.30×')
    expect(quality).toContain('regrow faster')
    expect(quality).toContain('carries more energy')
    expect(quality).not.toContain('stock arcs')
    expect(formatArenaPatchQualityDescription('energy-regrowth', 0)).toContain('uniform at 1.00×')
    expect(formatArenaPatchQualityDescription('energy-regrowth', .5, [1, 1])).toContain('configured contrast can matter when multiple patches')
    expect(formatArenaPatchQualityDescription('classic', .5, [.8, 1.15])).toBe('')
    expect(ARENA_PATCH_QUALITY_KEY).toContain('quality multiplier')
    expect(ARENA_PATCH_STOCK_KEY).toContain('capacity')
  })

  it('keeps quality rings concentric and labels inside a narrow arena at every edge', () => {
    const edgePatches = [
      arenaPatchQualityGeometry({ width: 320, height: 320, pad: 20, x: 24, y: 24, radius: 42 }),
      arenaPatchQualityGeometry({ width: 320, height: 320, pad: 20, x: 296, y: 24, radius: 42 }),
      arenaPatchQualityGeometry({ width: 320, height: 320, pad: 20, x: 24, y: 296, radius: 42 }),
      arenaPatchQualityGeometry({ width: 320, height: 320, pad: 20, x: 296, y: 296, radius: 42 }),
    ]
    for (const geometry of edgePatches) {
      expect(geometry.ringX - geometry.ringRadius).toBeGreaterThanOrEqual(2)
      expect(geometry.ringX + geometry.ringRadius).toBeLessThanOrEqual(318)
      expect(geometry.ringY - geometry.ringRadius).toBeGreaterThanOrEqual(2)
      expect(geometry.ringY + geometry.ringRadius).toBeLessThanOrEqual(318)
      expect(geometry.labelX - 18).toBeGreaterThanOrEqual(2)
      expect(geometry.labelX + 18).toBeLessThanOrEqual(318)
      expect(geometry.labelY - 7).toBeGreaterThanOrEqual(2)
      expect(geometry.labelY + 7).toBeLessThanOrEqual(318)
    }
    expect(edgePatches.map(geometry => [geometry.ringX, geometry.ringY])).toEqual([[24, 24], [296, 24], [24, 296], [296, 296]])
    expect(edgePatches.map(geometry => geometry.ringRadius)).toEqual([22, 22, 22, 22])
    expect(edgePatches.map(geometry => geometry.labelPlacement)).toEqual(['below', 'below', 'above', 'above'])
  })

  it('offers stable action focus labels and keeps the selected creature visible', () => {
    expect(ARENA_FOCUS_OPTIONS.map(option => option.label)).toEqual([
      'All creatures',
      'Safe at home',
      'Exploring',
      'Finding food',
      'Hunting prey',
      'Fleeing danger',
      'Going home',
    ])
    expect(ARENA_FOCUS_OPTIONS.map(option => option.label)).toEqual(Object.values(ARENA_FOCUS_LABELS))
    expect(arenaCreatureAlpha('all', 'hunting')).toBe(1)
    expect(arenaCreatureAlpha('hunting', 'hunting')).toBe(1)
    expect(arenaCreatureAlpha('hunting', 'foraging')).toBe(ARENA_FOCUS_DIM_ALPHA)
    expect(arenaCreatureAlpha('hunting', 'foraging', true)).toBe(1)
    expect(formatArenaFocusOption('hunting', 4)).toBe('Hunting prey (4)')
    expect(formatArenaFocusOption('all', -3)).toBe('All creatures (0)')
  })

  it('only enables held-target paths for finite, active creatures in the selected focus', () => {
    const creature = (overrides: Partial<ArenaTargetPathCreature> = {}): ArenaTargetPathCreature => ({
      individualId: 7, x: .2, y: .3, alive: true, home: false, mode: 'hunting', targetType: 'prey', targetX: .7, targetY: .8, ...overrides,
    })
    expect(arenaTargetPathEligible('all', creature())).toBe(false)
    expect(arenaTargetPathEligible('foraging', creature())).toBe(false)
    expect(arenaTargetPathEligible('hunting', creature())).toBe(true)
    expect(arenaTargetPathEligible('hunting', creature({ alive: false }))).toBe(false)
    expect(arenaTargetPathEligible('hunting', creature({ home: true }))).toBe(false)
    expect(arenaTargetPathEligible('hunting', creature({ targetType: null }))).toBe(false)
    expect(arenaTargetPathEligible('hunting', creature({ targetX: Number.NaN }))).toBe(false)
    expect(arenaTargetPathEligible('hunting', creature({ targetY: Number.POSITIVE_INFINITY }))).toBe(false)
    expect(arenaTargetPathEligible('hunting', creature({ x: Number.NEGATIVE_INFINITY }))).toBe(false)
    expect(arenaTargetPathEligible('hunting', creature(), 7)).toBe(false)
    expect(arenaTargetPathEligible('hunting', creature(), 8)).toBe(true)
  })

  it('keeps same-lineage relationship rings readable around dimmed bodies', () => {
    expect(arenaCreatureAlpha('hunting', 'foraging')).toBe(ARENA_FOCUS_DIM_ALPHA)
    expect(arenaLineageRingAlpha()).toBe(1)
  })

  it('describes whether action focus is dimming the rest of the arena', () => {
    const all = formatArenaAccessibleDescription(descriptionInput({ focus: 'all', focusCount: 7, livingCreatures: 7 }))
    expect(all).toContain(formatArenaFocusDescription('all', 7, 7))
    expect(all).not.toContain('dimmed')
    expect(formatArenaFocusDescription('all',1,1)).toBe('All living creatures are shown (1).')
    expect(formatArenaFocusDescription('all',0,0)).toBe('All living creatures are shown (0).')

    const hunting = formatArenaAccessibleDescription(descriptionInput({ focus: 'hunting', focusCount: 2, livingCreatures: 7 }))
    expect(hunting).toContain('Focus: Hunting prey; 2 creatures match and 5 others are dimmed.')
    expect(formatArenaFocusDescription('foraging',1,7)).toContain('1 creature matches and 6 others are dimmed.')
    const selectedOutside = formatArenaAccessibleDescription(descriptionInput({focus:'hunting',focusCount:2,livingCreatures:7,hasSelectedCreature:true,selectedOutsideFocus:true}))
    expect(selectedOutside).toContain('2 creatures match and 4 others are dimmed. The selected creature stays highlighted.')
    expect(hunting).toContain(ARENA_FOCUS_TARGET_PATH_KEY)
    expect(formatArenaFocusDescription('safe',2,7)).toContain(ARENA_SAFE_FOCUS_TARGET_PATH_KEY)
    expect(formatArenaFocusDescription('safe',2,7)).not.toContain(ARENA_FOCUS_TARGET_PATH_KEY)
    expect(all).toContain('Choose an action focus to reveal dashed held destinations captured at the last decision for active matches')
    expect(ARENA_SELECTED_OVERLAY_KEY).toContain('dashed path = held destination')
    expect(ARENA_SELECTED_OVERLAY_KEY).toContain('captured at last decision')
    expect(ARENA_SELECTED_OVERLAY_KEY).toContain('solid dot = target still present')
    expect(ARENA_SELECTED_OVERLAY_KEY).toContain('not current position')
    expect(ARENA_SELECTED_OVERLAY_KEY).toContain('× = target gone at its last-known held location')
    expect(ARENA_SELECTED_OVERLAY_KEY).toContain('diamond = waypoint')
    expect(ARENA_FOCUS_TARGET_PATH_KEY).toContain('dashed held destinations captured at last decision')
    expect(ARENA_FOCUS_TARGET_PATH_KEY).toContain('target still present (not current position)')
    expect(ARENA_FOCUS_TARGET_PATH_KEY).toContain('decisions can persist between reaction windows')
    expect(ARENA_FOCUS_TARGET_PATH_KEY).not.toContain('memory')
    expect(ARENA_FOCUS_TARGET_PATH_KEY).not.toContain('kin')
  })

  it('classifies held destinations from current entities without mistaking threats for endpoints', () => {
    const target = (overrides: Partial<{ targetType: World['creatures'][number]['targetType']; targetId: number | null; targetX: number; targetY: number }> = {}) => ({
      targetType: 'food' as const, targetId: 11, targetX: .7, targetY: .8, ...overrides,
    })
    expect(classifyArenaHeldPathEndpoint(target({ targetType: null }), [], [])).toBe('none')
    expect(classifyArenaHeldPathEndpoint(target({ targetX: Number.NaN }), [], [])).toBe('none')
    expect(classifyArenaHeldPathEndpoint(target(), [], [{ id: 11 }])).toBe('live-food')
    expect(classifyArenaHeldPathEndpoint(target(), [], [])).toBe('last-known-food')
    expect(classifyArenaHeldPathEndpoint(target({ targetId: null }), [], [])).toBe('last-known-food')
    expect(classifyArenaHeldPathEndpoint(target({ targetType: 'prey', targetId: 42 }), [{ id: 42, individualId: 7, alive: true }], [])).toBe('live-prey')
    const movedPrey = { id: 42, individualId: 7, alive: true, x: .12, y: .14 }
    expect(classifyArenaHeldPathEndpoint(target({ targetType: 'prey', targetId: 42, targetX: .92, targetY: .88 }), [movedPrey], [])).toBe('live-prey')
    expect(classifyArenaHeldPathEndpoint(target({ targetType: 'prey', targetId: 42 }), [{ id: 42, individualId: 7, alive: false }], [])).toBe('last-known-prey')
    expect(classifyArenaHeldPathEndpoint(target({ targetType: 'prey', targetId: 42 }), [], [])).toBe('last-known-prey')
    expect(classifyArenaHeldPathEndpoint(target({ targetType: 'home', targetId: null }), [], [])).toBe('waypoint')
    expect(classifyArenaHeldPathEndpoint(target({ targetType: 'memory', targetId: null }), [], [])).toBe('waypoint')
    expect(classifyArenaHeldPathEndpoint(target({ targetType: 'explore', targetId: null }), [], [])).toBe('waypoint')
    expect(classifyArenaHeldPathEndpoint(target({ targetType: 'threat', targetId: 42 }), [{ id: 42, individualId: 7, alive: true }], [])).toBe('waypoint')
  })

  it('derives playback phases from population and active creature counts', () => {
    expect(arenaPlaybackStatus({ playing: true, populationCount: 2, activeCount: 2 })).toBe('Running')
    expect(arenaPlaybackStatus({ playing: false, populationCount: 2, activeCount: 2 })).toBe('Paused')
    expect(arenaPlaybackStatus({ playing: true, populationCount: 2, activeCount: 0 })).toBe('Awaiting settlement')
    expect(arenaPlaybackStatus({ playing: false, populationCount: 2, activeCount: 0 })).toBe('Awaiting settlement')
    expect(arenaPlaybackStatus({ playing: true, populationCount: 0, activeCount: 0 })).toBe('Extinct')
    expect(formatArenaDayProgress(2.25, 18, 'Running')).toBe('Day 2.3 / 18.0 · Running')
  })

  it('explains whether an awaiting cohort is home, dead, or post-settlement extinct', () => {
    expect(formatArenaPlaybackDetail({ status: 'Awaiting settlement', populationCount: 2, livingCount: 2 })).toBe('Awaiting settlement. No active creature actions remain; all living creatures are home. Finish generation to settle this cohort.')
    expect(formatArenaPlaybackDetail({ status: 'Awaiting settlement', populationCount: 2, livingCount: 0 })).toBe('Awaiting settlement. All creatures in this generation are dead, but the generation has not been recorded yet. Finish generation to record it, or use Founder migration to rescue the run.')
    expect(formatArenaPlaybackDetail({ status: 'Extinct', populationCount: 0, livingCount: 0 })).toBe('Extinct. The last settlement produced no creatures. Use Founder migration to rescue this run or restart.')
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
    expect(description).toContain('select a resource patch to inspect its live food and production')
    expect(description).toContain('use the Inspect selector')
    expect(description).not.toContain(ARENA_SELECTED_OVERLAY_KEY)
  })

  it('announces the bounded quality range only for ecological worlds', () => {
    const ecological = formatArenaAccessibleDescription(descriptionInput({ patchQualityVariation: .5, patchQualityRange: [.6, 1.3] }))
    expect(ecological).toContain('Patch quality currently ranges from 0.60× to 1.30×')
    expect(ecological).toContain('Greener/brighter patches regrow faster')

    const classic = formatArenaAccessibleDescription(descriptionInput({ ecologyMode: 'classic', patchQualityVariation: .5, patchQualityRange: [.6, 1.3] }))
    expect(classic).not.toContain('Patch quality')
    expect(classic).not.toContain('regrow faster')
    expect(classic).not.toContain('stock')
  })

  it('includes playback status and its stable phase detail in the canvas description', () => {
    const detail = formatArenaPlaybackDetail({ status: 'Awaiting settlement', populationCount: 2, livingCount: 2 })
    const description = formatArenaAccessibleDescription(descriptionInput({ playbackStatus: 'Awaiting settlement', playbackDetail: detail }))
    expect(description).toContain('Awaiting settlement')
    expect(description).toContain('all living creatures are home')
    expect(description).toContain('Finish generation to settle this cohort')
  })

  it('announces creature inspection selection and clearing without live state details', () => {
    expect(formatArenaSelectionStatus(7)).toBe('Individual 7 selected for inspection.')
    expect(formatArenaSelectionStatus(null)).toBe('Creature inspection cleared. No creature selected.')
    expect(formatArenaInspectionStatus(7, null, null)).toBe('Individual 7 selected for inspection. Resource-patch inspection cleared.')
    expect(formatArenaInspectionStatus(null, 42, 2)).toBe('Resource patch 2 selected for inspection. Creature inspection cleared.')
    expect(formatArenaInspectionStatus(null, null, null)).toBe('Creature and resource-patch inspection cleared. Nothing is selected.')
  })

  it('describes selected overlays while keeping classic mode free of patch-ring claims', () => {
    const selectedEcological = formatArenaAccessibleDescription(descriptionInput({ hasSelectedCreature: true }))
    expect(selectedEcological).toContain(ARENA_PATCH_STOCK_KEY)
    expect(selectedEcological).toContain(ARENA_SELECTED_OVERLAY_KEY)

    const selectedPatch = formatArenaAccessibleDescription(descriptionInput({ hasSelectedPatch: true }))
    expect(selectedPatch).not.toContain('Select a creature to reveal')

    const selectedClassic = formatArenaAccessibleDescription(descriptionInput({ ecologyMode: 'classic', hasSelectedCreature: true }))
    expect(selectedClassic).toContain(ARENA_SELECTED_OVERLAY_KEY)
    expect(selectedClassic).not.toContain(ARENA_PATCH_STOCK_KEY)
    expect(selectedClassic).toContain('generation pulse')
  })

  it('formats runtime targets as user-facing individual and food labels', () => {
    expect(formatSelectedTarget({ targetType: 'prey', targetId: 42 }, [{ id: 42, individualId: 7, alive: true }])).toBe('Prey · Individual 7')
    expect(formatSelectedTarget({ targetType: 'threat', targetId: 43, targetX: .7, targetY: .8 }, [{ id: 43, individualId: 8, alive: true }])).toBe('Threat · Individual 8 · path ends at an escape waypoint')
    expect(formatSelectedTarget({ targetType: 'threat', targetId: 43 }, [{ id: 43, individualId: 8, alive: true }])).toBe('Threat · Individual 8')
    expect(formatSelectedTarget({ targetType: 'food', targetId: 901 }, [], [{ id: 901 }])).toBe('Food item')
    expect(formatSelectedTarget({ targetType: 'food', targetId: 902 }, [], [{ id: 902, energy: 28.6 }])).toBe('Food item · 28.6 energy')
    expect(formatSelectedTarget({ targetType: 'food', targetId: 903 }, [], [{ id: 903, energy: Number.NaN }])).toBe('Food item')
    expect(formatSelectedTarget({ targetType: null, targetId: null }, [])).toBe('None')
  })

  it('hides missing, dead, or disappeared entity identifiers', () => {
    expect(formatSelectedTarget({ targetType: 'prey', targetId: 42, targetX: .4, targetY: .5 }, [{ id: 42, individualId: 7, alive: false }])).toBe('Prey target gone · held location shown')
    expect(formatSelectedTarget({ targetType: 'threat', targetId: 99, targetX: .4, targetY: .5 }, [])).toBe('Threat target gone · path ends at an escape waypoint')
    expect(formatSelectedTarget({ targetType: 'food', targetId: 901 }, [], [])).toBe('Food target · current status unavailable')
    expect(formatSelectedTarget({ targetType: 'food', targetId: 901, targetX: .4, targetY: .5 }, [], [])).toBe('Food target gone · held location shown')
    expect(formatSelectedTarget({ targetType: 'prey', targetId: 42 }, [{ id: 42, individualId: 7, alive: false }])).toBe('Prey target · current status unavailable')
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

  it('describes selected active telemetry from perception through the current action', () => {
    const world = observedWorld()
    const internalCreatureId = world.creatures[0].id
    const internalFoodId = world.food[0]?.id
    const path = formatObservedPath(world, { ticks: 1, stop: 'beat' }, observedContext(world))
    expect(path).toContain('perception recorded 1/2 creatures and 2/4 food')
    expect(path).toContain('decision recorded as food (reason noted: Nearby food utility)')
    expect(path).toContain('current action: Finding food · target: Food item')
    expect(path).not.toContain(String(internalCreatureId))
    if (internalFoodId !== undefined) expect(path).not.toContain(String(internalFoodId))
  })

  it('adds captured decision basis and provenance while retaining legacy copy', () => {
    const world = observedWorld()
    const creature = world.creatures[0]
    creature.decisionSummary = {
      ...creature.decisionSummary!,
      chosenTargetId: creature.targetId,
      selectionBasis: 'urgent-override',
      decidedAt: { generation: 1, dayTime: .025, reactionWindow: 0 },
    }
    const path = formatObservedPath(world, { ticks: 1, stop: 'beat' }, observedContext(world))
    expect(path).toContain('basis: urgent safety override')
    expect(path).toContain('captured Generation 1 · day 0.03 · reaction window 0')
    const legacy = observedWorld()
    expect(formatObservedPath(legacy, { ticks: 1, stop: 'beat' }, observedContext(legacy))).not.toContain('basis:')
    expect(formatObservedDecisionMetadata({ selectionBasis: 'unknown' as never, decidedAt: undefined })).toBe('')
  })

  it('prompts inspection without inventing telemetry when nothing is selected', () => {
    const world = observedWorld()
    world.inspectedIndividualId = null
    const path = formatObservedPath(world, { ticks: 1, stop: 'beat' }, { selectedIndividualId: null, selectedWasActive: false })
    expect(path).toContain('Inspect a creature, then choose Next action')
    expect(path).not.toContain('perception recorded')
    expect(path).not.toContain('creatures and')
  })

  it('names missing telemetry and home state explicitly', () => {
    const missing = observedWorld()
    delete missing.creatures[0].perceptionDiagnostics
    delete missing.creatures[0].decisionSummary
    const missingPath = formatObservedPath(missing, { ticks: 1, stop: 'beat' }, observedContext(missing))
    expect(missingPath).toContain('perception telemetry is unavailable')
    expect(missingPath).toContain('decision telemetry is unavailable')

    const home = observedWorld()
    delete home.creatures[0].perceptionDiagnostics
    delete home.creatures[0].decisionSummary
    home.creatures[0].home = true
    const homePath = formatObservedPath(home, { ticks: 1, stop: 'beat' }, observedContext(home, false))
    expect(homePath).toContain('already home at step start')
    expect(homePath).toContain('no new decision path was observed')
  })

  it('summarizes a generation boundary from the latest ledger and exact next population', () => {
    const world = observedWorld()
    world.generation = 5
    world.ledger = [{
      generation: 4,
      startPopulation: 8,
      outcomes: { survived: 3, hunted: 2, energy: 1, unfed: 1, late: 1, aged: 0 },
      foodAtStart: 12,
      foodProduced: 4,
      foodRemoved: 1,
      foodConsumed: 7,
      foodRemaining: 8,
      preyConsumed: 1,
      attackAttempts: 5,
      attackSuccesses: 2,
      attackFailures: 3,
      birthsEligible: 4,
      birthsAdmitted: 2,
      birthsCapped: 0,
      selection: {} as never,
      selectionByOutcome: {} as never,
    }]
    const path = formatObservedPath(world, { ticks: 4, stop: 'generation-boundary' }, observedContext(world))
    expect(path).toContain('Generation 4 recorded 7 food items consumed')
    expect(path).toContain('5 attack attempts')
    expect(path).toContain('2 attack successes')
    expect(path).toContain('3 survivors')
    expect(path).toContain('2 births')
    expect(path).toContain('exact next population: 5')
  })

  it('adds a maturity observation only for a positive, reconciled telemetry count', () => {
    const makeBoundaryLedger = (birthsImmature: unknown): World['ledger'][number] => ({
      generation: 4,
      startPopulation: 3,
      outcomes: { survived: 3, hunted: 0, energy: 0, unfed: 0, late: 0, aged: 0 },
      foodAtStart: 0,
      foodProduced: 0,
      foodRemoved: 0,
      foodConsumed: 0,
      foodRemaining: 0,
      preyConsumed: 0,
      attackAttempts: 0,
      attackSuccesses: 0,
      attackFailures: 0,
      birthsEligible: 1,
      birthsAdmitted: 1,
      birthsCapped: 0,
      birthsImmature: birthsImmature as never,
      selection: {} as never,
      selectionByOutcome: {} as never,
    })
    const world = observedWorld()
    world.ledger = [makeBoundaryLedger(1)]
    const singular = formatObservedPath(world, { ticks: 1, stop: 'generation-boundary' }, observedContext(world))
    expect(singular).toContain('1 energy-ready survivor waited for maturity')

    world.ledger = [makeBoundaryLedger(2)]
    const plural = formatObservedPath(world, { ticks: 1, stop: 'generation-boundary' }, observedContext(world))
    expect(plural).toContain('2 energy-ready survivors waited for maturity')

    for (const value of [0, undefined, null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      world.ledger = [makeBoundaryLedger(value)]
      const path = formatObservedPath(world, { ticks: 1, stop: 'generation-boundary' }, observedContext(world))
      expect(path).not.toContain('energy-ready')
      expect(path).not.toMatch(/NaN|Infinity|undefined/)
    }
    world.ledger = [{ ...makeBoundaryLedger(1), birthsEligible: 3 }]
    expect(formatObservedPath(world, { ticks: 1, stop: 'generation-boundary' }, observedContext(world))).not.toContain('energy-ready')
  })

  it('handles no-active and bounded results without claiming an unobserved decision', () => {
    const noActive = observedWorld()
    noActive.inspectedIndividualId = null
    for (const creature of noActive.creatures) creature.home = true
    const noActivePath = formatObservedPath(noActive, { ticks: 0, stop: 'no-active' }, { selectedIndividualId: null, selectedWasActive: false })
    expect(noActivePath).toContain('Awaiting settlement')
    expect(noActivePath).toContain('all living creatures are home')
    expect(noActivePath).toContain('Finish generation to settle this cohort')

    const extinct = observedWorld()
    for (const creature of extinct.creatures) creature.alive = false
    const awaitingDeadPath = formatObservedPath(extinct, { ticks: 0, stop: 'no-active' }, { selectedIndividualId: null, selectedWasActive: false })
    expect(awaitingDeadPath).toContain('Awaiting settlement')
    expect(awaitingDeadPath).toContain('All creatures in this generation are dead')
    expect(awaitingDeadPath).not.toContain('the population is extinct')

    extinct.creatures = []
    expect(formatObservedPath(extinct, { ticks: 0, stop: 'no-active' }, { selectedIndividualId: null, selectedWasActive: false })).toContain('Extinct. The last settlement produced no creatures')

    const boundedWorld = observedWorld()
    const bounded = formatObservedPath(boundedWorld, { ticks: 10, stop: 'bounded' }, observedContext(boundedWorld))
    expect(bounded).toContain('10 ticks reaction-window bound')
    expect(bounded).toContain('perception recorded 1/2 creatures and 2/4 food')
  })

  it('distinguishes a selected creature stopping from the whole population stopping', () => {
    const home = observedWorld()
    home.creatures[0].home = true
    const homePath = formatObservedPath(home, { ticks: 1, stop: 'selected-inactive' }, observedContext(home))
    expect(homePath).toContain('reached home; other active creatures remain')
    expect(homePath).toContain('manual step stopped for this selection')
    expect(homePath).toContain('other active creatures remain')
    expect(homePath).not.toContain('No active creatures remain')
    expect(homePath).not.toContain('beat')

    const dead = observedWorld()
    dead.creatures[0].alive = false
    const deadPath = formatObservedPath(dead, { ticks: 1, stop: 'selected-inactive' }, observedContext(dead))
    expect(deadPath).toContain('died; other active creatures remain')
    expect(deadPath).not.toContain('No active creatures remain')

    const missing = observedWorld()
    missing.creatures = missing.creatures.slice(1)
    const missingPath = formatObservedPath(missing, { ticks: 1, stop: 'selected-inactive' }, observedContext(missing))
    expect(missingPath).toContain('became unavailable; other active creatures remain')
    expect(missingPath).toContain('other active creatures remain')
  })

  it('keeps the selected terminal outcome when no active creatures remain', () => {
    const dead = observedWorld()
    const deadContext = observedContext(dead)
    dead.creatures[0].alive = false
    dead.creatures[1].home = true
    const deadPath = formatObservedPath(dead, { ticks: 1, stop: 'no-active' }, deadContext)
    expect(deadPath).toContain('selected creature died')
    expect(deadPath).toContain('Awaiting settlement')
    expect(deadPath).toContain('all living creatures are home')

    const home = observedWorld()
    const homeContext = observedContext(home)
    home.creatures[0].home = true
    home.creatures[1].home = true
    delete home.creatures[0].perceptionDiagnostics
    delete home.creatures[0].decisionSummary
    const homePath = formatObservedPath(home, { ticks: 1, stop: 'no-active' }, homeContext)
    expect(homePath).toContain('selected creature reached home during this step')
    expect(homePath).toContain('Awaiting settlement')
    expect(homePath).toContain('all living creatures are home')
  })

  it('reports a generation boundary without fabricating a missing ledger', () => {
    const world = observedWorld()
    world.generation = 3
    world.ledger = []
    expect(formatObservedPath(world, { ticks: 1, stop: 'generation-boundary' }, observedContext(world))).toContain('no generation ledger is available')
  })

  it('preserves an inspected returning creature path when the step reaches home', () => {
    const world = observedWorld()
    const returning = world.creatures[0]
    const internalCreatureId = returning.id
    const context = observedContext(world)
    returning.x = returning.homeX
    returning.y = returning.homeY
    returning.mode = 'returning'
    returning.returning = true
    for (const creature of world.creatures.slice(1)) creature.home = true

    const result = advanceToNextAction(world)
    const path = formatObservedPath(world, result, context)
    expect(result.stop).toBe('no-active')
    expect(path).toContain('perception recorded 1/2 creatures and 2/4 food')
    expect(path).toContain('decision recorded as food (reason noted: Nearby food utility)')
    expect(path).toContain('current action: Safe at home · target: Food item')
    expect(path).toContain('It reached home during this step.')
    expect(path).not.toContain(String(internalCreatureId))
  })

  it('does not replay retained telemetry for a creature already home at step start', () => {
    const world = observedWorld()
    const selected = world.creatures[0]
    selected.id = 987654
    const context: NextActionContext = { selectedIndividualId: selected.individualId, selectedWasActive: false }
    selected.home = true
    const result = advanceToNextAction(world)
    const active = world.creatures[1]
    world.inspectedIndividualId = null
    const path = formatObservedPath(world, result, context)
    expect(active.alive && !active.home).toBe(true)
    expect(path).toContain('already home at step start')
    expect(path).toContain('no new decision path was observed')
    expect(path).not.toContain('perception recorded')
    expect(path).not.toContain('Nearby food utility')
    expect(path).not.toContain('987654')
  })

  it('keeps zero-count ledger grammar plural and avoids raw identifiers', () => {
    const world = observedWorld()
    world.generation = 2
    world.ledger = [{
      generation: 1,
      startPopulation: 0,
      outcomes: { survived: 0, hunted: 0, energy: 0, unfed: 0, late: 0, aged: 0 },
      foodAtStart: 0,
      foodProduced: 0,
      foodRemoved: 0,
      foodConsumed: 0,
      foodRemaining: 0,
      preyConsumed: 0,
      attackAttempts: 0,
      attackSuccesses: 0,
      attackFailures: 0,
      birthsEligible: 0,
      birthsAdmitted: 0,
      birthsCapped: 0,
      selection: {} as never,
      selectionByOutcome: {} as never,
    }]
    const path = formatObservedPath(world, { ticks: 1, stop: 'generation-boundary' }, observedContext(world))
    expect(path).toContain('0 food items consumed')
    expect(path).toContain('0 attack attempts')
    expect(path).toContain('0 attack successes')
    expect(path).toContain('0 survivors')
    expect(path).toContain('0 births')
    expect(path).toContain('exact next population: 0')
    expect(path).not.toContain('undefined')
  })
})
