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
import {
  formatActivityContext,
  formatActivityMoment,
  normalizeActivityMoment,
  type SimulationActivityMoment,
} from './SimulationActivity'

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
const ARENA_ACTIVITY_SPOTLIGHT_KEY_COPY = 'Latest actor halo marks each actor’s current arena position; role tags identify recorded roles there. Neither shows the historical event location.'

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
  /** Source-array index keeps duplicate sequence records aligned with their exact event copy. */
  sourceIndex: number
  sequence: number
  generation: number
  kind: WorldActivityKind
  tick: number
  age: number
  alpha: number
  actors: ArenaActivitySpotlightActor[]
  /** Absent when the raw record could support only a generic halo (for example, a malformed summary). */
  activityMoment: SimulationActivityMoment | null
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

function arenaActiveMode(value: unknown): value is Exclude<CreatureState, 'safe'> {
  return value === 'exploring' || value === 'foraging' || value === 'hunting' || value === 'fleeing' || value === 'returning'
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
    // Normalize this exact source record without sorting the bounded activity
    // buffer on every arena frame. The source index keeps duplicate sequences
    // tied to their own summary and context.
    const normalizedMoment = normalizeActivityMoment(entry, sourceIndex)
    const rawSequence = arenaField(entry, 'sequence')
    const sequence = normalizedMoment?.sequence ?? (rawSequence === undefined ? sourceIndex + 1 : arenaSafeInteger(rawSequence, 1))
    const eventGeneration = normalizedMoment?.generation ?? arenaSafeGeneration(arenaField(entry, 'generation'))
    const tick = normalizedMoment?.tick ?? arenaSafeInteger(arenaField(entry, 'tick'), 0)
    const kind = normalizedMoment?.kind ?? arenaField(entry, 'kind')
    if (sequence === null || eventGeneration === null || eventGeneration !== generation || tick === null || tick > currentTick || !arenaActivityKind(kind) || ARENA_ACTIVITY_AGGREGATE_KINDS.has(kind)) continue
    const age = currentTick - tick
    if (age > windowTicks) continue
    const refs = arenaOrderedActorRefs(normalizedMoment ?? entry, kind)
    const actors: ArenaActivitySpotlightActor[] = []
    for (const ref of refs) {
      const current = currentActors.get(ref.individualId)
      if (!current) continue
      actors.push({ ...ref, roleLabel: arenaActorRoleLabel(ref.role), ...current })
    }
    const cappedActors = actors.slice(0, MAX_FOUNDER_MIGRATION_BATCH)
    if (!cappedActors.length) continue
    const candidate: ArenaActivitySpotlight = { sourceIndex, sequence, generation, kind, tick, age, alpha: arenaActivitySpotlightAlpha(age, windowTicks), actors: cappedActors, activityMoment: normalizedMoment }
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

export interface ArenaActivitySpotlightCue {
  sequence: number
  kind: WorldActivityKind
  compact: string
  event: string
  context: string
  description: string
}

export const ARENA_ACTIVITY_SPOTLIGHT_COMPACT_LIMIT = 76

function formatArenaActivitySpotlightContestPercent(chance: number): string {
  const percent = chance * 100
  if (percent > 0 && percent < .01) return '<0.01'
  if (percent < .1) return percent.toFixed(2)
  if (percent < 10) return percent.toFixed(1)
  return percent.toFixed(0)
}

export function formatArenaActivitySpotlightCompact(moment: Pick<SimulationActivityMoment, 'kind' | 'kindLabel' | 'summary' | 'attackerId' | 'preyId' | 'contestChance'>): string {
  const attack = (moment.kind === 'attack-success' || moment.kind === 'attack-failure') && moment.attackerId !== null && moment.preyId !== null
  const copy = attack
    ? `Highlighted · ${moment.kindLabel} · Individual ${moment.attackerId} → Individual ${moment.preyId}${moment.contestChance === null ? '' : ` · ${formatArenaActivitySpotlightContestPercent(moment.contestChance)}% contest`}`
    : `Highlighted · ${moment.kindLabel} · ${moment.summary}`
  return copy.length <= ARENA_ACTIVITY_SPOTLIGHT_COMPACT_LIMIT
    ? copy
    : `${copy.slice(0, ARENA_ACTIVITY_SPOTLIGHT_COMPACT_LIMIT - 1).trimEnd()}…`
}

export interface ArenaActivitySpotlightTag {
  individualId: number
  role: ArenaActivitySpotlightRole
  label: string
  x: number
  y: number
  size: number
}

export interface ArenaActivitySpotlightTagRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ArenaActivitySpotlightTagGeometryInput {
  width: number
  height: number
  pad: number
  /** Normalized current actor position, matching the spotlight actor shape. */
  x: number
  y: number
  size?: number
  individualId: number
  role: ArenaActivitySpotlightRole
  label?: string
  compact?: boolean
  occupied?: readonly ArenaActivitySpotlightTagRect[]
  anchors?: readonly ArenaActivitySpotlightTagRect[]
}

export interface ArenaActivitySpotlightTagGeometry extends ArenaActivitySpotlightTagRect {
  placement: 'above-right' | 'above-left' | 'below-right' | 'below-left' | 'above' | 'below' | 'detached-above' | 'detached-below'
  actorX: number
  actorY: number
  haloRadius: number
  leaderStartX: number
  leaderStartY: number
  leaderEndX: number
  leaderEndY: number
}

function arenaActivitySpotlightRole(value: unknown): value is ArenaActivitySpotlightRole {
  return value === 'attacker' || value === 'prey' || value === 'collector' || value === 'returning individual' || value === 'involved individual'
}

/** Short, role-specific labels keep the two-actor overlay readable at mobile sizes. */
export function formatArenaActivitySpotlightTagLabel(actor: Pick<ArenaActivitySpotlightActor, 'role' | 'individualId'>): string {
  const role = actor.role === 'returning individual' ? 'Returning' : actor.role === 'involved individual' ? 'Involved' : actor.role[0].toUpperCase() + actor.role.slice(1)
  return role + ' · Individual ' + actor.individualId
}

/** Tags are intentionally limited to attack pairs or one-actor records. */
export function deriveArenaActivitySpotlightTags(spotlight: unknown): ArenaActivitySpotlightTag[] {
  const actors = arenaSafeArray(arenaField(spotlight, 'actors'))
  if (actors.length === 0 || actors.length > 2) return []
  const tags: ArenaActivitySpotlightTag[] = []
  for (let index = 0; index < actors.length; index++) {
    const actor = actors[index]
    const individualId = arenaSafeInteger(arenaField(actor, 'individualId'), 1)
    const role = arenaField(actor, 'role')
    const x = arenaFinite(arenaField(actor, 'x'))
    const y = arenaFinite(arenaField(actor, 'y'))
    const size = arenaFinite(arenaField(actor, 'size'))
    if (individualId === null || !arenaActivitySpotlightRole(role) || x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1 || size === null || size <= 0) continue
    tags.push({
      individualId,
      role,
      label: formatArenaActivitySpotlightTagLabel({ role, individualId }),
      x,
      y,
      size: Math.max(.3, Math.min(2.8, size)),
    })
  }
  return tags
}

const arenaActivitySpotlightTagClamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value))

/**
 * Place one role/Individual pill just outside its current-position halo.
 * Placement is deterministic, finite-data guarded, and collision-aware; a
 * missing safe slot is reported as null so a label never covers the actor.
 */
export function arenaActivitySpotlightTagGeometry(input: ArenaActivitySpotlightTagGeometryInput): ArenaActivitySpotlightTagGeometry | null {
  if (![input.width, input.height, input.pad, input.x, input.y, input.individualId].every(Number.isFinite) || !Number.isSafeInteger(input.individualId) || input.individualId < 1 || !arenaActivitySpotlightRole(input.role)) return null
  if (input.width <= 0 || input.height <= 0 || input.x < 0 || input.x > 1 || input.y < 0 || input.y > 1) return null
  const width = input.width
  const height = input.height
  const pad = Math.min(Math.min(width, height) / 2, Math.max(0, input.pad))
  const left = pad
  const right = Math.max(left, width - pad)
  const top = pad
  const bottom = Math.max(top, height - pad)
  const fieldWidth = right - left
  const fieldHeight = bottom - top
  if (![left, right, top, bottom, fieldWidth, fieldHeight].every(Number.isFinite) || fieldWidth <= 1 || fieldHeight <= 1) return null
  const sizeValue = typeof input.size === 'number' && Number.isFinite(input.size) && input.size > 0 ? input.size : 1
  const size = Math.max(.3, Math.min(2.8, sizeValue))
  const extent = Math.min(width, height)
  const base = Math.max(7, extent * .017 * size)
  const actorX = left + input.x * fieldWidth
  const actorY = top + input.y * fieldHeight - base * 1.55 * .35
  const haloRadius = Math.max(base * 2.15, 15)
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : formatArenaActivitySpotlightTagLabel({ role: input.role, individualId: input.individualId })
  const desiredWidth = Math.max(input.compact ? 64 : 78, label.length * 6.25 + 14)
  const maximumWidth = input.compact ? 96 : 156
  const boxWidth = Math.min(fieldWidth, maximumWidth, desiredWidth)
  const boxHeight = Math.min(fieldHeight, input.compact ? 18 : 24)
  const gap = input.compact ? 2 : 6
  if (![actorX, actorY, haloRadius, boxWidth, boxHeight].every(Number.isFinite) || boxWidth <= 1 || boxHeight <= 1) return null
  const candidate = (placement: ArenaActivitySpotlightTagGeometry['placement'], x: number, y: number) => ({ placement, x, y })
  const rightCandidates = [
    candidate('above-right', actorX + haloRadius + gap, actorY - haloRadius - gap - boxHeight),
    candidate('below-right', actorX + haloRadius + gap, actorY + haloRadius + gap),
  ]
  const leftCandidates = [
    candidate('above-left', actorX - haloRadius - gap - boxWidth, actorY - haloRadius - gap - boxHeight),
    candidate('below-left', actorX - haloRadius - gap - boxWidth, actorY + haloRadius + gap),
  ]
  const centeredX = arenaActivitySpotlightTagClamp(actorX - boxWidth / 2, left, Math.max(left, right - boxWidth))
  const above = candidate('above', centeredX, actorY - haloRadius - gap - boxHeight)
  const below = candidate('below', centeredX, actorY + haloRadius + gap)
  const candidates: Array<{ placement: ArenaActivitySpotlightTagGeometry['placement']; x: number; y: number }> = input.role === 'attacker'
    ? [...rightCandidates, ...leftCandidates, above, below]
    : input.role === 'prey'
      ? [...leftCandidates, ...rightCandidates, below, above]
      : input.x <= .5
        ? [...rightCandidates, ...leftCandidates, above, below]
        : [...leftCandidates, ...rightCandidates, above, below]
  const anchors = (input.anchors ?? []).filter(rect => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0)
  for (const anchor of anchors) {
    const anchorXs = [centeredX, left, Math.max(left, right - boxWidth)]
    for (const x of anchorXs) {
      candidates.push(candidate('detached-above', x, anchor.y - gap - boxHeight))
      candidates.push(candidate('detached-below', x, anchor.y + anchor.height + gap))
    }
  }
  const occupied = [...(input.occupied ?? []), ...anchors]
  const safeOccupied = occupied.filter(rect => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0)
  const fits = (rect: { x: number; y: number }) => rect.x >= left && rect.y >= top && rect.x + boxWidth <= right && rect.y + boxHeight <= bottom
  const overlaps = (rect: { x: number; y: number }) => safeOccupied.some(other => rect.x < other.x + other.width + gap && rect.x + boxWidth + gap > other.x && rect.y < other.y + other.height + gap && rect.y + boxHeight + gap > other.y)
  const clearsHalo = (rect: { x: number; y: number }) => {
    const nearestX = arenaActivitySpotlightTagClamp(actorX, rect.x, rect.x + boxWidth)
    const nearestY = arenaActivitySpotlightTagClamp(actorY, rect.y, rect.y + boxHeight)
    return Math.hypot(actorX - nearestX, actorY - nearestY) >= haloRadius + gap
  }
  const chosen = candidates.find(rect => fits(rect) && !overlaps(rect) && clearsHalo(rect))
  if (!chosen) return null
  const nearestX = arenaActivitySpotlightTagClamp(actorX, chosen.x, chosen.x + boxWidth)
  const nearestY = arenaActivitySpotlightTagClamp(actorY, chosen.y, chosen.y + boxHeight)
  const deltaX = nearestX - actorX
  const deltaY = nearestY - actorY
  const distance = Math.hypot(deltaX, deltaY)
  const leaderStartX = arenaActivitySpotlightTagClamp(actorX + (distance > 0 ? deltaX / distance * (haloRadius + 1) : 0), left, right)
  const leaderStartY = arenaActivitySpotlightTagClamp(actorY + (distance > 0 ? deltaY / distance * (haloRadius + 1) : 0), top, bottom)
  const leaderEndX = arenaActivitySpotlightTagClamp(nearestX, left, right)
  const leaderEndY = arenaActivitySpotlightTagClamp(nearestY, top, bottom)
  return { x: chosen.x, y: chosen.y, width: boxWidth, height: boxHeight, placement: chosen.placement, actorX: arenaActivitySpotlightTagClamp(actorX, left, right), actorY: arenaActivitySpotlightTagClamp(actorY, top, bottom), haloRadius, leaderStartX, leaderStartY, leaderEndX, leaderEndY }
}

function formatArenaActivitySpotlightCue(spotlight: ArenaActivitySpotlight, config: unknown): ArenaActivitySpotlightCue | null {
  const moment = spotlight.activityMoment
  if (!moment || moment.sourceIndex !== spotlight.sourceIndex || moment.sequence !== spotlight.sequence || moment.kind !== spotlight.kind || moment.tick !== spotlight.tick || moment.generation !== spotlight.generation) return null
  const event = formatActivityMoment(moment)
  const context = formatActivityContext(moment, config)
  return {
    sequence: spotlight.sequence,
    kind: spotlight.kind,
    compact: formatArenaActivitySpotlightCompact(moment),
    event,
    context,
    description: `Highlighted event: ${event} ${context}`,
  }
}

export function deriveArenaActivitySpotlightCue(world: unknown): ArenaActivitySpotlightCue | null {
  const spotlight = resolveArenaActivitySpotlight(world)
  return spotlight ? formatArenaActivitySpotlightCue(spotlight, arenaField(world, 'config')) : null
}

export function ArenaActivitySpotlightKey({ world, compact = false }: { world: World; compact?: boolean }): React.ReactElement | null {
  const spotlight = resolveArenaActivitySpotlight(world)
  if (!spotlight) return null
  const cue = formatArenaActivitySpotlightCue(spotlight, world.config)
  if (compact) return cue
    ? <strong data-arena-activity-spotlight-cue="true" data-arena-activity-spotlight-key-sequence={cue.sequence}>{cue.compact}</strong>
    : null
  return <>
    {cue && <><strong data-arena-activity-spotlight-event="true" data-arena-activity-spotlight-event-sequence={cue.sequence}>{cue.event}</strong><small data-arena-activity-spotlight-context="true" style={{ flexBasis: '100%', textAlign: 'right', lineHeight: 1.4, overflowWrap: 'anywhere' }}>{cue.context}</small></>}
    <strong data-arena-activity-spotlight-key="true" data-arena-activity-spotlight-key-sequence={spotlight.sequence}>{ARENA_ACTIVITY_SPOTLIGHT_KEY_COPY}</strong>
  </>
}

export interface ArenaSelectedCreatureCallout {
  individualId: number
  state: CreatureState
  title: string
  detail: string
  description: string
  x: number
  y: number
  size: number
}

type ArenaCalloutTarget = { detail: string; accessible: string }

function arenaTargetPointAvailable(value: unknown): boolean {
  const x = arenaFinite(arenaField(value, 'targetX'))
  const y = arenaFinite(arenaField(value, 'targetY'))
  return x !== null && y !== null && x >= 0 && x <= 1 && y >= 0 && y <= 1
}

function arenaHasEntity(items: readonly unknown[], id: number, requireLiving = false): { entity: unknown; individualId?: number } | null {
  for (let index = 0; index < arenaArrayLength(items); index++) {
    let item: unknown
    try {
      item = items[index]
    } catch {
      continue
    }
    if (arenaSafeInteger(arenaField(item, 'id'), 1) !== id) continue
    if (requireLiving && arenaField(item, 'alive') !== true) continue
    const individualId = arenaSafeInteger(arenaField(item, 'individualId'), 1)
    if (requireLiving && individualId === null) continue
    return { entity: item, individualId: individualId ?? undefined }
  }
  return null
}

function arenaCalloutTarget(selected: unknown, world: unknown, targetType: unknown): ArenaCalloutTarget {
  const targetId = arenaSafeInteger(arenaField(selected, 'targetId'), 1)
  const targetPoint = arenaTargetPointAvailable(selected)
  const food = arenaSafeArray(arenaField(world, 'food'))
  const creatures = arenaSafeArray(arenaField(world, 'creatures'))
  if (targetType === 'food') {
    if (targetId !== null && arenaHasEntity(food, targetId)) return { detail: 'Held: food item', accessible: 'a food item' }
    return targetPoint
      ? { detail: 'Held: food gone · last-known point', accessible: 'food gone at its last-known point' }
      : { detail: 'Held: food target unavailable', accessible: 'a food target with current status unavailable' }
  }
  if (targetType === 'prey') {
    const prey = targetId === null ? null : arenaHasEntity(creatures, targetId, true)
    if (prey?.individualId !== undefined) return { detail: `Held: prey · Individual ${prey.individualId}`, accessible: `prey Individual ${prey.individualId}` }
    return targetPoint
      ? { detail: 'Held: prey gone · last-known point', accessible: 'prey gone at its last-known point' }
      : { detail: 'Held: prey target unavailable', accessible: 'a prey target with current status unavailable' }
  }
  if (targetType === 'threat') {
    const threat = targetId === null ? null : arenaHasEntity(creatures, targetId, true)
    if (threat?.individualId !== undefined) return targetPoint
      ? { detail: `Held: escape waypoint · threat Individual ${threat.individualId}`, accessible: `an escape waypoint for threat Individual ${threat.individualId}` }
      : { detail: `Held: threat · Individual ${threat.individualId}`, accessible: `threat Individual ${threat.individualId}` }
    if (targetId === null) return targetPoint
      ? { detail: 'Held: escape waypoint · remembered threat', accessible: 'an escape waypoint for a remembered threat' }
      : { detail: 'Held: threat target unavailable', accessible: 'a threat target with current status unavailable' }
    return targetPoint
      ? { detail: 'Held: escape waypoint · threat gone', accessible: 'an escape waypoint for a threat that is gone' }
      : { detail: 'Held: threat target unavailable', accessible: 'a threat target with current status unavailable' }
  }
  if (targetType === 'home') return { detail: 'Held: home', accessible: 'home' }
  if (targetType === 'memory') return { detail: 'Held: remembered food', accessible: 'remembered food' }
  if (targetType === 'explore') return { detail: 'Held: exploration waypoint', accessible: 'an exploration waypoint' }
  if (targetType === null) return { detail: 'Held: no target', accessible: 'no target' }
  return { detail: 'Held: target unavailable', accessible: 'a target whose type is unavailable' }
}

/** Derive a compact selected-actor callout from current state and held target fields only. */
export function deriveArenaSelectedCreatureCallout(world: unknown, selectedIndividualId: unknown): ArenaSelectedCreatureCallout | null {
  const id = arenaSafeInteger(selectedIndividualId, 1)
  if (id === null) return null
  const creatures = arenaSafeArray(arenaField(world, 'creatures'))
  let selected: unknown = null
  for (let index = 0; index < arenaArrayLength(creatures); index++) {
    let creature: unknown
    try {
      creature = creatures[index]
    } catch {
      continue
    }
    if (arenaSafeInteger(arenaField(creature, 'individualId'), 1) === id && arenaField(creature, 'alive') === true) {
      selected = creature
      break
    }
  }
  if (!selected) return null
  const x = arenaFinite(arenaField(selected, 'x'))
  const y = arenaFinite(arenaField(selected, 'y'))
  const home = arenaField(selected, 'home')
  const mode = arenaField(selected, 'mode')
  if (x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1 || typeof home !== 'boolean' || (!home && !arenaActiveMode(mode))) return null
  const state = (home ? 'safe' : mode) as CreatureState
  const targetType = arenaField(selected, 'targetType')
  const target = arenaCalloutTarget(selected, world, targetType)
  const action = CREATURE_STATE_METADATA[state].label
  const sizeValue = arenaFinite(arenaField(selected, 'size'))
  const size = sizeValue !== null && sizeValue > 0 ? Math.max(.3, Math.min(2.8, sizeValue)) : 1
  return {
    individualId: id,
    state,
    title: `Individual ${id} · ${action}`,
    detail: target.detail,
    description: targetType === null
      ? `Selected Individual ${id} is currently ${action.toLowerCase()}; no held target has been captured yet.`
      : `Selected Individual ${id} is currently ${action.toLowerCase()}; its held target from the last decision is ${target.accessible}.`,
    x,
    y,
    size,
  }
}

export interface ArenaSelectedCreatureCalloutGeometryInput {
  width: number
  height: number
  pad: number
  x: number
  y: number
  size?: number
  compact?: boolean
}

export interface ArenaSelectedCreatureCalloutGeometry {
  x: number
  y: number
  width: number
  height: number
  placement: 'above-right' | 'above-left' | 'below-right' | 'below-left' | 'above-clamped' | 'below-clamped' | 'left' | 'right' | 'overlay-band' | 'clamped'
  leaderStartX: number
  leaderStartY: number
  leaderEndX: number
  leaderEndY: number
}

function arenaClamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

/** Place the callout near the actor while keeping its box and leader endpoints inside the padded field. */
export function arenaSelectedCreatureCalloutGeometry(input: ArenaSelectedCreatureCalloutGeometryInput): ArenaSelectedCreatureCalloutGeometry {
  const width = Number.isFinite(input.width) && input.width > 0 ? input.width : 300
  const height = Number.isFinite(input.height) && input.height > 0 ? input.height : 276
  const rawPad = Number.isFinite(input.pad) && input.pad >= 0 ? input.pad : 20
  const pad = Math.min(Math.min(width, height) / 2, rawPad)
  const left = pad
  const right = Math.max(left, width - pad)
  const top = pad
  const bottom = Math.max(top, height - pad)
  const fieldWidth = Math.max(1, right - left)
  const fieldHeight = Math.max(1, bottom - top)
  const normalizedX = Number.isFinite(input.x) ? arenaClamp(input.x, 0, 1) : .5
  const normalizedY = Number.isFinite(input.y) ? arenaClamp(input.y, 0, 1) : .5
  const safeSize = Number.isFinite(input.size) && input.size! > 0 ? Math.max(.3, Math.min(2.8, input.size!)) : 1
  const base = Math.max(7, Math.min(width, height) * .017 * safeSize)
  const selectedRingRadius = base * 1.5
  const leaderStartX = arenaClamp(left + normalizedX * fieldWidth, left, right)
  const leaderStartY = arenaClamp(top + normalizedY * fieldHeight - base * 1.55 * .35, top, bottom)
  const requestedWidth = input.compact ? 148 : 190
  const boxWidth = Math.min(fieldWidth, requestedWidth)
  const boxHeight = Math.min(fieldHeight, 40)
  const gap = 8
  const actorOffset = selectedRingRadius + gap
  const centeredX = arenaClamp(leaderStartX - boxWidth / 2, left, Math.max(left, right - boxWidth))
  const centeredY = arenaClamp(leaderStartY - boxHeight / 2, top, Math.max(top, bottom - boxHeight))
  const compactBandTop = Math.max(top, 132)
  const compactBandBottom = Math.min(bottom, height - 102)
  const compactBandFits = input.compact === true && compactBandBottom - compactBandTop >= boxHeight
  const compactBandY = compactBandFits
    ? arenaClamp(leaderStartY - boxHeight / 2, compactBandTop, compactBandBottom - boxHeight)
    : centeredY
  const candidates: Array<{ placement: ArenaSelectedCreatureCalloutGeometry['placement']; x: number; y: number }> = [
    { placement: 'above-right', x: leaderStartX + actorOffset, y: leaderStartY - boxHeight - actorOffset },
    { placement: 'above-left', x: leaderStartX - boxWidth - actorOffset, y: leaderStartY - boxHeight - actorOffset },
    { placement: 'below-right', x: leaderStartX + actorOffset, y: leaderStartY + actorOffset },
    { placement: 'below-left', x: leaderStartX - boxWidth - actorOffset, y: leaderStartY + actorOffset },
    ...(compactBandFits ? [
      { placement: 'left' as const, x: leaderStartX - boxWidth - actorOffset, y: compactBandY },
      { placement: 'right' as const, x: leaderStartX + actorOffset, y: compactBandY },
      { placement: 'overlay-band' as const, x: centeredX, y: compactBandY },
    ] : []),
    { placement: 'above-clamped', x: centeredX, y: leaderStartY - boxHeight - actorOffset },
    { placement: 'below-clamped', x: centeredX, y: leaderStartY + actorOffset },
    { placement: 'left', x: leaderStartX - boxWidth - actorOffset, y: centeredY },
    { placement: 'right', x: leaderStartX + actorOffset, y: centeredY },
  ]
  const fits = (candidate: { x: number; y: number }) => candidate.x >= left && candidate.y >= top && candidate.x + boxWidth <= right && candidate.y + boxHeight <= bottom
  const clearsActor = (candidate: { x: number; y: number }) => {
    const nearestX = arenaClamp(leaderStartX, candidate.x, candidate.x + boxWidth)
    const nearestY = arenaClamp(leaderStartY, candidate.y, candidate.y + boxHeight)
    return Math.hypot(leaderStartX - nearestX, leaderStartY - nearestY) >= selectedRingRadius + gap / 2
  }
  // These canvas-space rectangles conservatively mirror the DOM badge, the
  // closed key summary, and the inspection picker layered above the canvas.
  const overlays = input.compact
    ? [
      { x: 12, y: 12, width: Math.max(0, width - 24), height: 120 },
      { x: Math.max(0, width - 72), y: Math.max(0, height - 102), width: 62, height: 44 },
      { x: 18, y: Math.max(0, height - 60), width: Math.max(0, Math.min(200, width - 36)), height: 44 },
    ]
    : [
      { x: 20, y: 18, width: Math.max(0, Math.min(300, width - 40)), height: 106 },
      { x: Math.max(0, width - 90), y: 18, width: 70, height: 36 },
      { x: 18, y: Math.max(0, height - 60), width: Math.max(0, Math.min(245, width - 36)), height: 44 },
    ]
  const overlapArea = (candidate: { x: number; y: number }) => overlays.reduce((area, overlay) => {
    const overlapWidth = Math.max(0, Math.min(candidate.x + boxWidth, overlay.x + overlay.width) - Math.max(candidate.x, overlay.x))
    const overlapHeight = Math.max(0, Math.min(candidate.y + boxHeight, overlay.y + overlay.height) - Math.max(candidate.y, overlay.y))
    return area + overlapWidth * overlapHeight
  }, 0)
  const safeCandidates = candidates.filter(candidate => fits(candidate) && clearsActor(candidate))
  const chosen = safeCandidates.find(candidate => overlapArea(candidate) === 0)
    ?? safeCandidates.reduce<(typeof safeCandidates)[number] | undefined>((best, candidate) => !best || overlapArea(candidate) < overlapArea(best) ? candidate : best, undefined)
  const boxX = chosen ? chosen.x : centeredX
  const boxY = chosen ? chosen.y : centeredY
  const leaderEndX = arenaClamp(leaderStartX, boxX, boxX + boxWidth)
  const leaderEndY = arenaClamp(leaderStartY, boxY, boxY + boxHeight)
  return {
    x: Number.isFinite(boxX) ? boxX : left,
    y: Number.isFinite(boxY) ? boxY : top,
    width: Number.isFinite(boxWidth) ? boxWidth : fieldWidth,
    height: Number.isFinite(boxHeight) ? boxHeight : fieldHeight,
    placement: chosen?.placement ?? 'clamped',
    leaderStartX: Number.isFinite(leaderStartX) ? leaderStartX : left,
    leaderStartY: Number.isFinite(leaderStartY) ? leaderStartY : top,
    leaderEndX: Number.isFinite(leaderEndX) ? leaderEndX : left,
    leaderEndY: Number.isFinite(leaderEndY) ? leaderEndY : top,
  }
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

export function arenaActivitySpotlightHaloRect(
  width: number,
  height: number,
  pad: number,
  actor: Pick<ArenaActivitySpotlightTag, 'x' | 'y' | 'size'>,
): ArenaActivitySpotlightTagRect {
  const base = Math.max(7, Math.min(width, height) * .017 * actor.size)
  const radius = Math.max(base * 2.15, 15)
  const actorX = pad + actor.x * Math.max(0, width - pad * 2)
  const actorY = pad + actor.y * Math.max(0, height - pad * 2) - base * 1.55 * .35
  return { x: actorX - radius, y: actorY - radius, width: radius * 2, height: radius * 2 }
}

const ARENA_ACTIVITY_SPOTLIGHT_TAG_ACCENTS: Record<ArenaActivitySpotlightRole, string> = {
  attacker: '#fb7185',
  prey: '#fbbf24',
  collector: '#a3e635',
  'returning individual': '#60a5fa',
  'involved individual': '#c4b5fd',
}

function drawArenaActivitySpotlightTags(
  ctx: CanvasRenderingContext2D,
  tags: ArenaActivitySpotlightTag[],
  alpha: number,
  width: number,
  height: number,
  pad: number,
  externalOccupied: readonly ArenaActivitySpotlightTagRect[] = [],
) {
  if (!tags.length) return
  const compact = width <= 720
  const anchors: ArenaActivitySpotlightTagRect[] = compact
    ? [
      { x: 10, y: Math.max(0, height - 122), width: Math.max(0, width - 20), height: 70 },
      { x: 12, y: Math.max(0, height - 60), width: Math.max(0, Math.min(205, width - 24)), height: 48 },
      { x: 12, y: 12, width: Math.max(0, width - 24), height: 120 },
    ]
    : [
      { x: Math.max(0, width - 430), y: 18, width: Math.min(410, width), height: Math.min(380, Math.max(0, height - 36)) },
      { x: 20, y: 18, width: Math.max(0, Math.min(300, width - 40)), height: 106 },
      { x: 18, y: Math.max(0, height - 60), width: Math.max(0, Math.min(245, width - 36)), height: 44 },
    ]
  const occupied: ArenaActivitySpotlightTagRect[] = [...externalOccupied]
  const haloRects = tags.map(tag => arenaActivitySpotlightHaloRect(width, height, pad, tag))
  for (let index = 0; index < tags.length; index++) {
    const tag = tags[index]
    const canvasLabel = compact ? tag.label.replace(' · Individual ', ' ') : tag.label
    const geometry = arenaActivitySpotlightTagGeometry({
      width,
      height,
      pad,
      x: tag.x,
      y: tag.y,
      size: tag.size,
      individualId: tag.individualId,
      role: tag.role,
      label: canvasLabel,
      compact,
      occupied: [...occupied, ...haloRects.filter((_, haloIndex) => haloIndex !== index)],
      anchors,
    })
    if (!geometry) continue
    occupied.push({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height })
    const accent = ARENA_ACTIVITY_SPOTLIGHT_TAG_ACCENTS[tag.role]
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(3, 17, 29, .96)'
    ctx.lineWidth = 4
    ctx.beginPath(); ctx.moveTo(geometry.leaderStartX, geometry.leaderStartY); ctx.lineTo(geometry.leaderEndX, geometry.leaderEndY); ctx.stroke()
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.4
    ctx.beginPath(); ctx.moveTo(geometry.leaderStartX, geometry.leaderStartY); ctx.lineTo(geometry.leaderEndX, geometry.leaderEndY); ctx.stroke()
    ctx.fillStyle = 'rgba(3, 17, 29, .94)'
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.4
    ctx.beginPath(); ctx.roundRect(geometry.x, geometry.y, geometry.width, geometry.height, 6); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#f8fafc'
    ctx.font = '700 10px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(truncateArenaCanvasText(ctx, canvasLabel, Math.max(1, geometry.width - 10)), geometry.x + geometry.width / 2, geometry.y + geometry.height / 2)
    ctx.restore()
  }
}

function truncateArenaCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  try {
    if (ctx.measureText(text).width <= maxWidth) return text
    const ellipsis = '…'
    let candidate = text
    while (candidate.length > 1 && ctx.measureText(`${candidate.trimEnd()}${ellipsis}`).width > maxWidth) candidate = candidate.slice(0, -1)
    return `${candidate.trimEnd()}${ellipsis}`
  } catch {
    return text.length > 24 ? `${text.slice(0, 23)}…` : text
  }
}

function drawArenaSelectedCreatureCallout(
  ctx: CanvasRenderingContext2D,
  callout: ArenaSelectedCreatureCallout,
  geometry: ArenaSelectedCreatureCalloutGeometry,
  gold: string,
) {
  const textInset = 8
  const maxTextWidth = Math.max(1, geometry.width - textInset * 2)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(5, 16, 13, .92)'
  ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(geometry.leaderStartX, geometry.leaderStartY); ctx.lineTo(geometry.leaderEndX, geometry.leaderEndY); ctx.stroke()
  ctx.strokeStyle = gold
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(geometry.leaderStartX, geometry.leaderStartY); ctx.lineTo(geometry.leaderEndX, geometry.leaderEndY); ctx.stroke()
  ctx.fillStyle = 'rgba(7, 24, 18, .91)'
  ctx.strokeStyle = gold
  ctx.lineWidth = 1.4
  ctx.beginPath(); ctx.roundRect(geometry.x, geometry.y, geometry.width, geometry.height, 7); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#f8fafc'
  ctx.font = '700 11px system-ui'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(truncateArenaCanvasText(ctx, callout.title, maxTextWidth), geometry.x + textInset, geometry.y + 14)
  ctx.fillStyle = 'rgba(231, 245, 238, .88)'
  ctx.font = '10px system-ui'
  ctx.fillText(truncateArenaCanvasText(ctx, callout.detail, maxTextWidth), geometry.x + textInset, geometry.y + 29)
  ctx.restore()
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
  const activitySpotlightCue = activitySpotlight ? formatArenaActivitySpotlightCue(activitySpotlight, world.config) : null
  const allActivitySpotlightTags = activitySpotlight ? deriveArenaActivitySpotlightTags(activitySpotlight) : []
  const activitySpotlightTags = allActivitySpotlightTags.filter(tag => tag.individualId !== selectedIndividualId)
  const selectedCallout = deriveArenaSelectedCreatureCallout(world, selectedIndividualId)
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
      const selectedCalloutGeometry = selectedCallout ? arenaSelectedCreatureCalloutGeometry({ width: w, height: h, pad, x: selectedCallout.x, y: selectedCallout.y, size: selectedCallout.size, compact: w <= 720 }) : null
      const activityTagObstacles = selectedCallout && selectedCalloutGeometry
        ? [selectedCalloutGeometry, arenaActivitySpotlightHaloRect(w, h, pad, selectedCallout)]
        : []
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
      if (activitySpotlight) {
        drawArenaActivitySpotlight(ctx, activitySpotlight, w, h, sx, sy)
        drawArenaActivitySpotlightTags(ctx, activitySpotlightTags, activitySpotlight.alpha, w, h, pad, activityTagObstacles)
      }
      const pct = Math.min(1, world.dayTime / world.config.dayLength)
      ctx.fillStyle = palette.progressTrack; ctx.fillRect(pad, pad - 9, w - pad * 2, 3)
      ctx.fillStyle = palette.progressFill; ctx.fillRect(pad, pad - 9, (w - pad * 2) * pct, 3)
      for (const marker of endpointMarkers) drawHeldPathEndpoint(ctx, marker.kind, marker.x, marker.y, marker.color, marker.size)
      if (selectedCallout && selectedCalloutGeometry) drawArenaSelectedCreatureCallout(ctx, selectedCallout, selectedCalloutGeometry, palette.selectedRing)
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
  const activitySpotlightCueDescription = activitySpotlightCue?.description ?? ''
  const selectedCalloutDescription = selectedCallout?.description ?? ''
  const accessibleDescription = `${accessibleBaseDescription} ${patchSelectionDescription}${activitySpotlightDescription ? ` ${activitySpotlightDescription}` : ''}${activitySpotlightCueDescription ? ` ${activitySpotlightCueDescription}` : ''}${selectedCalloutDescription ? ` ${selectedCalloutDescription}` : ''} The combined selector includes living creatures and resource patches.`
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
  return <><canvas ref={ref} className="arena" role="img" onClick={chooseAt} aria-label={accessibleDescription} data-arena-activity-spotlight={activitySpotlight ? 'true' : undefined} data-arena-activity-spotlight-sequence={activitySpotlight?.sequence} data-arena-activity-spotlight-kind={activitySpotlight?.kind} data-arena-activity-spotlight-tick={activitySpotlight?.tick} data-arena-activity-spotlight-age={activitySpotlight?.age} data-arena-activity-spotlight-actors={activitySpotlight?.actors.map(actor => actor.individualId).join(',')} data-arena-activity-spotlight-event={activitySpotlightCue ? 'true' : undefined} data-arena-activity-spotlight-event-copy={activitySpotlightCue?.event} data-arena-activity-spotlight-event-context={activitySpotlightCue?.context} data-arena-activity-spotlight-tag-copies={activitySpotlightTags.length ? activitySpotlightTags.map(tag => tag.label).join(', ') : undefined} data-arena-selected-callout={selectedCallout ? 'true' : undefined} data-arena-selected-callout-individual-id={selectedCallout?.individualId} data-arena-selected-callout-title={selectedCallout?.title} data-arena-selected-callout-detail={selectedCallout?.detail} data-arena-selected-callout-copy={selectedCallout?.description}>
    Natural selection simulation arena. Live counts are available in the statistics region.
  </canvas><label className="creature-picker" htmlFor="arena-creature-picker">Inspect <select id="arena-creature-picker" aria-label="Inspect creatures or resource patches" aria-describedby="arena-creature-picker-help" value={selectedValue} onChange={e => selectInspection(e.target.value)} style={{ background: 'var(--paper)', color: 'var(--ink)', colorScheme: 'light dark', minHeight: 32, touchAction: 'manipulation' }}><option value="">Nothing selected</option><optgroup label="Creatures">{livingCreatures.slice().sort((a, b) => a.individualId - b.individualId).map(c => <option key={`creature:${c.individualId}`} value={`creature:${c.individualId}`}>Individual {c.individualId}, lineage {c.lineageId}, {CREATURE_STATE_METADATA[c.home ? 'safe' : c.mode].label}</option>)}</optgroup>{patchOptions.length > 0 && <optgroup label="Resource patches">{patchOptions.map(({ patch, ordinal, currentFood, quality }) => <option key={`patch:${ordinal}`} value={`patch:${ordinal}`}>Patch {ordinal} · {quality} · {currentFood} food</option>)}</optgroup>}</select></label><span id="arena-creature-picker-help" className="sr-only">Choose a living creature or resource patch to inspect. Creature options reveal behavior; patch options reveal live food, capacity, energy, and regrowth. Choose Nothing selected to clear inspection.</span><span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{formatArenaInspectionStatus(selectedIndividualId, selectedPatchId, selectedPatchOrdinal)}</span></>
}
