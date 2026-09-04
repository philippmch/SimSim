import { useEffect, useRef } from 'react'
import type React from 'react'
import { MAX_FOUNDER_MIGRATION_BATCH, MAX_POPULATION } from '../simulation/config'
import { SIMULATION_TIMESTEP } from '../simulation/engine'
import type { World, WorldActivityKind } from '../simulation/types'
import {
  CREATURE_STATE_METADATA,
  arenaCreatureAlpha,
  arenaLineageRingAlpha,
  arenaPatchQualityMultiplier,
  arenaPatchQualityRange,
  arenaTargetPathEligible,
  classifyArenaHeldPathEndpoint,
  formatArenaAccessibleDescription,
  speedColor,
  type ArenaFocus,
  type ArenaHeldPathEndpointKind,
  type ArenaPlaybackStatus,
  type CreatureState,
} from './ArenaCanvasModel'
import { resourcePatchOrdinal, sortResourcePatchRecords } from './ResourcePatchPresentation'

interface Props {
  world: World
  revision: number
  selectedIndividualId: number | null
  onSelect: (individualId: number | null) => void
  /** Patch selection stays outside worker inspect telemetry. */
  selectedPatchId?: number | null
  onSelectPatch?: (patchId: number | null) => void
  arenaFocus: ArenaFocus
  playbackStatus: ArenaPlaybackStatus
  playbackDetail: string
}

export const ARENA_COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export interface ArenaCanvasPalette {
  fieldStart: string
  fieldEnd: string
  fieldBorder: string
  fieldGrid: string
  patchHaloStart: string
  patchHaloEnd: string
  patchRing: string
  patchStockTrack: string
  sightFill: string
  sightStroke: string
  targetLine: string
  memoryFood: string
  memoryThreat: string
  obstacleShadow: string
  obstacleStart: string
  obstacleEnd: string
  obstacleStroke: string
  foodShadow: string
  foodStart: string
  foodMiddle: string
  foodEnd: string
  creatureShadow: string
  creatureEdge: string
  creatureHighlight: string
  creatureBodyEnd: string
  creatureEye: string
  creatureFoodLabel: string
  selectedRing: string
  lineageRing: string
  progressTrack: string
  progressFill: string
}

export const ARENA_LIGHT_PALETTE: ArenaCanvasPalette = {
  fieldStart:'#e8eee4',
  fieldEnd:'#dce7d8',
  fieldBorder:'rgba(47,78,65,.18)',
  fieldGrid:'rgba(37,75,62,.22)',
  patchHaloStart:'rgba(183,190,88,.16)',
  patchHaloEnd:'rgba(183,190,88,0)',
  patchRing:'rgba(171,183,78,.7)',
  patchStockTrack:'rgba(45,75,60,.26)',
  sightFill:'rgba(227,188,63,.10)',
  sightStroke:'rgba(227,188,63,.7)',
  targetLine:'rgba(242,201,76,.6)',
  memoryFood:'#d5bb43',
  memoryThreat:'#bd6651',
  obstacleShadow:'rgba(28,48,39,.16)',
  obstacleStart:'#93a594',
  obstacleEnd:'#526b5d',
  obstacleStroke:'rgba(32,53,44,.3)',
  foodShadow:'rgba(31,55,38,.18)',
  foodStart:'#e9d77d',
  foodMiddle:'#a2b95d',
  foodEnd:'#5f7133',
  creatureShadow:'rgba(22,38,30,.16)',
  creatureEdge:'rgba(12,29,23,.82)',
  creatureHighlight:'rgba(255,255,255,.35)',
  creatureBodyEnd:'#304b35',
  creatureEye:'#132019',
  creatureFoodLabel:'#f2d45d',
  selectedRing:'#f2c94c',
  lineageRing:'rgba(242,201,76,.46)',
  progressTrack:'rgba(16,34,28,.16)',
  progressFill:'#d9b940',
}

export const ARENA_DARK_PALETTE: ArenaCanvasPalette = {
  fieldStart:'#14251e',
  fieldEnd:'#1c3428',
  fieldBorder:'rgba(185,222,201,.25)',
  fieldGrid:'rgba(185,222,201,.18)',
  patchHaloStart:'rgba(205,216,100,.18)',
  patchHaloEnd:'rgba(205,216,100,0)',
  patchRing:'rgba(205,216,100,.82)',
  patchStockTrack:'rgba(213,238,221,.28)',
  sightFill:'rgba(245,211,83,.13)',
  sightStroke:'rgba(249,216,91,.84)',
  targetLine:'rgba(255,222,97,.78)',
  memoryFood:'#ead35a',
  memoryThreat:'#ed8f79',
  obstacleShadow:'rgba(0,0,0,.46)',
  obstacleStart:'#759482',
  obstacleEnd:'#3b5a4a',
  obstacleStroke:'rgba(202,231,213,.31)',
  foodShadow:'rgba(0,0,0,.44)',
  foodStart:'#f3e29a',
  foodMiddle:'#bfd575',
  foodEnd:'#718d46',
  creatureShadow:'rgba(0,0,0,.5)',
  creatureEdge:'rgba(1,10,7,.9)',
  creatureHighlight:'rgba(255,255,255,.4)',
  creatureBodyEnd:'#54755d',
  creatureEye:'#e6f4ea',
  creatureFoodLabel:'#f6dc68',
  selectedRing:'#f8d65d',
  lineageRing:'rgba(255,220,98,.62)',
  progressTrack:'rgba(219,239,225,.22)',
  progressFill:'#eed25a',
}

export function arenaCanvasPalette(darkMode: boolean): ArenaCanvasPalette {
  return darkMode ? ARENA_DARK_PALETTE : ARENA_LIGHT_PALETTE
}

export interface ArenaColorSchemeQuery {
  readonly matches: boolean
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
  addListener?: (listener: () => void) => void
  removeListener?: (listener: () => void) => void
}

export function listenToArenaColorScheme(
  query: ArenaColorSchemeQuery,
  cachedDarkMode: boolean,
  onChange: (darkMode: boolean) => void,
): () => void {
  const handleChange = () => onChange(query.matches)
  if (query.matches !== cachedDarkMode) onChange(query.matches)
  if (typeof query.addEventListener === 'function' && typeof query.removeEventListener === 'function') {
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener!('change', handleChange)
  }
  if (typeof query.addListener === 'function' && typeof query.removeListener === 'function') {
    query.addListener(handleChange)
    return () => query.removeListener!(handleChange)
  }
  return () => {}
}

const ARENA_ACTIVITY_KINDS = ['food-collected', 'attack-success', 'attack-failure', 'energy-death', 'reached-home', 'natural-regrowth', 'intervention', 'generation-settlement'] as const satisfies readonly WorldActivityKind[]
const ARENA_ACTIVITY_KIND_SET = new Set<string>(ARENA_ACTIVITY_KINDS)
const ARENA_ACTIVITY_AGGREGATE_KINDS = new Set<WorldActivityKind>(['natural-regrowth', 'generation-settlement'])
const ARENA_ACTIVITY_SPOTLIGHT_KEY_COPY = 'Latest actor halo marks each actor’s current arena position; it does not show the historical event location.'

export type ArenaActivitySpotlightRole = 'attacker' | 'prey' | 'collector' | 'returning individual' | 'involved individual'

export interface ArenaActivitySpotlightActor {
  individualId: number
  role: ArenaActivitySpotlightRole
  roleLabel: string
  x: number
  y: number
  size: number
}

export interface ArenaActivitySpotlight {
  sequence: number
  generation: number
  kind: WorldActivityKind
  tick: number
  age: number
  alpha: number
  actors: ArenaActivitySpotlightActor[]
}

type ArenaRecord = Record<string, unknown>

function arenaRecord(value: unknown): ArenaRecord | null {
  if (value === null || typeof value !== 'object') return null
  try {
    return Array.isArray(value) ? null : value as ArenaRecord
  } catch {
    return null
  }
}

function arenaField(value: unknown, key: string): unknown {
  const source = arenaRecord(value)
  if (!source) return undefined
  try {
    return source[key]
  } catch {
    return undefined
  }
}

function arenaSafeInteger(value: unknown, minimum = 0): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null
}

function arenaFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function arenaSafeGeneration(value: unknown): number | null {
  return arenaSafeInteger(value, 1)
}

function arenaActivityKind(value: unknown): value is WorldActivityKind {
  return typeof value === 'string' && ARENA_ACTIVITY_KIND_SET.has(value)
}

function arenaSafeArray(value: unknown): readonly unknown[] {
  try {
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function arenaArrayLength(value: readonly unknown[]): number {
  try {
    return Number.isSafeInteger(value.length) && value.length >= 0 ? value.length : 0
  } catch {
    return 0
  }
}

function arenaActorRoleLabel(role: ArenaActivitySpotlightRole): string {
  if (role === 'attacker') return 'Attacker'
  if (role === 'prey') return 'Prey'
  if (role === 'collector') return 'Collector'
  if (role === 'returning individual') return 'Returning individual'
  return 'Involved individual'
}

function arenaOrderedActorRefs(entry: unknown, kind: WorldActivityKind): { individualId: number; role: ArenaActivitySpotlightRole }[] {
  const refs: { individualId: number; role: ArenaActivitySpotlightRole }[] = []
  const seen = new Set<number>()
  const append = (value: unknown, role: ArenaActivitySpotlightRole) => {
    const individualId = arenaSafeInteger(value, 1)
    if (individualId === null || seen.has(individualId)) return
    seen.add(individualId)
    refs.push({ individualId, role })
  }
  if (kind === 'attack-success' || kind === 'attack-failure') {
    append(arenaField(entry, 'attackerId'), 'attacker')
    append(arenaField(entry, 'preyId'), 'prey')
  }
  const remainingRole: ArenaActivitySpotlightRole = kind === 'food-collected'
    ? 'collector'
    : kind === 'reached-home'
      ? 'returning individual'
      : 'involved individual'
  let genericCount = 0
  const actorIds = arenaSafeArray(arenaField(entry, 'actorIds'))
  for (let index = 0; index < arenaArrayLength(actorIds); index++) {
    let value: unknown
    try {
      value = actorIds[index]
    } catch {
      continue
    }
    const individualId = arenaSafeInteger(value, 1)
    if (individualId === null || seen.has(individualId)) continue
    append(individualId, genericCount === 0 ? remainingRole : 'involved individual')
    genericCount++
  }
  return refs
}

/** Deterministic retention window for the actor halo; a 120-tick floor keeps it visible at faster playback. */
export function arenaActivitySpotlightWindowTicks(reactionTime: unknown): number {
  const duration = arenaFinite(reactionTime)
  if (duration === null || duration < 0) return 120
  const supportedDuration = Math.min(5, duration)
  const reactionTicks = Math.ceil(supportedDuration / SIMULATION_TIMESTEP)
  if (!Number.isSafeInteger(reactionTicks) || reactionTicks < 0) return Number.MAX_SAFE_INTEGER
  return Math.max(120, Math.min(Number.MAX_SAFE_INTEGER, reactionTicks + 2))
}

/** Fade only from retained event age, never from wall-clock time or an animation loop. */
export function arenaActivitySpotlightAlpha(age: unknown, windowTicks: unknown): number {
  const currentAge = arenaFinite(age)
  const window = arenaFinite(windowTicks)
  if (currentAge === null || window === null || currentAge < 0 || window <= 0) return 0
  const ratio = Math.max(0, Math.min(1, currentAge / window))
  return Number((1 - ratio * .66).toFixed(3))
}

/**
 * Find the newest eligible actor-level activity record and resolve its actors
 * against the live cohort.  Every field is treated as untrusted so retained
 * legacy snapshots cannot make the renderer throw or point at a stale actor.
 */
export function resolveArenaActivitySpotlight(world: unknown): ArenaActivitySpotlight | null {
  const generation = arenaSafeGeneration(arenaField(world, 'generation'))
  const currentTick = arenaSafeInteger(arenaField(world, 'tickIndex'), 0)
  const creatures = arenaSafeArray(arenaField(world, 'creatures'))
  if (generation === null || currentTick === null) return null

  const currentActors = new Map<number, { x: number; y: number; size: number }>()
  for (let index = 0; index < arenaArrayLength(creatures); index++) {
    let creature: unknown
    try {
      creature = creatures[index]
    } catch {
      continue
    }
    const individualId = arenaSafeInteger(arenaField(creature, 'individualId'), 1)
    const x = arenaFinite(arenaField(creature, 'x'))
    const y = arenaFinite(arenaField(creature, 'y'))
    if (individualId === null || arenaField(creature, 'alive') !== true || x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1 || currentActors.has(individualId)) continue
    const size = arenaFinite(arenaField(creature, 'size'))
    currentActors.set(individualId, { x, y, size: size !== null && size > 0 ? Math.max(.3, Math.min(2.8, size)) : 1 })
  }
  if (!currentActors.size) return null

  const windowTicks = arenaActivitySpotlightWindowTicks(arenaField(arenaField(world, 'config'), 'reactionTime'))
  const activity = arenaSafeArray(arenaField(world, 'activity'))
  let best: ArenaActivitySpotlight | null = null
  let bestSourceIndex = -1
  for (let sourceIndex = 0; sourceIndex < arenaArrayLength(activity); sourceIndex++) {
    let entry: unknown
    try {
      entry = activity[sourceIndex]
    } catch {
      continue
    }
    const rawSequence = arenaField(entry, 'sequence')
    const sequence = rawSequence === undefined ? sourceIndex + 1 : arenaSafeInteger(rawSequence, 1)
    const eventGeneration = arenaSafeGeneration(arenaField(entry, 'generation'))
    const tick = arenaSafeInteger(arenaField(entry, 'tick'), 0)
    const kind = arenaField(entry, 'kind')
    if (sequence === null || eventGeneration === null || eventGeneration !== generation || tick === null || tick > currentTick || !arenaActivityKind(kind) || ARENA_ACTIVITY_AGGREGATE_KINDS.has(kind)) continue
    const age = currentTick - tick
    if (age > windowTicks) continue
    const refs = arenaOrderedActorRefs(entry, kind)
    const actors: ArenaActivitySpotlightActor[] = []
    for (const ref of refs) {
      const current = currentActors.get(ref.individualId)
      if (!current) continue
      actors.push({ ...ref, roleLabel: arenaActorRoleLabel(ref.role), ...current })
    }
    const cappedActors = actors.slice(0, MAX_FOUNDER_MIGRATION_BATCH)
    if (!cappedActors.length) continue
    const candidate: ArenaActivitySpotlight = { sequence, generation, kind, tick, age, alpha: arenaActivitySpotlightAlpha(age, windowTicks), actors: cappedActors }
    if (best === null || sequence > best.sequence || (sequence === best.sequence && sourceIndex > bestSourceIndex)) {
      best = candidate
      bestSourceIndex = sourceIndex
    }
  }
  return best
}

/** Canonical wording distinguishes the live actor position from the retained event location. */
export function formatArenaActivitySpotlightDescription(spotlight: ArenaActivitySpotlight): string {
  const actors = spotlight.actors.map(actor => `Individual ${actor.individualId} (${actor.roleLabel.toLowerCase()})`).join(', ')
  const position = spotlight.actors.length === 1 ? 'position' : 'positions'
  return `Latest actor halo marks ${actors} at their current arena ${position}; it does not show the historical event location.`
}

export function ArenaActivitySpotlightKey({ world }: { world: World }): React.ReactElement | null {
  if (!resolveArenaActivitySpotlight(world)) return null
  return <strong data-arena-activity-spotlight-key="true">{ARENA_ACTIVITY_SPOTLIGHT_KEY_COPY}</strong>
}

/** Color-scheme and canvas lifecycle helpers remain in the renderer chunk. */
function readArenaDarkMode(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(ARENA_COLOR_SCHEME_QUERY).matches
    : false
}

function drawHeldPathEndpoint(
  ctx: CanvasRenderingContext2D,
  kind: ArenaHeldPathEndpointKind,
  x: number,
  y: number,
  color: string,
  size: number,
) {
  if (kind === 'none' || !Number.isFinite(x) || !Number.isFinite(y)) return
  const radius = Math.max(3, size)
  ctx.save();ctx.globalAlpha=.78;ctx.fillStyle='rgba(10,24,18,.82)';ctx.beginPath();ctx.arc(x,y,radius+2.8,0,Math.PI*2);ctx.fill();ctx.globalAlpha=.9;ctx.strokeStyle='rgba(248,252,249,.9)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,radius+2.8,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=.82;ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.6;ctx.setLineDash([])
  if (kind === 'live-food' || kind === 'live-prey') {
    ctx.beginPath();ctx.arc(x,y,radius*.52,0,Math.PI*2);ctx.fill()
  } else if (kind === 'last-known-food' || kind === 'last-known-prey') {
    ctx.beginPath();ctx.moveTo(x-radius*.75,y-radius*.75);ctx.lineTo(x+radius*.75,y+radius*.75);ctx.moveTo(x+radius*.75,y-radius*.75);ctx.lineTo(x-radius*.75,y+radius*.75);ctx.stroke()
  } else {
    ctx.beginPath();ctx.moveTo(x,y-radius);ctx.lineTo(x+radius,y);ctx.lineTo(x,y+radius);ctx.lineTo(x-radius,y);ctx.closePath();ctx.globalAlpha=.22;ctx.fill();ctx.globalAlpha=.82;ctx.stroke()
  }
  ctx.restore()
}

function drawArenaActivitySpotlight(
  ctx: CanvasRenderingContext2D,
  spotlight: ArenaActivitySpotlight,
  width: number,
  height: number,
  sx: (value: number) => number,
  sy: (value: number) => number,
) {
  const extent = Math.min(width, height)
  for (const actor of spotlight.actors) {
    if (![actor.x, actor.y, actor.size].every(Number.isFinite)) continue
    const base = Math.max(7, extent * .017 * actor.size)
    const bodyHeight = base * 1.55
    const x = sx(actor.x)
    const y = sy(actor.y) - bodyHeight * .35
    const radius = Math.max(base * 2.15, 15)
    if (![x, y, radius].every(Number.isFinite)) continue
    ctx.save()
    ctx.globalAlpha = spotlight.alpha
    ctx.lineCap = 'round'
    ctx.setLineDash([8, 5])
    ctx.strokeStyle = 'rgba(3, 17, 29, .96)'
    ctx.lineWidth = 6
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke()
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 2.4
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    for (let index = 0; index < 4; index++) {
      const angle = index * Math.PI / 2
      const inner = radius + 3
      const outer = radius + Math.max(7, base * .55)
      ctx.strokeStyle = 'rgba(3, 17, 29, .96)'
      ctx.lineWidth = 4.5
      ctx.beginPath(); ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner); ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer); ctx.stroke()
      ctx.strokeStyle = '#22d3ee'
      ctx.lineWidth = 1.8
      ctx.beginPath(); ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner); ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer); ctx.stroke()
    }
    ctx.restore()
  }
}

function arenaQualityColor(multiplier: number, darkMode: boolean): string {
  const t = Math.max(0, Math.min(1, multiplier / 2))
  const hue = 30 + 100 * t
  return `hsl(${hue} 72% ${darkMode ? 68 : 36}%)`
}

export type ArenaPatchPosition = Pick<World['environment']['patches'][number], 'id' | 'x' | 'y'>

/** Backward-compatible arena names use the shared user-facing patch contract. */
export const sortArenaPatches = sortResourcePatchRecords
export const arenaPatchOrdinal = resourcePatchOrdinal

/** Shared visual radius calculations keep canvas hit testing aligned with the central stock ring. */
export function arenaPatchHaloRadius(width: number, height: number, foodPatchSpread: number): number {
  const extent = Math.min(width, height)
  const spread = Number.isFinite(foodPatchSpread) ? Math.max(0, foodPatchSpread) : 0
  return Math.max(24, extent * spread * .72)
}

export function arenaPatchCentralRingRadius(width: number, height: number, foodPatchSpread: number): number {
  return Math.max(8, arenaPatchHaloRadius(width, height, foodPatchSpread) * .32)
}

export const ARENA_PATCH_MIN_HIT_RADIUS = 22

/** Keep a patch comfortably tappable even when its visual stock ring is small. */
export function arenaPatchHitRadius(width: number, height: number, foodPatchSpread: number): number {
  return Math.max(ARENA_PATCH_MIN_HIT_RADIUS, arenaPatchCentralRingRadius(width, height, foodPatchSpread))
}

export interface ArenaPatchHitTestPoint {
  /** Normalized field coordinates, where 0–1 is the drawable simulation field. */
  x: number
  y: number
}

export interface ArenaPatchHitTestGeometry {
  width: number
  height: number
  pad: number
  foodPatchSpread: number
}

/**
 * Choose the nearest patch whose accessible target contains a pointer. The
 * test is pure, finite-data guarded, and uses patch id as the deterministic
 * tie-breaker when overlapping patches are equally close.
 */
export function hitTestArenaPatch<T extends ArenaPatchPosition>(
  patches: ReadonlyArray<T>,
  point: ArenaPatchHitTestPoint,
  geometry: ArenaPatchHitTestGeometry,
): T | undefined {
  const { width, height, pad, foodPatchSpread } = geometry
  if (![width, height, pad, point.x, point.y].every(Number.isFinite)) return undefined
  if (width <= 0 || height <= 0 || width - pad * 2 <= 0 || height - pad * 2 <= 0) return undefined
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return undefined
  const fieldWidth = width - pad * 2
  const fieldHeight = height - pad * 2
  const radius = arenaPatchHitRadius(width, height, foodPatchSpread)
  let best: T | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  let bestIndex = Number.POSITIVE_INFINITY
  for (let index = 0; index < patches.length; index++) {
    const patch = patches[index]
    if (!patch || !Number.isFinite(patch.id) || !Number.isFinite(patch.x) || !Number.isFinite(patch.y)
      || patch.x < 0 || patch.x > 1 || patch.y < 0 || patch.y > 1) continue
    const distance = Math.hypot((patch.x - point.x) * fieldWidth, (patch.y - point.y) * fieldHeight)
    if (!Number.isFinite(distance) || distance > radius) continue
    const closer = distance < bestDistance
    const sameDistance = distance === bestDistance
    const lowerId = best !== undefined && patch.id < best.id
    const earlierRecord = best !== undefined && patch.id === best.id && index < bestIndex
    if (closer || (sameDistance && (lowerId || earlierRecord))) {
      best = patch
      bestDistance = distance
      bestIndex = index
    }
  }
  return best
}

type ArenaSelectableCreature = Pick<World['creatures'][number], 'individualId' | 'x' | 'y' | 'alive'>
export type ArenaInspectionHit = { kind: 'creature'; individualId: number } | { kind: 'patch'; patchId: number } | null

/** Preserve legacy creature hit precedence, then consider a resource patch. */
export function hitTestArenaInspection(
  creatures: ReadonlyArray<ArenaSelectableCreature>,
  patches: ReadonlyArray<ArenaPatchPosition>,
  point: ArenaPatchHitTestPoint,
  geometry: ArenaPatchHitTestGeometry,
): ArenaInspectionHit {
  let bestCreature: ArenaSelectableCreature | undefined
  let bestDistance = .05
  for (const creature of creatures) {
    if (!creature.alive) continue
    const distance = Math.hypot(creature.x - point.x, creature.y - point.y)
    if (distance < bestDistance) { bestCreature = creature; bestDistance = distance }
  }
  if (bestCreature) return { kind: 'creature', individualId: bestCreature.individualId }
  const patch = hitTestArenaPatch(patches, point, geometry)
  return patch ? { kind: 'patch', patchId: patch.id } : null
}

export function formatArenaInspectionStatus(selectedIndividualId: number | null, selectedPatchId: number | null, selectedPatchOrdinal: number | null): string {
  if (selectedPatchId !== null) {
    const label = selectedPatchOrdinal !== null ? `Resource patch ${selectedPatchOrdinal}` : 'Resource patch'
    return `${label} selected for inspection. Creature inspection cleared.`
  }
  if (selectedIndividualId !== null) return `Individual ${selectedIndividualId} selected for inspection. Resource-patch inspection cleared.`
  return 'Creature and resource-patch inspection cleared. Nothing is selected.'
}

/** Dispatch exactly one callback for one resolved arena hit. */
export function dispatchArenaInspectionHit(
  hit: ArenaInspectionHit,
  onSelectCreature: (individualId: number | null) => void,
  onSelectPatch: (patchId: number | null) => void,
): void {
  if (hit?.kind === 'creature') onSelectCreature(hit.individualId)
  else if (hit?.kind === 'patch') onSelectPatch(hit.patchId)
  else onSelectCreature(null)
}

export interface ArenaPatchQualityGeometryInput {
  width: number
  height: number
  pad: number
  x: number
  y: number
  radius: number
  labelHalfWidth?: number
  labelHalfHeight?: number
  labelGap?: number
}

export interface ArenaPatchQualityGeometry {
  ringX: number
  ringY: number
  ringRadius: number
  labelX: number
  labelY: number
  labelPlacement: 'above' | 'below' | 'inside'
}

const clampGeometryValue = (value: number, min: number, max: number) => min <= max ? Math.max(min, Math.min(max, value)) : (min + max) / 2

/** Keep quality annotations inside the canvas without detaching the ring from
 * the patch it identifies. Edge rings shrink just enough to remain visible. */
export function arenaPatchQualityGeometry(input: ArenaPatchQualityGeometryInput): ArenaPatchQualityGeometry {
  const width = Number.isFinite(input.width) ? Math.max(0, input.width) : 0
  const height = Number.isFinite(input.height) ? Math.max(0, input.height) : 0
  const pad = Number.isFinite(input.pad) ? Math.max(0, Math.min(Math.min(width, height) / 2, input.pad)) : 0
  const inset = Math.min(2, pad, width / 2, height / 2)
  const left = inset, right = Math.max(left, width - inset), top = inset, bottom = Math.max(top, height - inset)
  const fieldWidth = Math.max(0, right - left), fieldHeight = Math.max(0, bottom - top)
  const requestedRadius = Number.isFinite(input.radius) ? Math.max(0, input.radius) : 0
  const sourceX = Number.isFinite(input.x) ? input.x : (left + right) / 2
  const sourceY = Number.isFinite(input.y) ? input.y : (top + bottom) / 2
  const ringX = clampGeometryValue(sourceX, left, right)
  const ringY = clampGeometryValue(sourceY, top, bottom)
  const ringRadius = Math.max(0, Math.min(requestedRadius, ringX - left, right - ringX, ringY - top, bottom - ringY))
  const halfWidth = Number.isFinite(input.labelHalfWidth) ? Math.max(0, input.labelHalfWidth!) : 18
  const halfHeight = Number.isFinite(input.labelHalfHeight) ? Math.max(0, input.labelHalfHeight!) : 7
  const gap = Number.isFinite(input.labelGap) ? Math.max(0, input.labelGap!) : 5
  const labelX = fieldWidth >= halfWidth * 2
    ? clampGeometryValue(ringX, left + halfWidth, right - halfWidth)
    : (left + right) / 2
  const minLabelY = top + halfHeight, maxLabelY = bottom - halfHeight
  const aboveY = ringY - ringRadius - gap
  const belowY = ringY + ringRadius + gap
  if (aboveY >= minLabelY) return { ringX, ringY, ringRadius, labelX, labelY: aboveY, labelPlacement: 'above' }
  if (belowY <= maxLabelY) return { ringX, ringY, ringRadius, labelX, labelY: belowY, labelPlacement: 'below' }
  return { ringX, ringY, ringRadius, labelX, labelY: clampGeometryValue(ringY, minLabelY, maxLabelY), labelPlacement: 'inside' }
}

/** Canvas geometry uses a 20px minimum inset on each side. During teardown or
 * responsive reflow ResizeObserver can briefly report a smaller box. */
export function arenaCanvasCanDraw(width: number, height: number) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 40 && height > 40
}

export function ArenaCanvas({ world, revision, selectedIndividualId, onSelect, selectedPatchId = null, onSelectPatch = () => {}, arenaFocus, playbackStatus, playbackDetail }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<() => void>(() => {})
  const darkModeRef = useRef<boolean | null>(null)
  if (darkModeRef.current === null) darkModeRef.current = readArenaDarkMode()
  const activitySpotlight = resolveArenaActivitySpotlight(world)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = () => {
      const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1)
      if (!arenaCanvasCanDraw(rect.width, rect.height)) return
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
        canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr)
      }
      const ctx = canvas.getContext('2d'); if (!ctx) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const w = rect.width, h = rect.height, pad = Math.max(20, Math.min(w, h) * .055), palette = arenaCanvasPalette(darkModeRef.current ?? false)
      ctx.clearRect(0, 0, w, h)
      const grad = ctx.createLinearGradient(0, 0, w, h); grad.addColorStop(0, palette.fieldStart); grad.addColorStop(1, palette.fieldEnd)
      ctx.fillStyle = grad; ctx.beginPath(); ctx.roundRect(pad, pad, w - pad * 2, h - pad * 2, Math.min(34, w * .05)); ctx.fill()
      ctx.strokeStyle = palette.fieldBorder; ctx.lineWidth = 1; ctx.stroke()
      ctx.save(); ctx.setLineDash([4, 8]); ctx.strokeStyle = palette.fieldGrid; ctx.strokeRect(pad + 10, pad + 10, w - pad * 2 - 20, h - pad * 2 - 20); ctx.restore()
      const sx = (x: number) => pad + x * (w - pad * 2), sy = (y: number) => pad + y * (h - pad * 2)
      const endpointMarkers: { kind: ArenaHeldPathEndpointKind; x: number; y: number; color: string; size: number }[] = []
      const renderableCreatures = world.creatures.filter(c => c.alive).slice(0, MAX_POPULATION)
      if (arenaFocus !== 'all') for (const c of renderableCreatures) if (arenaTargetPathEligible(arenaFocus, c, selectedIndividualId)) {
        const fromX = sx(c.x), fromY = sy(c.y), targetX = sx(c.targetX), targetY = sy(c.targetY)
        const color = CREATURE_STATE_METADATA[arenaFocus].color
        const endpoint = classifyArenaHeldPathEndpoint(c, world.creatures, world.food)
        ctx.save(); ctx.globalAlpha = .52; ctx.strokeStyle = color; ctx.lineWidth = 1.25; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.lineTo(targetX, targetY); ctx.stroke(); ctx.restore()
        endpointMarkers.push({ kind: endpoint, x: targetX, y: targetY, color, size: Math.max(3, Math.min(w, h) * .009) })
      }
      const selected = world.creatures.find(creature => creature.individualId === selectedIndividualId && creature.alive)
      if (selected) {
        const x = sx(selected.x), y = sy(selected.y), rx = selected.sense * (w - pad * 2), ry = selected.sense * (h - pad * 2), half = world.config.fieldOfView / 360 * Math.PI
        ctx.save(); ctx.fillStyle = palette.sightFill; ctx.strokeStyle = palette.sightStroke; ctx.lineWidth = 1.25; ctx.setLineDash([5, 5]); ctx.beginPath()
        if (world.config.perceptionMode === 'realistic' && world.config.fieldOfView < 359.9) { ctx.moveTo(x, y); ctx.ellipse(x, y, rx, ry, 0, selected.angle - half, selected.angle + half); ctx.closePath() } else ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
        ctx.fill(); ctx.stroke(); ctx.restore()
        const selectedEndpoint = classifyArenaHeldPathEndpoint(selected, world.creatures, world.food)
        if (selectedEndpoint !== 'none' && [selected.x, selected.y, selected.targetX, selected.targetY].every(Number.isFinite)) {
          const targetX = sx(selected.targetX), targetY = sy(selected.targetY)
          ctx.save(); ctx.strokeStyle = palette.targetLine; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(targetX, targetY); ctx.stroke(); ctx.restore()
          endpointMarkers.push({ kind: selectedEndpoint, x: targetX, y: targetY, color: palette.targetLine, size: Math.max(3, Math.min(w, h) * .009) })
        }
        for (const memory of [{ x: selected.memory.foodX, y: selected.memory.foodY, color: palette.memoryFood }, { x: selected.memory.threatX, y: selected.memory.threatY, color: palette.memoryThreat }]) if (memory.x !== null && memory.y !== null) { ctx.save(); ctx.strokeStyle = memory.color; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(sx(memory.x), sy(memory.y), 7, 0, Math.PI * 2); ctx.stroke(); ctx.restore() }
      }
      for (const patch of world.environment.patches) {
        const x = sx(patch.x), y = sy(patch.y), r = arenaPatchHaloRadius(w, h, world.config.foodPatchSpread)
        const advanced = world.config.ecologyMode === 'energy-regrowth'
        const multiplier = advanced ? arenaPatchQualityMultiplier(patch.qualityBias, world.config.patchQualityVariation) : 1
        const qualityColor = arenaQualityColor(multiplier, darkModeRef.current ?? false)
        const halo = ctx.createRadialGradient(x, y, 0, x, y, r); halo.addColorStop(0, palette.patchHaloStart); halo.addColorStop(1, palette.patchHaloEnd)
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
        if (advanced) {
          const qualityTint = Math.max(.05, Math.min(.18, .05 + multiplier / 2 * .13))
          ctx.save(); ctx.globalAlpha = qualityTint; ctx.fillStyle = qualityColor; ctx.beginPath(); ctx.arc(x, y, r * .86, 0, Math.PI * 2); ctx.fill(); ctx.restore()
          const qualityGeometry = arenaPatchQualityGeometry({ width: w, height: h, pad, x, y, radius: Math.max(10, r * .72), labelHalfWidth: 18, labelHalfHeight: 7, labelGap: 5 })
          const stockRadius = Math.max(8, r * .32)
          // The outer dashed ring and compact label communicate quality; the
          // inner complete track plus arc communicate stock independently.
          ctx.save(); ctx.globalAlpha = .72; ctx.strokeStyle = qualityColor; ctx.lineWidth = Math.max(1.5, Math.min(3.5, r * .045)); ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(qualityGeometry.ringX, qualityGeometry.ringY, qualityGeometry.ringRadius, 0, Math.PI * 2); ctx.stroke(); ctx.restore()
          const stockCapacity = Number.isFinite(world.config.patchCapacity) ? Math.max(1, world.config.patchCapacity) : 1
          const stockValue = Number.isFinite(patch.stock) ? Math.max(0, patch.stock) : 0
          const stock = Math.max(0, Math.min(1, stockValue / stockCapacity))
          ctx.save(); ctx.strokeStyle = palette.patchStockTrack; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, stockRadius, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = palette.patchRing; ctx.beginPath(); ctx.arc(x, y, stockRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * stock); ctx.stroke(); ctx.restore()
          ctx.save(); ctx.fillStyle = qualityColor; ctx.font = `700 ${Math.max(8, Math.min(11, r * .19))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${multiplier.toFixed(1)}×`, qualityGeometry.labelX, qualityGeometry.labelY); ctx.restore()
        }
        if (patch.id === selectedPatchId) {
          const selectedRadius = Math.max(arenaPatchCentralRingRadius(w, h, world.config.foodPatchSpread) + 7, r * .92)
          const ordinal = arenaPatchOrdinal(world.environment.patches, patch.id)
          const label = ordinal === null ? 'Selected patch' : `Patch ${ordinal}`
          const selectedGeometry = arenaPatchQualityGeometry({ width: w, height: h, pad, x, y, radius: selectedRadius, labelHalfWidth: Math.max(18, label.length * 3.2), labelHalfHeight: 7, labelGap: 18 })
          ctx.save(); ctx.strokeStyle = palette.selectedRing; ctx.globalAlpha = .98; ctx.lineWidth = Math.max(2.4, Math.min(4, r * .055)); ctx.setLineDash([7, 3]); ctx.beginPath(); ctx.arc(selectedGeometry.ringX, selectedGeometry.ringY, selectedGeometry.ringRadius, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; ctx.globalAlpha = .95; ctx.beginPath(); ctx.arc(selectedGeometry.ringX, selectedGeometry.ringY, selectedGeometry.ringRadius + 3, 0, Math.PI * 2); ctx.stroke(); ctx.restore()
          ctx.save(); ctx.fillStyle = palette.selectedRing; ctx.font = `700 ${Math.max(8, Math.min(11, r * .2))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(12, 26, 19, .8)'; ctx.shadowBlur = 3; ctx.fillText(label, selectedGeometry.labelX, selectedGeometry.labelY); ctx.restore()
        }
      }
      for (const obstacle of world.environment.obstacles) {
        const x = sx(obstacle.x), y = sy(obstacle.y), r = obstacle.radius * Math.min(w - pad * 2, h - pad * 2)
        ctx.fillStyle = palette.obstacleShadow; ctx.beginPath(); ctx.ellipse(x + 2, y + r * .72, r * 1.04, r * .36, 0, 0, Math.PI * 2); ctx.fill()
        const rock = ctx.createRadialGradient(x - r * .25, y - r * .3, 2, x, y, r); rock.addColorStop(0, palette.obstacleStart); rock.addColorStop(1, palette.obstacleEnd)
        ctx.fillStyle = rock; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = palette.obstacleStroke; ctx.stroke()
      }
      for (const f of world.food) {
        const x = sx(f.x), y = sy(f.y), baseRadius = Math.max(3.5, Math.min(w, h) * .008)
        const baseEnergy = world.config.foodEnergy
        const energyRatio = world.config.ecologyMode === 'energy-regrowth' && Number.isFinite(f.energy) && Number.isFinite(baseEnergy) && baseEnergy > 0
          ? Math.max(.25, Math.min(2, f.energy / baseEnergy))
          : 1
        const r = baseRadius * (world.config.ecologyMode === 'energy-regrowth' ? .82 + energyRatio * .18 : 1)
        ctx.fillStyle = palette.foodShadow; ctx.beginPath(); ctx.ellipse(x + 1, y + r * .9, r * 1.2, r * .38, 0, 0, Math.PI * 2); ctx.fill()
        const g = ctx.createRadialGradient(x - r * .25, y - r * .35, 1, x, y, r); g.addColorStop(0, palette.foodStart); g.addColorStop(.4, palette.foodMiddle); g.addColorStop(1, palette.foodEnd)
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      }
      const sorted = renderableCreatures.sort((a, b) => a.y - b.y)
      for (const c of sorted) {
        const x = sx(c.x), y = sy(c.y), base = Math.max(7, Math.min(w, h) * .017 * c.size), height = base * 1.55
        const stateKey = c.home ? 'safe' : c.mode
        const state = CREATURE_STATE_METADATA[stateKey]
        ctx.save(); ctx.globalAlpha = arenaCreatureAlpha(arenaFocus, stateKey, c.individualId === selectedIndividualId)
        ctx.fillStyle = palette.creatureShadow; ctx.beginPath(); ctx.ellipse(x, y + base * .46, base * .9, base * .3, 0, 0, Math.PI * 2); ctx.fill()
        if (selected && c.individualId !== selected.individualId && c.lineageId === selected.lineageId) { ctx.save(); ctx.globalAlpha = arenaLineageRingAlpha(); ctx.strokeStyle = palette.lineageRing; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(x, y - height * .35, base * 1.35, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.restore() }
        if (c.individualId === selectedIndividualId) { ctx.strokeStyle = palette.selectedRing; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y - height * .35, base * 1.5, 0, Math.PI * 2); ctx.stroke() }
        const orientation = Math.hypot(c.vx, c.vy) > .001 ? Math.atan2(c.vy, c.vx) : c.angle
        ctx.save(); ctx.translate(x, y); ctx.rotate(orientation + Math.PI / 2)
        const g = ctx.createLinearGradient(-base, -height, base, base * .45); g.addColorStop(0, palette.creatureHighlight); g.addColorStop(.25, speedColor(c.speed)); g.addColorStop(1, palette.creatureBodyEnd)
        const bodyPath = () => { ctx.beginPath(); ctx.moveTo(-base * .78, base * .35); ctx.bezierCurveTo(-base * 1.05, -height * .18, -base * .56, -height, 0, -height); ctx.bezierCurveTo(base * .56, -height, base * 1.05, -height * .18, base * .78, base * .35); ctx.quadraticCurveTo(0, base * .65, -base * .78, base * .35); ctx.closePath() }
        ctx.fillStyle = g; bodyPath(); ctx.fill()
        ctx.lineJoin = 'round'; ctx.strokeStyle = palette.creatureEdge; ctx.lineWidth = 4.8; bodyPath(); ctx.stroke()
        ctx.strokeStyle = state.color; ctx.lineWidth = 2.6; bodyPath(); ctx.stroke()
        const look = Math.cos(c.angle) * base * .1
        ctx.fillStyle = palette.creatureEye; ctx.beginPath(); ctx.arc(-base * .25 + look, -height * .55, Math.max(1.2, base * .075), 0, Math.PI * 2); ctx.arc(base * .25 + look, -height * .55, Math.max(1.2, base * .075), 0, Math.PI * 2); ctx.fill()
        if (c.food > 0) { ctx.fillStyle = palette.creatureFoodLabel; ctx.font = `600 ${Math.max(8, base * .55)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText(String(c.food), 0, base * .15) }
        ctx.restore()
        ctx.restore()
      }
      if (activitySpotlight) drawArenaActivitySpotlight(ctx, activitySpotlight, w, h, sx, sy)
      const pct = Math.min(1, world.dayTime / world.config.dayLength)
      ctx.fillStyle = palette.progressTrack; ctx.fillRect(pad, pad - 9, w - pad * 2, 3)
      ctx.fillStyle = palette.progressFill; ctx.fillRect(pad, pad - 9, (w - pad * 2) * pct, 3)
      for (const marker of endpointMarkers) drawHeldPathEndpoint(ctx, marker.kind, marker.x, marker.y, marker.color, marker.size)
    }
    drawRef.current = draw; draw()
  }, [world, revision, selectedIndividualId, selectedPatchId, arenaFocus])
  useEffect(() => {
    const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(ARENA_COLOR_SCHEME_QUERY) : null
    if (!query) return
    return listenToArenaColorScheme(query, darkModeRef.current ?? false, darkMode => {
      if (darkMode === darkModeRef.current) return
      darkModeRef.current = darkMode
      drawRef.current()
    })
  }, [])
  useEffect(() => { const canvas = ref.current; if (!canvas || typeof ResizeObserver === 'undefined') return; const observer = new ResizeObserver(() => drawRef.current()); observer.observe(canvas); return () => observer.disconnect() }, [])
  const chooseAt = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = ref.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (!arenaCanvasCanDraw(rect.width, rect.height)) return
    const pad = Math.max(20, Math.min(rect.width, rect.height) * .055)
    const x = (event.clientX - rect.left - pad) / (rect.width - pad * 2)
    const y = (event.clientY - rect.top - pad) / (rect.height - pad * 2)
    const hit = hitTestArenaInspection(world.creatures, world.environment.patches, { x, y }, { width: rect.width, height: rect.height, pad, foodPatchSpread: world.config.foodPatchSpread })
    dispatchArenaInspectionHit(hit, onSelect, onSelectPatch)
  }
  const livingCreatures = world.creatures.filter(c => c.alive)
  const selected = world.creatures.find(creature => creature.individualId === selectedIndividualId && creature.alive)
  const stateCounts: Record<CreatureState, number> = { safe: 0, exploring: 0, foraging: 0, hunting: 0, fleeing: 0, returning: 0 }
  for (const creature of livingCreatures) stateCounts[creature.home ? 'safe' : creature.mode]++
  const stateSummary = (Object.entries(CREATURE_STATE_METADATA) as [CreatureState, (typeof CREATURE_STATE_METADATA)[CreatureState]][]).map(([state, metadata]) => `${stateCounts[state]} ${metadata.label.toLowerCase()}`).join(', ')
  const selectedState = selected ? (selected.home ? 'safe' : selected.mode) : null
  const selectedPatchOrdinal = arenaPatchOrdinal(world.environment.patches, selectedPatchId)
  const accessibleBaseDescription = formatArenaAccessibleDescription({ generation: world.generation, livingCreatures: livingCreatures.length, stateSummary, foodCount: world.food.length, patchCount: world.environment.patches.length, foodBudget: world.environment.foodBudget, obstacleCount: world.environment.obstacles.length, ecologyMode: world.config.ecologyMode, patchQualityVariation: world.config.ecologyMode === 'energy-regrowth' ? world.config.patchQualityVariation : undefined, patchQualityRange: world.config.ecologyMode === 'energy-regrowth' ? arenaPatchQualityRange(world.environment.patches, world.config.patchQualityVariation) : undefined, hasSelectedCreature: Boolean(selected), hasSelectedPatch: selectedPatchId !== null && selectedPatchOrdinal !== null, selectedIsHunting: selected?.mode === 'hunting', focus: arenaFocus, focusCount: arenaFocus === 'all' ? livingCreatures.length : stateCounts[arenaFocus], selectedOutsideFocus: arenaFocus !== 'all' && selectedState !== null && selectedState !== arenaFocus, playbackStatus, playbackDetail })
  const patchSelectionDescription = selectedPatchId !== null && selectedPatchOrdinal !== null
    ? `Resource patch ${selectedPatchOrdinal} is selected for inspection; its live food, capacity, energy, and regrowth details appear below the arena.`
    : ''
  const activitySpotlightDescription = activitySpotlight ? formatArenaActivitySpotlightDescription(activitySpotlight) : ''
  const accessibleDescription = `${accessibleBaseDescription} ${patchSelectionDescription}${activitySpotlightDescription ? ` ${activitySpotlightDescription}` : ''} The combined selector includes living creatures and resource patches.`
  const patchOptions = sortArenaPatches(world.environment.patches).map((patch, index) => {
    const ordinal = index + 1
    const currentFood = world.food.filter(food => food.patchId === patch.id).length
    const multiplier = world.config.ecologyMode === 'energy-regrowth' ? arenaPatchQualityMultiplier(patch.qualityBias, world.config.patchQualityVariation) : 1
    const quality = world.config.ecologyMode === 'energy-regrowth'
      ? `${multiplier.toFixed(1)}×`
      : 'classic'
    return { patch, ordinal, currentFood, quality }
  })
  const selectedValue = selectedIndividualId !== null
    ? `creature:${selectedIndividualId}`
    : selectedPatchOrdinal !== null
      ? `patch:${selectedPatchOrdinal}`
      : ''
  const selectInspection = (value: string) => {
    if (!value) {
      dispatchArenaInspectionHit(null, onSelect, onSelectPatch)
      return
    }
    if (value.startsWith('creature:')) {
      const individualId = Number(value.slice('creature:'.length))
      dispatchArenaInspectionHit(Number.isSafeInteger(individualId) ? { kind: 'creature', individualId } : null, onSelect, onSelectPatch)
      return
    }
    if (value.startsWith('patch:')) {
      const ordinal = Number(value.slice('patch:'.length))
      const option = Number.isSafeInteger(ordinal) && ordinal > 0 ? patchOptions[ordinal - 1] : undefined
      if (option) dispatchArenaInspectionHit({ kind: 'patch', patchId: option.patch.id }, onSelect, onSelectPatch)
      else onSelectPatch(null)
      return
    }
    dispatchArenaInspectionHit(null, onSelect, onSelectPatch)
  }
  return <><canvas ref={ref} className="arena" role="img" onClick={chooseAt} aria-label={accessibleDescription} data-arena-activity-spotlight={activitySpotlight ? 'true' : undefined} data-arena-activity-spotlight-sequence={activitySpotlight?.sequence} data-arena-activity-spotlight-kind={activitySpotlight?.kind} data-arena-activity-spotlight-tick={activitySpotlight?.tick} data-arena-activity-spotlight-age={activitySpotlight?.age} data-arena-activity-spotlight-actors={activitySpotlight?.actors.map(actor => actor.individualId).join(',')}>
    Natural selection simulation arena. Live counts are available in the statistics region.
  </canvas><label className="creature-picker" htmlFor="arena-creature-picker">Inspect <select id="arena-creature-picker" aria-label="Inspect creatures or resource patches" aria-describedby="arena-creature-picker-help" value={selectedValue} onChange={e => selectInspection(e.target.value)} style={{ background: 'var(--paper)', color: 'var(--ink)', colorScheme: 'light dark', minHeight: 32, touchAction: 'manipulation' }}><option value="">Nothing selected</option><optgroup label="Creatures">{livingCreatures.slice().sort((a, b) => a.individualId - b.individualId).map(c => <option key={`creature:${c.individualId}`} value={`creature:${c.individualId}`}>Individual {c.individualId}, lineage {c.lineageId}, {CREATURE_STATE_METADATA[c.home ? 'safe' : c.mode].label}</option>)}</optgroup>{patchOptions.length > 0 && <optgroup label="Resource patches">{patchOptions.map(({ patch, ordinal, currentFood, quality }) => <option key={`patch:${ordinal}`} value={`patch:${ordinal}`}>Patch {ordinal} · {quality} · {currentFood} food</option>)}</optgroup>}</select></label><span id="arena-creature-picker-help" className="sr-only">Choose a living creature or resource patch to inspect. Creature options reveal behavior; patch options reveal live food, capacity, energy, and regrowth. Choose Nothing selected to clear inspection.</span><span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{formatArenaInspectionStatus(selectedIndividualId, selectedPatchId, selectedPatchOrdinal)}</span></>
}
