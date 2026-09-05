import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ARENA_COLOR_SCHEME_QUERY,
  ARENA_ACTIVITY_SPOTLIGHT_COMPACT_LIMIT,
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
  ARENA_SELECTED_OVERLAY_KEY,
  ArenaActivitySpotlightKey,
  arenaSelectedCreatureCalloutGeometry,
  arenaCanvasCanDraw,
  arenaCanvasPalette,
  arenaActivitySpotlightAlpha,
  arenaActivitySpotlightHaloRect,
  arenaActivitySpotlightSiteGeometry,
  arenaActivitySpotlightOverlayAnchors,
  arenaActivitySpotlightTagGeometry,
  arenaActivitySpotlightWindowTicks,
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
  formatArenaActivitySpotlightDescription,
  formatArenaActivitySpotlightKey,
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
  resolveArenaActivitySpotlight,
  deriveArenaActivitySpotlightCue,
  deriveArenaActivitySpotlightTags,
  deriveArenaSelectedCreatureCallout,
  formatArenaActivitySpotlightCompact,
  formatArenaActivitySpotlightTagLabel,
  sortArenaPatches,
  showArenaQuickStart,
  type ArenaAccessibleDescriptionInput,
  type ArenaTargetPathCreature,
} from './ArenaCanvas'
import { createWorld, defaultConfig } from '../simulation/engine'
import { advanceToNextAction } from '../simulation/scheduler'
import type { NextActionContext } from '../simulation/scheduler'
import type { World, WorldActivityEntry } from '../simulation/types'
import { normalizeActivityMoment } from './SimulationActivity'
import { isActivityReviewRetained, isSameActivityReview } from './ActivityReviewModel'

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

const spotlightMoment = (overrides: Partial<WorldActivityEntry> = {}): WorldActivityEntry => ({
  sequence: 1,
  generation: 3,
  day: 1,
  tick: 200,
  kind: 'food-collected',
  summary: 'Individual 1 collected food.',
  count: 1,
  location: [.4, .5],
  actorIds: [1],
  ...overrides,
})

const spotlightWorld = (): World => {
  const world = createWorld({ ...defaultConfig, initialPopulation: 12, reactionTime: .15 })
  world.generation = 3
  world.tickIndex = 200
  world.activity = []
  return world
}

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

describe('arena activity spotlight', () => {
  it('reviews an older retained record at full opacity and restores the latest when released', () => {
    const world = spotlightWorld()
    const earlier = spotlightMoment({ sequence: 1, tick: 1 })
    world.activity = [earlier, spotlightMoment({ sequence: 5, actorIds: [2] })]
    const review = normalizeActivityMoment(earlier, 0)!
    expect(resolveArenaActivitySpotlight(world, review)).toMatchObject({ sequence: 1, alpha: 1, reviewed: true, actors: [{ individualId: 1 }] })
    world.tickIndex += 500
    expect(resolveArenaActivitySpotlight(world, review)?.alpha).toBe(1)
    world.tickIndex = 200
    expect(resolveArenaActivitySpotlight(world, null)?.sequence).toBe(5)
    expect(renderToStaticMarkup(createElement(ArenaActivitySpotlightKey, { world, reviewedMoment: review, compact: true }))).toContain('Reviewed ·')
  })

  it('retains identity after array movement but rejects eviction and duplicate-sequence impostors', () => {
    const world = spotlightWorld()
    const entry = spotlightMoment()
    const review = normalizeActivityMoment(entry, 4)!
    world.activity = [spotlightMoment({ sequence: 5 }), entry]
    expect(isActivityReviewRetained(world, review)).toBe(true)
    expect(resolveArenaActivitySpotlight(world, review)).toMatchObject({ sourceIndex: 1, sequence: 1 })
    world.activity = [entry]
    expect(resolveArenaActivitySpotlight(world, review)?.sourceIndex).toBe(0)
    expect(isSameActivityReview(review, { ...review, sourceIndex: 99, summary: ` ${review.summary} ` })).toBe(true)
    for (const impostor of [{ ...entry, summary: 'Another event.' }, { ...entry, kind: 'reached-home' as const }, { ...entry, tick: 199 }, { ...entry, generation: 2 }]) {
      world.activity = [impostor, spotlightMoment({ sequence: 5 })]
      expect(isActivityReviewRetained(world, review)).toBe(false)
      expect(resolveArenaActivitySpotlight(world, review)).toBeNull()
    }
  })

  it('reviews previous-generation sites without inventing dead or absent current actor halos', () => {
    const world = spotlightWorld()
    world.creatures[0].alive = false
    const entry = spotlightMoment({ generation: 2, tick: 900, actorIds: [1, 9999] })
    world.activity = [entry, spotlightMoment({ sequence: 5, actorIds: [2] })]
    const review = normalizeActivityMoment(entry, 0)!
    const spotlight = resolveArenaActivitySpotlight(world, review)!
    expect(spotlight).toMatchObject({ generation: 2, alpha: 1, location: { x: .4, y: .5 }, actors: [] })
    expect(formatArenaActivitySpotlightDescription(spotlight)).toContain('no involved actor has a current live arena position')
    delete entry.location
    expect(resolveArenaActivitySpotlight(world, review)).toBeNull()
    entry.actorIds = [2]
    expect(resolveArenaActivitySpotlight(world, review)).toMatchObject({ location: null, actors: [{ individualId: 2 }] })
    expect(formatArenaActivitySpotlightDescription(resolveArenaActivitySpotlight(world, review)!)).toContain('Reviewed event actor halo')
  })

  it('tolerates hostile retention data and refuses unstable missing-sequence legacy identity', () => {
    const entry = spotlightMoment()
    const review = normalizeActivityMoment(entry, 0)!
    const hostile = new Proxy({}, { get() { throw new Error('hostile') } })
    expect(isSameActivityReview(hostile, review)).toBe(false)
    expect(isActivityReviewRetained(hostile, review)).toBe(false)
    expect(isActivityReviewRetained({ activity: [hostile, entry] }, review)).toBe(true)
    expect(isActivityReviewRetained({ activity: new Proxy([], { get() { return Infinity } }) }, review)).toBe(false)
    const legacy = { ...entry, sequence: undefined }
    expect(isActivityReviewRetained({ activity: [legacy] }, review)).toBe(false)
    expect(resolveArenaActivitySpotlight({ ...spotlightWorld(), activity: [legacy] }, review)).toBeNull()
  })

  it('chooses the newest eligible actor record even when a newer aggregate and array order disagree', () => {
    const world = spotlightWorld()
    world.activity = [
      spotlightMoment({ sequence: 14, kind: 'generation-settlement', actorIds: [3] }),
      spotlightMoment({ sequence: 12, actorIds: [2] }),
      spotlightMoment({ sequence: 10, actorIds: [1] }),
    ]

    expect(resolveArenaActivitySpotlight(world)).toMatchObject({ sequence: 12, kind: 'food-collected', tick: 200, age: 0, location: { x: .4, y: .5 }, actors: [{ individualId: 2 }] })
    expect(deriveArenaActivitySpotlightCue(world)?.compact).toContain('Highlighted · Food collected')
    expect(deriveArenaActivitySpotlightCue(world)?.compact).not.toContain('Latest ·')
  })

  it('requires the current generation and accepts only the exact recent-age boundary', () => {
    const world = spotlightWorld()
    const windowTicks = arenaActivitySpotlightWindowTicks(world.config.reactionTime)
    world.activity = [
      spotlightMoment({ sequence: 16, generation: 2, actorIds: [1] }),
      spotlightMoment({ sequence: 15, tick: world.tickIndex + 1, actorIds: [1] }),
      spotlightMoment({ sequence: 14, tick: world.tickIndex - windowTicks - 1, actorIds: [1] }),
      spotlightMoment({ sequence: 13, tick: world.tickIndex - windowTicks, actorIds: [1] }),
    ]
    expect(resolveArenaActivitySpotlight(world)).toMatchObject({ sequence: 13, tick: world.tickIndex - windowTicks, age: windowTicks })

    world.activity = [spotlightMoment({ sequence: 17, generation: 2, actorIds: [1] })]
    expect(resolveArenaActivitySpotlight(world)).toBeNull()
  })

  it('orders and deduplicates attack roles before generic actor ids', () => {
    const world = spotlightWorld()
    world.activity = [spotlightMoment({ kind: 'attack-success', attackerId: 2, preyId: 1, actorIds: [9, 2, 1, 3, 9] })]
    expect(resolveArenaActivitySpotlight(world)?.actors).toMatchObject([
      { individualId: 2, role: 'attacker', roleLabel: 'Attacker' },
      { individualId: 1, role: 'prey', roleLabel: 'Prey' },
      { individualId: 9, role: 'involved individual', roleLabel: 'Involved individual' },
      { individualId: 3, role: 'involved individual', roleLabel: 'Involved individual' },
    ])
  })

  it('derives readable role tags only for one- and two-actor spotlights', () => {
    const tagsFor = (entry: WorldActivityEntry) => {
      const world = spotlightWorld()
      world.activity = [entry]
      return deriveArenaActivitySpotlightTags(resolveArenaActivitySpotlight(world))
    }

    expect(tagsFor(spotlightMoment({ kind: 'attack-failure', attackerId: 2, preyId: 3, actorIds: [2, 3] })).map(tag => tag.label)).toEqual([
      'Attacker · Individual 2',
      'Prey · Individual 3',
    ])
    expect(tagsFor(spotlightMoment({ kind: 'food-collected', actorIds: [4] }))[0]?.label).toBe('Collector · Individual 4')
    expect(tagsFor(spotlightMoment({ kind: 'reached-home', actorIds: [5] }))[0]?.label).toBe('Returning · Individual 5')
    expect(tagsFor(spotlightMoment({ kind: 'intervention', actorIds: [6] }))[0]?.label).toBe('Involved · Individual 6')
    expect(tagsFor(spotlightMoment({ kind: 'intervention', actorIds: [1, 2, 3] }))).toEqual([])
    expect(formatArenaActivitySpotlightTagLabel({ role: 'prey', individualId: 9 })).toBe('Prey · Individual 9')

    const throwing = new Proxy({}, { get() { throw new Error('malformed spotlight actor') } })
    expect(() => deriveArenaActivitySpotlightTags({ actors: [throwing, { role: 'collector', individualId: 7, x: .4, y: .5, size: 1 }] })).not.toThrow()
    expect(deriveArenaActivitySpotlightTags({ actors: [throwing, { role: 'collector', individualId: 7, x: .4, y: .5, size: 1 }] }).map(tag => tag.label)).toEqual(['Collector · Individual 7'])
    expect(deriveArenaActivitySpotlightTags({ actors: [{ role: 'collector', individualId: 7, x: Number.NaN, y: .5, size: 1 }] })).toEqual([])
  })

  it('keeps role tags outside their halo and inside compact and desktop fields', () => {
    const cases = [
      { width: 300, height: 276, pad: 20, compact: true },
      { width: 900, height: 600, pad: 32, compact: false },
    ] as const
    for (const dimensions of cases) {
      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [.5, .5]] as const) {
        const geometry = arenaActivitySpotlightTagGeometry({ ...dimensions, x, y, size: 1, individualId: 25, role: 'attacker' })
        expect(geometry).not.toBeNull()
        const tag = geometry!
        const right = dimensions.width - dimensions.pad
        const bottom = dimensions.height - dimensions.pad
        expect(tag.x).toBeGreaterThanOrEqual(dimensions.pad)
        expect(tag.y).toBeGreaterThanOrEqual(dimensions.pad)
        expect(tag.x + tag.width).toBeLessThanOrEqual(right)
        expect(tag.y + tag.height).toBeLessThanOrEqual(bottom)
        const nearestX = Math.max(tag.x, Math.min(tag.x + tag.width, tag.actorX))
        const nearestY = Math.max(tag.y, Math.min(tag.y + tag.height, tag.actorY))
        expect(Math.hypot(tag.actorX - nearestX, tag.actorY - nearestY)).toBeGreaterThanOrEqual(tag.haloRadius + (dimensions.compact ? 2 : 6))
        for (const value of [tag.leaderStartX, tag.leaderStartY, tag.leaderEndX, tag.leaderEndY]) {
          expect(Number.isFinite(value)).toBe(true)
        }
        expect(tag.leaderStartX).toBeGreaterThanOrEqual(dimensions.pad)
        expect(tag.leaderStartX).toBeLessThanOrEqual(right)
        expect(tag.leaderStartY).toBeGreaterThanOrEqual(dimensions.pad)
        expect(tag.leaderStartY).toBeLessThanOrEqual(bottom)
        expect(tag.leaderEndX).toBeGreaterThanOrEqual(dimensions.pad)
        expect(tag.leaderEndX).toBeLessThanOrEqual(right)
        expect(tag.leaderEndY).toBeGreaterThanOrEqual(dimensions.pad)
        expect(tag.leaderEndY).toBeLessThanOrEqual(bottom)
      }
    }

    const attacker = arenaActivitySpotlightTagGeometry({ width: 900, height: 600, pad: 32, x: .5, y: .5, size: 2.8, individualId: 2, role: 'attacker' })!
    const prey = arenaActivitySpotlightTagGeometry({ width: 900, height: 600, pad: 32, x: .5, y: .5, size: 2.8, individualId: 3, role: 'prey', occupied: [attacker] })
    expect(prey).not.toBeNull()
    expect(prey!.x + prey!.width <= attacker.x || prey!.x >= attacker.x + attacker.width || prey!.y + prey!.height <= attacker.y || prey!.y >= attacker.y + attacker.height).toBe(true)
    const compactAnchors = [
      { x: 10, y: 154, width: 280, height: 70 },
      { x: 12, y: 216, width: 205, height: 48 },
      { x: 12, y: 12, width: 276, height: 120 },
    ]
    const detached = arenaActivitySpotlightTagGeometry({ width: 300, height: 276, pad: 20, x: .65, y: .9, individualId: 25, role: 'attacker', compact: true, label: 'Attacker 25', anchors: compactAnchors })
    expect(detached).not.toBeNull()
    expect(detached?.placement).toMatch(/^detached-/)
    expect(compactAnchors.every(anchor => detached!.x + detached!.width <= anchor.x || detached!.x >= anchor.x + anchor.width || detached!.y + detached!.height <= anchor.y || detached!.y >= anchor.y + anchor.height)).toBe(true)
    expect(arenaActivitySpotlightTagGeometry({ width: 300, height: 276, pad: 20, x: .5, y: .5, individualId: 1, role: 'collector', occupied: [{ x: 20, y: 20, width: 260, height: 236 }] })).toBeNull()
    expect(arenaActivitySpotlightTagGeometry({ width: Number.NaN, height: 276, pad: 20, x: .5, y: .5, individualId: 1, role: 'collector' })).toBeNull()
    expect(arenaActivitySpotlightTagGeometry({ width: 300, height: 276, pad: 20, x: -1, y: .5, individualId: 1, role: 'collector' })).toBeNull()

    const site = arenaActivitySpotlightSiteGeometry({ width: 300, height: 276, pad: 20, compact: true, x: .5, y: .5, anchors: compactAnchors })
    expect(site).not.toBeNull()
    expect(site?.actorX).toBe(150)
    expect(site?.actorY).toBe(138)
    expect(compactAnchors.every(anchor => site!.x + site!.width <= anchor.x || site!.x >= anchor.x + anchor.width || site!.y + site!.height <= anchor.y || site!.y >= anchor.y + anchor.height)).toBe(true)

    const selectedCallout = arenaSelectedCreatureCalloutGeometry({ width: 300, height: 276, pad: 20, compact: true, x: .72, y: .95, size: 1 })
    const selectedHalo = arenaActivitySpotlightHaloRect(300, 276, 20, { x: .72, y: .95, size: 1 })
    const remainingActor = arenaActivitySpotlightTagGeometry({
      width: 300,
      height: 276,
      pad: 20,
      compact: true,
      x: .82,
      y: .95,
      size: 1,
      individualId: 6,
      role: 'prey',
      label: 'Prey 6',
      occupied: [selectedCallout, selectedHalo],
      anchors: compactAnchors,
    })
    expect(remainingActor).not.toBeNull()
    for (const obstacle of [selectedCallout, selectedHalo]) {
      expect(remainingActor!.x + remainingActor!.width <= obstacle.x || remainingActor!.x >= obstacle.x + obstacle.width || remainingActor!.y + remainingActor!.height <= obstacle.y || remainingActor!.y >= obstacle.y + obstacle.height).toBe(true)
    }
  })

  it('keeps historical site labels near crowded bottom actors and clear of selected callouts', () => {
    for (const dimensions of [
      { width: 1392, height: 522, pad: 32, compact: false },
      { width: 900, height: 600, pad: 32, compact: false },
      { width: 300, height: 276, pad: 20, compact: true },
    ]) {
      const { width, height, pad, compact } = dimensions
      const occupied = [
        arenaSelectedCreatureCalloutGeometry({ ...dimensions, x: .65, y: .95, size: 1 }),
        arenaActivitySpotlightHaloRect(width, height, pad, { x: .65, y: .95, size: 1 }),
        arenaActivitySpotlightHaloRect(width, height, pad, { x: .61, y: .95, size: 1 }),
      ]
      const anchors = [{ x: 12, y: height - 60, width: compact ? 110 : 240, height: 48 }]
      const site = arenaActivitySpotlightSiteGeometry({ ...dimensions, x: .61, y: .97, occupied, anchors })!
      expect(site).not.toBeNull()
      expect(site.actorX).toBe(pad + .61 * (width - 2 * pad))
      expect(site.actorY).toBe(pad + .97 * (height - 2 * pad))
      expect(site.x).toBeGreaterThanOrEqual(pad)
      expect(site.y).toBeGreaterThanOrEqual(pad)
      expect(site.x + site.width).toBeLessThanOrEqual(width - pad)
      expect(site.y + site.height).toBeLessThanOrEqual(height - pad)
      const gap = compact ? 2 : 6
      for (const obstacle of [...occupied, ...anchors]) {
        expect(site.x + site.width + gap <= obstacle.x || site.x >= obstacle.x + obstacle.width + gap || site.y + site.height + gap <= obstacle.y || site.y >= obstacle.y + obstacle.height + gap).toBe(true)
      }
      // There is room immediately beside or above the occupied area; using a
      // distant field edge would make the leader misleadingly span the arena.
      const nearestX = Math.max(site.x, Math.min(site.x + site.width, site.actorX))
      const nearestY = Math.max(site.y, Math.min(site.y + site.height, site.actorY))
      expect(Math.hypot(site.actorX - nearestX, site.actorY - nearestY)).toBeLessThan(110)
      expect(Math.hypot(site.actorX - nearestX, site.actorY - nearestY)).toBeGreaterThanOrEqual(site.haloRadius + gap)
    }
    expect(arenaActivitySpotlightSiteGeometry({ width: 300, height: 276, pad: 20, x: .5, y: .5, occupied: [{ x: 20, y: 20, width: 260, height: 236 }] })).toBeNull()
    expect(arenaActivitySpotlightSiteGeometry({ width: 300, height: 276, pad: 20, x: Number.NaN, y: .5 })).toBeNull()
  })

  it('keeps both the site and subsequent prey label nearby when a selected callout crowds the bottom', () => {
    const dimensions = { width: 1392, height: 522, pad: 32 }
    const selectedCallout = arenaSelectedCreatureCalloutGeometry({ ...dimensions, x: .65, y: .95, size: 1 })
    const selectedHalo = arenaActivitySpotlightHaloRect(1392, 522, 32, { x: .65, y: .95, size: 1 })
    const preyHalo = arenaActivitySpotlightHaloRect(1392, 522, 32, { x: .61, y: .95, size: 1 })
    const anchors = [{ x: 12, y: 462, width: 240, height: 48 }]
    const site = arenaActivitySpotlightSiteGeometry({ ...dimensions, x: .61, y: .97, occupied: [selectedCallout, selectedHalo, preyHalo], anchors })!
    expect(site).not.toBeNull()
    const prey = arenaActivitySpotlightTagGeometry({ ...dimensions, x: .61, y: .95, size: 1, individualId: 6, role: 'prey', occupied: [selectedCallout, selectedHalo, site], anchors })!
    expect(prey).not.toBeNull()
    for (const [label, obstacles] of [[site, [selectedCallout, selectedHalo, preyHalo, ...anchors]], [prey, [selectedCallout, selectedHalo, site, ...anchors]]] as const) {
      const nearestX = Math.max(label.x, Math.min(label.x + label.width, label.actorX))
      const nearestY = Math.max(label.y, Math.min(label.y + label.height, label.actorY))
      expect(Math.hypot(label.actorX - nearestX, label.actorY - nearestY)).toBeLessThan(150)
      expect(Math.hypot(label.actorX - nearestX, label.actorY - nearestY)).toBeGreaterThanOrEqual(label.haloRadius + 6)
      for (const obstacle of obstacles) {
        expect(label.x + label.width + 6 <= obstacle.x || label.x >= obstacle.x + obstacle.width + 6 || label.y + label.height + 6 <= obstacle.y || label.y >= obstacle.y + obstacle.height + 6).toBe(true)
      }
    }
  })

  it('uses freed arena space when explanations move outside independently of canvas typography', () => {
    for (const width of [300, 900]) {
      for (const compact of [true, false]) {
        const dimensions = { width, height: 276, pad: 20, compact }
        const anchors = arenaActivitySpotlightOverlayAnchors(width, 276, compact, true, true)
        expect(anchors).toEqual(arenaActivitySpotlightOverlayAnchors(width, 276, !compact, true, true))
        expect(arenaActivitySpotlightOverlayAnchors(width, 276, compact)).toEqual(arenaActivitySpotlightOverlayAnchors(width, 276, compact, false))
        const site = arenaActivitySpotlightSiteGeometry({ ...dimensions, x: .85, y: .6, anchors })!
        const selected = arenaSelectedCreatureCalloutGeometry({ ...dimensions, x: .96, y: .5, explanationsOutside: true, compactControls: true })
        expect(site).not.toBeNull()
        for (const label of [site, selected]) {
          expect(label.y).toBeGreaterThanOrEqual(72)
          expect(label.x).toBeGreaterThanOrEqual(20)
          expect(label.x + label.width).toBeLessThanOrEqual(width - 20)
          expect(label.y + label.height).toBeLessThanOrEqual(256)
          for (const obstacle of anchors) {
            expect(label.x + label.width <= obstacle.x || label.x >= obstacle.x + obstacle.width || label.y + label.height <= obstacle.y || label.y >= obstacle.y + obstacle.height, JSON.stringify({ dimensions, label, obstacle })).toBe(true)
          }
        }
        // The taller former badge occupied this entire horizontal band.
        expect(selected.y).toBeLessThan(132)
        expect(selected.width).toBe(compact ? 148 : 190)
      }
    }
    const lowerSite = arenaActivitySpotlightSiteGeometry({ width: 300, height: 276, pad: 20, compact: true, x: .9, y: .9, anchors: arenaActivitySpotlightOverlayAnchors(300, 276, true, true, true) })!
    expect(lowerSite).not.toBeNull()
    // The former lower key occupied y=154..224; its removal frees a slot
    // immediately above the retained picker, close to this bottom event.
    expect(lowerSite.y).toBeGreaterThanOrEqual(154)
    expect(lowerSite.y + lowerSite.height).toBeLessThanOrEqual(214)
  })

  it('keeps detached-guide labels clear of desktop controls even in a narrow canvas', () => {
    for (const width of [360, 700, 1200]) {
      const anchors = arenaActivitySpotlightOverlayAnchors(width, 450, true, true, false)
      expect(anchors).toEqual(arenaActivitySpotlightOverlayAnchors(width, 450, false, true, false))
      // The desktop picker reaches x=263; using the mobile 205px footprint
      // would allow labels to sit underneath its right-hand options.
      expect(anchors.some(anchor => anchor.x <= 263 && anchor.x + anchor.width >= 263 && anchor.y <= 430 && anchor.y + anchor.height >= 430)).toBe(true)
      for (const x of [.02, .5, .98]) for (const y of [.05, .5, .95]) {
        const dimensions = { width, height: 450, pad: 20, compact: width <= 720, x, y }
        const selected = arenaSelectedCreatureCalloutGeometry({ ...dimensions, explanationsOutside: true, compactControls: false })
        const site = arenaActivitySpotlightSiteGeometry({ ...dimensions, anchors })!
        expect(site).not.toBeNull()
        for (const label of [selected, site]) {
          expect(label.x).toBeGreaterThanOrEqual(20)
          expect(label.y).toBeGreaterThanOrEqual(20)
          expect(label.x + label.width).toBeLessThanOrEqual(width - 20)
          expect(label.y + label.height).toBeLessThanOrEqual(430)
          for (const obstacle of anchors) {
            expect(label.x + label.width <= obstacle.x || label.x >= obstacle.x + obstacle.width || label.y + label.height <= obstacle.y || label.y >= obstacle.y + obstacle.height, JSON.stringify({ dimensions, label, obstacle })).toBe(true)
          }
        }
      }
    }
  })

  it('preserves founder actor order while capping the rendered batch at eight', () => {
    const world = spotlightWorld()
    const founderOrder = [12, 3, 9, 1, 8, 2, 7, 4, 6, 5]
    world.activity = [spotlightMoment({ kind: 'intervention', actorIds: founderOrder })]
    expect(resolveArenaActivitySpotlight(world)?.actors.map(actor => actor.individualId)).toEqual(founderOrder.slice(0, 8))
  })

  it('filters dead, absent, malformed, and non-finite-position actors', () => {
    const world = spotlightWorld()
    const throwing = new Proxy({}, { get() { throw new Error('malformed current actor') } })
    world.creatures = [
      { individualId: 1, alive: false, x: .1, y: .1, size: 1 },
      { individualId: 2, alive: true, x: Number.NaN, y: .2, size: 1 },
      { individualId: 3, alive: true, x: .3, y: .3, size: 1 },
      { individualId: 4, alive: true, x: 2, y: .4, size: 1 },
      throwing,
    ] as unknown as World['creatures']
    world.activity = [spotlightMoment({ actorIds: [1, 2, 99, 4, 3, '5' as unknown as number, Number.NaN] })]
    expect(resolveArenaActivitySpotlight(world)?.actors.map(actor => actor.individualId)).toEqual([3])
  })

  it('ignores stray attack-role fields on non-attack interventions', () => {
    const world = spotlightWorld()
    world.activity = [spotlightMoment({ kind: 'intervention', actorIds: undefined, attackerId: 2, preyId: 1, location: undefined })]
    expect(resolveArenaActivitySpotlight(world)).toBeNull()
  })

  it('keeps a recorded site visible when no involved actor remains alive', () => {
    const world = spotlightWorld()
    for (const creature of world.creatures) creature.alive = false
    world.activity = [spotlightMoment({ kind: 'energy-death', actorIds: [1], location: [.25, .75] })]
    const spotlight = resolveArenaActivitySpotlight(world)
    expect(spotlight).toMatchObject({ kind: 'energy-death', location: { x: .25, y: .75 }, actors: [] })
    expect(formatArenaActivitySpotlightDescription(spotlight!)).toContain('no involved actor has a current live arena position')
    expect(formatArenaActivitySpotlightKey(spotlight!)).toContain('the site remains visible, but no involved actor has a current live arena position')
    expect(formatArenaActivitySpotlightKey(spotlight!)).not.toContain('dashed guides')

    world.activity = [spotlightMoment({ kind: 'energy-death', actorIds: [1], location: [Number.NaN, .75] })]
    expect(resolveArenaActivitySpotlight(world)).toBeNull()
  })

  it('keeps alpha deterministic, clamps reaction windows, and never marks historical or future records', () => {
    const world = spotlightWorld()
    expect(arenaActivitySpotlightWindowTicks(0)).toBe(120)
    expect(arenaActivitySpotlightWindowTicks(Number.MAX_VALUE)).toBe(202)
    expect(arenaActivitySpotlightWindowTicks(-1)).toBe(120)
    expect(arenaActivitySpotlightAlpha(0, 120)).toBe(1)
    expect(arenaActivitySpotlightAlpha(120, 120)).toBe(.34)
    expect(arenaActivitySpotlightAlpha(-1, 120)).toBe(0)

    const boundary = world.tickIndex - arenaActivitySpotlightWindowTicks(world.config.reactionTime)
    world.activity = [spotlightMoment({ tick: boundary })]
    const first = resolveArenaActivitySpotlight(world)
    const second = resolveArenaActivitySpotlight(world)
    expect(first?.alpha).toBe(second?.alpha)
    expect(first?.alpha).toBe(arenaActivitySpotlightAlpha(first?.age, arenaActivitySpotlightWindowTicks(world.config.reactionTime)))

    world.activity = [spotlightMoment({ generation: world.generation - 1 })]
    expect(resolveArenaActivitySpotlight(world)).toBeNull()
    world.activity = [spotlightMoment({ tick: world.tickIndex + 1 })]
    expect(resolveArenaActivitySpotlight(world)).toBeNull()
  })

  it('distinguishes the recorded event site from current actor positions and paths', () => {
    const world = spotlightWorld()
    world.activity = [spotlightMoment({ kind: 'attack-success', attackerId: 2, preyId: 1, actorIds: [2, 1] })]
    const spotlight = resolveArenaActivitySpotlight(world)!
    const description = formatArenaActivitySpotlightDescription(spotlight)
    expect(description).toContain('“Then” marker shows the recorded event site')
    expect(description).toContain('actor halos mark Individual 2 (attacker), Individual 1 (prey) at their current arena positions')
    expect(description).toContain('they are not movement paths')
    expect(formatArenaActivitySpotlightKey(spotlight)).toContain('recorded event site')

    const legacy = { ...spotlight, location: null }
    expect(formatArenaActivitySpotlightDescription(legacy)).toContain('does not show the historical event location')
    expect(formatArenaActivitySpotlightKey(legacy)).toContain('Historical event site unavailable')
  })

  it('exposes active SSR key, canvas data hooks, and accessible actor ids only for an active spotlight', async () => {
    const { ArenaCanvas } = await import('./ArenaCanvasRenderer')
    const world = spotlightWorld()
    world.activity = [spotlightMoment({ sequence: 22, actorIds: [2], summary: 'Individual 2 collected food.' })]
    const key = renderToStaticMarkup(createElement(ArenaActivitySpotlightKey, { world }))
    const compactKey = renderToStaticMarkup(createElement(ArenaActivitySpotlightKey, { world, compact: true }))
    const markup = renderToStaticMarkup(createElement(ArenaCanvas, {
      world,
      revision: 0,
      selectedIndividualId: null,
      onSelect: () => {},
      arenaFocus: 'all',
      playbackStatus: 'Paused',
      playbackDetail: 'Paused.',
    }))

    expect(key).toContain('data-arena-activity-spotlight-key-sequence="22"')
    expect(key).toContain('Orange “Then” marker = recorded event site')
    expect(key).toContain('not movement paths')
    expect(key).toContain('Food collected · Generation 3 · day 1.00 · Individual 2 collected food.')
    expect(key).toContain('Model context: Energy-regrowth mode uses each item’s recorded energy')
    expect(compactKey).toContain('data-arena-activity-spotlight-cue="true"')
    expect(compactKey).toContain('data-arena-activity-spotlight-key-sequence="22"')
    expect(compactKey).toContain('Highlighted · Food collected · Individual 2 collected food.')
    expect(markup).toContain('data-arena-activity-spotlight="true"')
    expect(markup).toContain('data-arena-activity-spotlight-sequence="22"')
    expect(markup).toContain('data-arena-activity-spotlight-actors="2"')
    expect(markup).toContain('data-arena-activity-spotlight-site="true"')
    expect(markup).toContain('data-arena-activity-spotlight-site-x="0.4"')
    expect(markup).toContain('data-arena-activity-spotlight-site-y="0.5"')
    expect(markup).toContain('data-arena-activity-spotlight-tag-copies="Collector · Individual 2"')
    expect(markup).toContain('data-arena-activity-spotlight-event="true"')
    expect(markup).toContain('data-arena-activity-spotlight-event-copy="Food collected · Generation 3 · day 1.00 · Individual 2 collected food."')
    expect(markup).toContain('“Then” marker shows the recorded event site')
    expect(markup).toContain('Highlighted event: Food collected · Generation 3 · day 1.00 · Individual 2 collected food.')
    expect(markup).toContain('Model context: Energy-regrowth mode uses each item’s recorded energy')
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1)

    world.activity = [spotlightMoment({ sequence: 23, kind: 'attack-success', actorIds: [2, 1], attackerId: 2, preyId: 1 })]
    const selectedMarkup = renderToStaticMarkup(createElement(ArenaCanvas, {
      world,
      revision: 0,
      selectedIndividualId: 2,
      onSelect: () => {},
      arenaFocus: 'all',
      playbackStatus: 'Paused',
      playbackDetail: 'Paused.',
    }))
    expect(selectedMarkup).toContain('data-arena-activity-spotlight-tag-copies="Prey · Individual 1"')
    expect(selectedMarkup).not.toContain('Attacker · Individual 2')
    expect(selectedMarkup).toContain('data-arena-selected-callout-individual-id="2"')
  })

  it('keeps duplicate sequences tied to the exact spotlight source record', () => {
    const world = spotlightWorld()
    world.activity = [
      spotlightMoment({ sequence: 40, actorIds: [1], summary: 'First record must not leak.' }),
      spotlightMoment({ sequence: 40, kind: 'attack-failure', actorIds: [2, 3], attackerId: 2, preyId: 3, contestChance: .41, summary: "Individual 2's attack on Individual 3 failed (contest chance 41%)." }),
    ]

    const spotlight = resolveArenaActivitySpotlight(world)
    const cue = deriveArenaActivitySpotlightCue(world)
    const compactKey = renderToStaticMarkup(createElement(ArenaActivitySpotlightKey, { world, compact: true }))
    expect(spotlight).toMatchObject({ sourceIndex: 1, sequence: 40, kind: 'attack-failure' })
    expect(cue).toMatchObject({ sequence: 40, kind: 'attack-failure' })
    expect(cue?.event).toContain("Individual 2's attack on Individual 3 failed")
    expect(cue?.context).toContain('recorded contest chance 41%')
    expect(cue?.event).not.toContain('First record')
    expect(compactKey).toContain('Highlighted · Attack failed · Individual 2 → Individual 3 · 41% contest')
    expect(compactKey).not.toContain('First record')
  })

  it('bounds compact copy and keeps malformed event prose out of an otherwise valid halo', async () => {
    const long = formatArenaActivitySpotlightCompact({ kind: 'food-collected', kindLabel: 'Food collected', summary: 'individual context '.repeat(20), attackerId: null, preyId: null, contestChance: null })
    expect(long.length).toBeLessThanOrEqual(ARENA_ACTIVITY_SPOTLIGHT_COMPACT_LIMIT)
    expect(long.startsWith('Highlighted · Food collected ·')).toBe(true)
    expect(long.endsWith('…')).toBe(true)

    const { ArenaCanvas } = await import('./ArenaCanvasRenderer')
    const world = spotlightWorld()
    world.activity = [spotlightMoment({ sequence: 50, actorIds: [2], summary: '   ' })]
    const key = renderToStaticMarkup(createElement(ArenaActivitySpotlightKey, { world }))
    const compactKey = renderToStaticMarkup(createElement(ArenaActivitySpotlightKey, { world, compact: true }))
    const markup = renderToStaticMarkup(createElement(ArenaCanvas, {
      world,
      revision: 0,
      selectedIndividualId: null,
      onSelect: () => {},
      arenaFocus: 'all',
      playbackStatus: 'Paused',
      playbackDetail: 'Paused.',
    }))

    expect(resolveArenaActivitySpotlight(world)).toMatchObject({ sourceIndex: 0, sequence: 50 })
    expect(deriveArenaActivitySpotlightCue(world)).toBeNull()
    expect(key).toContain('data-arena-activity-spotlight-key="true"')
    expect(key).not.toContain('data-arena-activity-spotlight-event="true"')
    expect(key).not.toContain('data-arena-activity-spotlight-context="true"')
    expect(compactKey).toBe('')
    expect(markup).toContain('data-arena-activity-spotlight="true"')
    expect(markup).not.toContain('data-arena-activity-spotlight-event="true"')
    expect(markup).not.toContain('Highlighted event:')
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1)
  })

  it('omits active cue, key, data hooks, and copy when no eligible current actor remains', async () => {
    const { ArenaCanvas } = await import('./ArenaCanvasRenderer')
    const world = spotlightWorld()
    world.activity = [spotlightMoment({ kind: 'generation-settlement', actorIds: [1] })]
    const key = renderToStaticMarkup(createElement(ArenaActivitySpotlightKey, { world }))
    const markup = renderToStaticMarkup(createElement(ArenaCanvas, {
      world,
      revision: 0,
      selectedIndividualId: null,
      onSelect: () => {},
      arenaFocus: 'all',
      playbackStatus: 'Paused',
      playbackDetail: 'Paused.',
    }))

    expect(key).toBe('')
    expect(renderToStaticMarkup(createElement(ArenaActivitySpotlightKey, { world, compact: true }))).toBe('')
    expect(markup).not.toContain('data-arena-activity-spotlight="true"')
    expect(markup).not.toContain('Latest actor halo marks')
    expect(markup).not.toContain('Highlighted event:')
  })
})

describe('selected creature callout', () => {
  it('uses current action state rather than decisionSummary and covers every held target kind', () => {
    const world = spotlightWorld()
    const selected = world.creatures[0]
    const foodId = world.food[0]?.id ?? 1
    const prey = world.creatures[1]
    const targetPoint = { targetX: .7, targetY: .8 }
    const target = (overrides: Record<string, unknown>) => {
      Object.assign(selected, { home: false, mode: 'foraging', targetType: null, targetId: null, ...targetPoint, ...overrides })
      return deriveArenaSelectedCreatureCallout(world, selected.individualId)!
    }

    selected.decisionSummary = { chosen: 'prey', reason: 'stale decision', candidates: [] }
    expect(target({ targetType: 'food', targetId: foodId }).title).toBe('Individual 1 · Finding food')
    expect(target({ targetType: 'food', targetId: foodId }).detail).toBe('Held: food item')
    expect(target({ targetType: 'food', targetId: 9999 }).detail).toBe('Held: food gone · last-known point')
    expect(target({ targetType: 'prey', targetId: prey.id }).detail).toBe(`Held: prey · Individual ${prey.individualId}`)
    expect(target({ targetType: 'prey', targetId: 9999 }).detail).toBe('Held: prey gone · last-known point')
    expect(target({ targetType: 'threat', targetId: prey.id }).detail).toBe(`Held: escape waypoint · threat Individual ${prey.individualId}`)
    expect(target({ targetType: 'threat', targetId: 9999 }).detail).toBe('Held: escape waypoint · threat gone')
    expect(target({ targetType: 'threat', targetId: null }).detail).toBe('Held: escape waypoint · remembered threat')
    expect(target({ targetType: 'home' }).detail).toBe('Held: home')
    expect(target({ targetType: 'memory' }).detail).toBe('Held: remembered food')
    expect(target({ targetType: 'explore' }).detail).toBe('Held: exploration waypoint')
    expect(target({ targetType: null }).detail).toBe('Held: no target')
    expect(target({ targetType: null }).description).toContain('no held target has been captured yet')
    expect(target({ targetType: 'unknown' }).detail).toBe('Held: target unavailable')

    expect(target({ targetType: 'food', targetId: 9999, targetX: 2 }).detail).toBe('Held: food target unavailable')

    for (const [mode, label] of [['exploring', 'Exploring'], ['foraging', 'Finding food'], ['hunting', 'Hunting prey'], ['fleeing', 'Fleeing danger'], ['returning', 'Going home']] as const) {
      expect(target({ mode, targetType: null }).title).toBe(`Individual 1 · ${label}`)
    }
    expect(target({ home: true, mode: 'exploring', targetType: 'home' }).title).toBe('Individual 1 · Safe at home')
  })

  it('rejects malformed, dead, and out-of-domain selected actors without fabricating a callout', () => {
    const world = spotlightWorld()
    const selected = world.creatures[0]
    expect(deriveArenaSelectedCreatureCallout(world, selected.individualId)).not.toBeNull()
    expect(deriveArenaSelectedCreatureCallout(world, '1')).toBeNull()
    expect(deriveArenaSelectedCreatureCallout(world, 9999)).toBeNull()
    selected.alive = false
    expect(deriveArenaSelectedCreatureCallout(world, selected.individualId)).toBeNull()
    selected.alive = true
    selected.x = -0.01
    expect(deriveArenaSelectedCreatureCallout(world, selected.individualId)).toBeNull()
    selected.x = .5
    selected.y = Number.NaN
    expect(deriveArenaSelectedCreatureCallout(world, selected.individualId)).toBeNull()
    selected.y = .5
    selected.home = 'yes' as unknown as boolean
    expect(deriveArenaSelectedCreatureCallout(world, selected.individualId)).toBeNull()
    selected.home = false
    selected.mode = 'invalid' as never
    expect(deriveArenaSelectedCreatureCallout(world, selected.individualId)).toBeNull()
    const throwing = new Proxy({}, { get() { throw new Error('malformed actor') } })
    world.creatures = [throwing] as unknown as World['creatures']
    expect(() => deriveArenaSelectedCreatureCallout(world, 1)).not.toThrow()
    expect(deriveArenaSelectedCreatureCallout(world, 1)).toBeNull()
  })

  it('keeps compact and desktop callout boxes plus leader endpoints inside the padded field', () => {
    const expectActorRingClear = (
      geometry: ReturnType<typeof arenaSelectedCreatureCalloutGeometry>,
      width: number,
      height: number,
      size: number,
    ) => {
      const base = Math.max(7, Math.min(width, height) * .017 * size)
      const selectedRingRadius = base * 1.5
      const nearestX = Math.max(geometry.x, Math.min(geometry.x + geometry.width, geometry.leaderStartX))
      const nearestY = Math.max(geometry.y, Math.min(geometry.y + geometry.height, geometry.leaderStartY))
      expect(Math.hypot(geometry.leaderStartX - nearestX, geometry.leaderStartY - nearestY)).toBeGreaterThanOrEqual(selectedRingRadius + 4)
    }
    const cases = [
      { width: 300, height: 276, pad: 20, compact: true, expectedWidth: 148 },
      { width: 900, height: 600, pad: 32, compact: false, expectedWidth: 190 },
    ] as const
    for (const geometryInput of cases) {
      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [.5, .5]] as const) {
        const geometry = arenaSelectedCreatureCalloutGeometry({ ...geometryInput, x, y, size: 1 })
        const right = geometryInput.width - geometryInput.pad
        const bottom = geometryInput.height - geometryInput.pad
        expect(geometry.width).toBe(geometryInput.expectedWidth)
        expect(geometry.height).toBe(40)
        expect(geometry.x).toBeGreaterThanOrEqual(geometryInput.pad)
        expect(geometry.y).toBeGreaterThanOrEqual(geometryInput.pad)
        expect(geometry.x + geometry.width).toBeLessThanOrEqual(right)
        expect(geometry.y + geometry.height).toBeLessThanOrEqual(bottom)
        for (const value of [geometry.leaderStartX, geometry.leaderStartY, geometry.leaderEndX, geometry.leaderEndY]) {
          expect(Number.isFinite(value)).toBe(true)
        }
        expect(geometry.leaderStartX).toBeGreaterThanOrEqual(geometryInput.pad)
        expect(geometry.leaderStartX).toBeLessThanOrEqual(right)
        expect(geometry.leaderStartY).toBeGreaterThanOrEqual(geometryInput.pad)
        expect(geometry.leaderStartY).toBeLessThanOrEqual(bottom)
        expect(geometry.leaderEndX).toBeGreaterThanOrEqual(geometryInput.pad)
        expect(geometry.leaderEndX).toBeLessThanOrEqual(right)
        expect(geometry.leaderEndY).toBeGreaterThanOrEqual(geometryInput.pad)
        expect(geometry.leaderEndY).toBeLessThanOrEqual(bottom)
        const actorInsideBox = geometry.leaderStartX >= geometry.x && geometry.leaderStartX <= geometry.x + geometry.width
          && geometry.leaderStartY >= geometry.y && geometry.leaderStartY <= geometry.y + geometry.height
        expect(actorInsideBox).toBe(false)
        expectActorRingClear(geometry, geometryInput.width, geometryInput.height, 1)
        expect(Math.hypot(geometry.leaderEndX - geometry.leaderStartX, geometry.leaderEndY - geometry.leaderStartY)).toBeGreaterThan(0)
      }
    }
    const maxSize = arenaSelectedCreatureCalloutGeometry({ width: 900, height: 600, pad: 32, compact: false, x: .5, y: .5, size: 2.8 })
    expectActorRingClear(maxSize, 900, 600, 2.8)
    expect(Math.hypot(maxSize.leaderEndX - maxSize.leaderStartX, maxSize.leaderEndY - maxSize.leaderStartY)).toBeGreaterThan(0)
    const compactOverlayCase = arenaSelectedCreatureCalloutGeometry({ width: 300, height: 276, pad: 20, compact: true, x: .96, y: .5, size: 1 })
    expect(compactOverlayCase.y).toBeGreaterThanOrEqual(132)
    expect(compactOverlayCase.y + compactOverlayCase.height).toBeLessThanOrEqual(174)
    const fallback = arenaSelectedCreatureCalloutGeometry({ width: Number.NaN, height: Number.POSITIVE_INFINITY, pad: Number.NaN, x: Number.NaN, y: Number.NaN })
    expect(Object.values(fallback).every(value => typeof value !== 'number' || Number.isFinite(value))).toBe(true)
  })

  it('adds accessible active hooks and leaves the existing single live region unchanged', async () => {
    const { ArenaCanvas } = await import('./ArenaCanvasRenderer')
    const world = spotlightWorld()
    const selected = world.creatures[0]
    selected.home = false
    selected.mode = 'foraging'
    selected.targetType = 'food'
    selected.targetId = world.food[0]?.id ?? null
    selected.targetX = .7
    selected.targetY = .8
    const markup = renderToStaticMarkup(createElement(ArenaCanvas, {
      world,
      revision: 0,
      selectedIndividualId: selected.individualId,
      onSelect: () => {},
      arenaFocus: 'all',
      playbackStatus: 'Paused',
      playbackDetail: 'Paused.',
    }))
    expect(markup).toContain('data-arena-selected-callout="true"')
    expect(markup).toContain('data-arena-selected-callout-individual-id="1"')
    expect(markup).toContain('data-arena-selected-callout-title="Individual 1 · Finding food"')
    expect(markup).toContain('data-arena-selected-callout-detail="Held: food item"')
    expect(markup).toContain('data-arena-selected-callout-copy="Selected Individual 1 is currently finding food; its held target from the last decision is a food item."')
    expect(markup).toContain('Selected Individual 1 is currently finding food; its held target from the last decision is a food item.')
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1)
  })

  it('omits callout hooks, copy, and canvas cues for an inactive selection', async () => {
    const { ArenaCanvas } = await import('./ArenaCanvasRenderer')
    const world = spotlightWorld()
    world.activity = []
    world.creatures[0].alive = false
    const markup = renderToStaticMarkup(createElement(ArenaCanvas, {
      world,
      revision: 0,
      selectedIndividualId: world.creatures[0].individualId,
      onSelect: () => {},
      arenaFocus: 'all',
      playbackStatus: 'Paused',
      playbackDetail: 'Paused.',
    }))
    expect(markup).not.toContain('data-arena-selected-callout="true"')
    expect(markup).not.toContain('Selected Individual 1 is currently')
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1)
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
