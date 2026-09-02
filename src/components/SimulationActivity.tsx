import { useEffect, useRef, useState } from 'react'
import { MAX_ACTIVITY_ENTRIES } from '../simulation/engine'
import type { Config, WorldActivityKind } from '../simulation/types'

/** Keep the view aligned with the engine's bounded activity buffer. */
export const MAX_VISIBLE_ACTIVITY_ENTRIES = MAX_ACTIVITY_ENTRIES
export const NO_ACTIVITY_MOMENTS = 'No key moments recorded yet.'
export const ACTIVITY_CONTEXT_UNAVAILABLE = 'Model context unavailable in this snapshot.'

type RecordLike = Record<string, unknown>

const ACTIVITY_KIND_LABELS: Record<WorldActivityKind, string> = {
  'food-collected': 'Food collected',
  'attack-success': 'Attack success',
  'attack-failure': 'Attack failed',
  'energy-death': 'Energy loss',
  'reached-home': 'Reached home',
  'natural-regrowth': 'Natural regrowth',
  intervention: 'Intervention',
  'generation-settlement': 'Generation settled',
}

const isRecord = (value: unknown): value is RecordLike => typeof value === 'object' && value !== null

/** Read untrusted/legacy snapshot fields without allowing hostile getters to break the dashboard. */
function field(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined
  try {
    return value[key]
  } catch {
    return undefined
  }
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function safeInteger(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function safeRetentionLimit(value: unknown): number {
  if (!safeInteger(value, 1)) return MAX_VISIBLE_ACTIVITY_ENTRIES
  return Math.min(MAX_VISIBLE_ACTIVITY_ENTRIES, value)
}

function safeDroppedCount(value: unknown): number {
  return safeInteger(value, 0) ? value : 0
}

function validActivityKind(value: unknown): value is WorldActivityKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACTIVITY_KIND_LABELS, value)
}

function safeSummary(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return value.trim()
}

function safeArray(value: unknown): readonly unknown[] {
  try {
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function safeArrayLength(value: readonly unknown[]): number {
  try {
    const length = value.length
    return Number.isSafeInteger(length) && length >= 0 ? length : 0
  } catch {
    return 0
  }
}

function safeActorIds(value: unknown): number[] {
  const source = safeArray(value)
  const actorIds: number[] = []
  for (let index = 0; index < safeArrayLength(source); index++) {
    try {
      const actorId = source[index]
      if (safeInteger(actorId, 1)) actorIds.push(actorId)
    } catch {
      // A malformed legacy array must not prevent the rest of the snapshot from rendering.
    }
  }
  return actorIds
}

export interface SimulationActivityMoment {
  sourceIndex: number
  sequence: number
  generation: number
  day: number
  tick: number
  kind: WorldActivityKind
  kindLabel: string
  summary: string
  count: number
  actorIds: number[]
  attackerId: number | null
  preyId: number | null
  contestChance: number | null
}

export type ActivityActorStatus = 'living' | 'dead-but-present' | 'absent'
export type ActivityActorRole = 'attacker' | 'prey' | 'collector' | 'returning individual' | 'involved individual'

export interface ActivityActorTarget {
  individualId: number
  role: ActivityActorRole
  roleLabel: string
  status: ActivityActorStatus
}

const ACTIVITY_ACTOR_ROLE_LABELS: Record<ActivityActorRole, string> = {
  attacker: 'Attacker',
  prey: 'Prey',
  collector: 'Collector',
  'returning individual': 'Returning individual',
  'involved individual': 'Involved individual',
}

const ACTIVITY_ACTOR_STATUS_LABELS: Record<ActivityActorStatus, string> = {
  living: 'current arena state available',
  'dead-but-present': 'dead in current cohort',
  absent: 'not in current cohort',
}

export function formatActivityActorRole(role: ActivityActorRole): string {
  return ACTIVITY_ACTOR_ROLE_LABELS[role] ?? ACTIVITY_ACTOR_ROLE_LABELS['involved individual']
}

export function formatActivityActorStatus(status: ActivityActorStatus): string {
  return ACTIVITY_ACTOR_STATUS_LABELS[status] ?? ACTIVITY_ACTOR_STATUS_LABELS.absent
}

/**
 * Resolve event actor IDs against the current cohort by stable individualId.
 * Explicit attack roles are inserted first; older generic actorIds then retain
 * their recorded order. A missing or malformed current cohort simply makes a
 * target absent rather than preventing the activity story from rendering.
 */
export function deriveActivityActorTargets(moment: unknown, currentCreatures: unknown): ActivityActorTarget[] {
  const currentStatus = new Map<number, ActivityActorStatus>()
  const creatures = safeArray(currentCreatures)
  for (let index = 0; index < safeArrayLength(creatures); index++) {
    let creature: unknown
    try {
      creature = creatures[index]
    } catch {
      continue
    }
    const individualId = field(creature, 'individualId')
    if (!safeInteger(individualId, 1)) continue
    const alive = field(creature, 'alive')
    if (alive === true) currentStatus.set(individualId, 'living')
    else if (alive === false && currentStatus.get(individualId) !== 'living') currentStatus.set(individualId, 'dead-but-present')
  }

  const targets: ActivityActorTarget[] = []
  const seen = new Set<number>()
  const append = (value: unknown, role: ActivityActorRole) => {
    if (!safeInteger(value, 1) || seen.has(value)) return
    seen.add(value)
    const status = currentStatus.get(value) ?? 'absent'
    targets.push({ individualId: value, role, roleLabel: formatActivityActorRole(role), status })
  }
  append(field(moment, 'attackerId'), 'attacker')
  append(field(moment, 'preyId'), 'prey')

  const kind = field(moment, 'kind')
  const remainingRole: ActivityActorRole = kind === 'food-collected'
    ? 'collector'
    : kind === 'reached-home'
      ? 'returning individual'
      : 'involved individual'
  let remainingIndex = 0
  for (const actorId of safeActorIds(field(moment, 'actorIds'))) {
    append(actorId, remainingIndex === 0 ? remainingRole : 'involved individual')
    remainingIndex++
  }
  return targets
}

/** Keep the relation sentence factual: event involvement is not causation. */
export function formatActivityActorRelation(selectedIndividualId: unknown, actors: readonly ActivityActorTarget[]): string {
  const selected = safeInteger(selectedIndividualId, 1) ? selectedIndividualId : null
  const validActorIds: number[] = []
  const actorList = safeArray(actors)
  for (let index = 0; index < safeArrayLength(actorList); index++) {
    let actor: unknown
    try {
      actor = actorList[index]
    } catch {
      continue
    }
    const actorId = field(actor, 'individualId')
    if (safeInteger(actorId, 1) && !validActorIds.includes(actorId)) validActorIds.push(actorId)
  }
  if (validActorIds.length === 0) return 'Simulation-wide moment; no individual actor recorded.'
  if (selected !== null && validActorIds.includes(selected)) return `Selected Individual ${selected} was involved in this moment.`
  if (selected !== null) return `Other individuals acted in this moment; Individual ${selected} was not an actor.`
  return 'Individuals were involved in this moment.'
}

/** Normalize one retained record; malformed records are omitted from the story. */
export function normalizeActivityMoment(value: unknown, sourceIndex: number): SimulationActivityMoment | null {
  const rawSequence = field(value, 'sequence')
  // A missing sequence is the one legacy shape we can repair deterministically:
  // array position preserves append order. Explicitly malformed values remain dropped.
  const sequence = rawSequence === undefined ? sourceIndex + 1 : (safeInteger(rawSequence, 1) ? rawSequence : null)
  const generation = field(value, 'generation')
  const day = field(value, 'day')
  const tick = field(value, 'tick')
  const kind = field(value, 'kind')
  const summary = safeSummary(field(value, 'summary'))
  const count = field(value, 'count')
  if (sequence === null || !safeInteger(generation, 1) || !finiteNonnegative(day) || !safeInteger(tick, 0) || !validActivityKind(kind) || summary === null || !safeInteger(count, 0)) return null
  const rawContestChance = field(value, 'contestChance')
  const contestChance = finiteNonnegative(rawContestChance) && rawContestChance <= 1 ? rawContestChance : null
  const rawAttackerId = field(value, 'attackerId')
  const rawPreyId = field(value, 'preyId')
  return {
    sourceIndex,
    sequence,
    generation,
    day,
    tick,
    kind,
    kindLabel: ACTIVITY_KIND_LABELS[kind],
    summary,
    count,
    actorIds: safeActorIds(field(value, 'actorIds')),
    attackerId: safeInteger(rawAttackerId, 1) ? rawAttackerId : null,
    preyId: safeInteger(rawPreyId, 1) ? rawPreyId : null,
    contestChance,
  }
}

export interface SimulationActivityFeed {
  /** Newest-first valid records currently visible in the bounded buffer. */
  entries: SimulationActivityMoment[]
  latest: SimulationActivityMoment | null
  rawCount: number
  retainedCount: number
  displayedCount: number
  droppedCount: number
  invalidCount: number
  retentionLimit: number
}

/** Normalize and order activity without mutating the engine's snapshot. */
export function deriveSimulationActivity(activity: unknown, activityDropped: unknown = 0, retentionLimit: unknown = MAX_VISIBLE_ACTIVITY_ENTRIES): SimulationActivityFeed {
  const source = safeArray(activity)
  const limit = safeRetentionLimit(retentionLimit)
  const normalized: SimulationActivityMoment[] = []
  let invalidCount = 0
  const rawCount = safeArrayLength(source)
  for (let sourceIndex = 0; sourceIndex < rawCount; sourceIndex++) {
    let entry: unknown
    try {
      entry = source[sourceIndex]
    } catch {
      invalidCount++
      continue
    }
    const moment = normalizeActivityMoment(entry, sourceIndex)
    if (moment) normalized.push(moment)
    else invalidCount++
  }
  normalized.sort((first, second) => second.sequence - first.sequence || second.sourceIndex - first.sourceIndex)
  const entries = normalized.slice(0, limit)
  const overflowCount = Math.max(0, normalized.length - entries.length)
  const explicitDropped = safeDroppedCount(activityDropped)
  return {
    entries,
    latest: entries[0] ?? null,
    rawCount,
    retainedCount: entries.length,
    displayedCount: entries.length,
    droppedCount: Math.min(Number.MAX_SAFE_INTEGER, explicitDropped + invalidCount + overflowCount),
    invalidCount,
    retentionLimit: limit,
  }
}

/** Alias kept short for callers that only need the feed derivation helper. */
export const deriveActivityFeed = deriveSimulationActivity

export function hasWorldActivityTelemetry(world: unknown): boolean {
  if (!isRecord(world)) return false
  try {
    return Object.prototype.hasOwnProperty.call(world, 'activity')
  } catch {
    return false
  }
}

export function formatActivityProvenance(moment: Pick<SimulationActivityMoment, 'generation' | 'day'>): string {
  return `Generation ${moment.generation} · day ${moment.day.toFixed(2)}`
}

export function formatActivityMoment(moment: SimulationActivityMoment): string {
  return `${moment.kindLabel} · ${formatActivityProvenance(moment)} · ${moment.summary}`
}

function configField(config: unknown, key: keyof Config): unknown {
  return field(config, key)
}

function configNumber(config: unknown, key: keyof Config): number | null {
  const value = configField(config, key)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function ecologyMode(config: unknown): Config['ecologyMode'] | null {
  const value = configField(config, 'ecologyMode')
  return value === 'classic' || value === 'energy-regrowth' ? value : null
}

function predationMode(config: unknown): Config['predationMode'] | null {
  const value = configField(config, 'predationMode')
  return value === 'threshold' || value === 'contest' ? value : null
}

function formatSetting(value: number | null, digits = 2): string {
  if (value === null) return 'unavailable'
  const rounded = Number(value.toFixed(digits))
  return Number.isFinite(rounded) ? String(rounded) : 'unavailable'
}

function formatPercent(value: number): string {
  const percent = value * 100
  if (percent > 0 && percent < .01) return '<0.01'
  if (percent < .1) return percent.toFixed(2)
  if (percent < 10) return percent.toFixed(1)
  return percent.toFixed(0)
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}

/**
 * Give each retained event one small, factual explanation of the active model.
 * These lines describe configured rules or the event record itself; they do not
 * infer that a trait or intervention caused a later outcome.
 */
export function formatActivityContext(moment: SimulationActivityMoment, config?: unknown): string {
  switch (moment.kind) {
    case 'food-collected': {
      const mode = ecologyMode(config)
      const foodEnergy = configNumber(config, 'foodEnergy')
      if (mode === 'classic') return 'Model context: Classic mode awards one carried-food unit at contact and uses the legacy fixed 22-energy reward.'
      if (mode === 'energy-regrowth') return foodEnergy === null
        ? 'Model context: Energy-regrowth mode uses item energy and patch stock; configured foodEnergy is unavailable.'
        : `Model context: Energy-regrowth mode uses ${formatSetting(foodEnergy)} energy from each item and updates patch stock when the item belongs to a patch.`
      return 'Model context: Ecology mode unavailable; classic versus energy-regrowth food handling cannot be identified.'
    }
    case 'attack-success':
    case 'attack-failure': {
      const attackCost = configNumber(config, 'attackCost')
      const mode = predationMode(config)
      if (mode === 'threshold') return moment.kind === 'attack-success'
        ? 'Model context: Threshold predation resolves an eligible contact meeting the size gate automatically; no contest energy cost is applied.'
        : 'Model context: Threshold predation should resolve an eligible contact meeting the size gate automatically; this failure is inconsistent or unavailable in threshold mode.'
      if (mode === 'contest') {
        const chanceText = moment.contestChance === null ? 'event-level contest chance unavailable' : `recorded contest chance ${formatPercent(moment.contestChance)}%`
        const costText = attackCost === null ? 'configured attack cost unavailable' : `admitted attempts pay ${formatSetting(attackCost)} energy units`
        return `Model context: Contest predation; ${chanceText}; ${costText}. No trait attribution is inferred.`
      }
      const chanceText = moment.contestChance === null ? 'event-level attack chance unavailable' : `recorded contest chance ${formatPercent(moment.contestChance)}%`
      return `Model context: Current predation mode unavailable; ${chanceText}, and the attack-cost rule is unavailable.`
    }
    case 'energy-death':
      return 'Model context: Energy reached zero; movement, sensing, and admitted contest attempts can spend it. Phase attribution is unavailable for this record.'
    case 'reached-home': {
      const mode = ecologyMode(config)
      if (mode === 'classic') return 'Model context: In classic mode, carrying food and crossing the home radius ends the active day.'
      if (mode === 'energy-regrowth') return 'Model context: In energy-regrowth mode, returning and crossing the home radius ends the active day.'
      return 'Model context: Home-radius and mode-specific return rules are unavailable in this snapshot.'
    }
    case 'natural-regrowth': {
      const capacity = configNumber(config, 'patchCapacity')
      const capacityText = capacity === null ? 'the configured patch capacity, which is unavailable in this snapshot' : `the configured capacity of ${formatSetting(capacity)} food per patch`
      return `Model context: Deterministic patch regrowth advances toward ${capacityText}; this record has no per-patch breakdown.`
    }
    case 'intervention':
      return moment.count === 0
        ? 'Model context: The user request resolved with no units changed at this recorded moment; no downstream evolutionary claim is made.'
        : 'Model context: The recorded user-applied change takes effect immediately; no downstream evolutionary claim is made from this record.'
    case 'generation-settlement':
      return `Model context: The exact next population is ${formatCount(moment.count, 'creature')}; survivors carry forward and admitted births are added at this recorded boundary.`
    default:
      return ACTIVITY_CONTEXT_UNAVAILABLE
  }
}

export function formatActivityAnnouncement(moment: SimulationActivityMoment | null | undefined): string {
  return moment ? `New key moment ${moment.sequence}: ${formatActivityMoment(moment)}` : ''
}

export function formatActivityRetentionContext(feed: Pick<SimulationActivityFeed, 'displayedCount' | 'retainedCount' | 'droppedCount'>): string {
  const retained = `${feed.retainedCount} retained key ${feed.retainedCount === 1 ? 'moment' : 'moments'}`
  const dropped = `${feed.droppedCount} ${feed.droppedCount === 1 ? 'record' : 'records'}`
  return `Showing ${retained}, newest first; ${dropped} dropped or unavailable.`
}

function activityKey(moment: SimulationActivityMoment | null): string | null {
  return moment ? `${moment.sequence}:${moment.sourceIndex}:${moment.kind}:${moment.summary}` : null
}

type ActivityActorCallback = (individualId: number) => void

interface ActivityActorAffordancesProps {
  moment: SimulationActivityMoment
  currentCreatures: unknown
  selectedIndividualId?: number | null
  onShowIndividual?: ActivityActorCallback
}

function activityActorDescription(target: ActivityActorTarget): string {
  return `${target.roleLabel} Individual ${target.individualId}`
}

function activityActorControlLabel(target: ActivityActorTarget): string {
  return `Show current arena state for ${activityActorDescription(target)}; this is not the historical event position.`
}

function ActivityActorAffordances({ moment, currentCreatures, selectedIndividualId, onShowIndividual }: ActivityActorAffordancesProps) {
  const targets = deriveActivityActorTargets(moment, currentCreatures)
  if (targets.length === 0) {
    return <span style={{ flexBasis: '100%', minWidth: 0, whiteSpace: 'normal', fontSize: 11, lineHeight: 1.35 }}>{formatActivityActorRelation(selectedIndividualId, targets)}</span>
  }

  return <div role="group" aria-label="Individuals involved in this moment" style={{ flex: '1 1 100%', minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5 }}>
    <span style={{ flexBasis: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, whiteSpace: 'normal' }}>
      <strong>Event actors</strong>
      <small>Controls show each actor’s current state in the arena, not a historical event position.</small>
    </span>
    <span style={{ flexBasis: '100%', minWidth: 0, whiteSpace: 'normal', fontSize: 11, lineHeight: 1.35 }}>{formatActivityActorRelation(selectedIndividualId, targets)}</span>
    {onShowIndividual && targets.length > 2 && targets.some(target => target.status === 'living')
      ? <label style={{ flex: '1 1 190px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--muted)' }}>
        <span>Choose a living actor to show its current arena state</span>
        <select aria-label="Choose an event actor to show its current arena state" value={targets.some(target => target.status === 'living' && target.individualId === selectedIndividualId) ? String(selectedIndividualId) : ''} onChange={event => {
          const individualId = Number(event.target.value)
          const target = targets.find(candidate => candidate.individualId === individualId && candidate.status === 'living')
          if (target) onShowIndividual(target.individualId)
        }} style={{ minWidth: 0, maxWidth: '100%', minHeight: 44, padding: '5px 7px', background: 'var(--paper)', color: 'var(--ink)', colorScheme: 'light dark' }}>
          <option value="">Select a living actor</option>
          {targets.map(target => <option key={`${target.role}-${target.individualId}`} value={target.individualId} disabled={target.status !== 'living'}>{`${target.roleLabel} · Individual ${target.individualId} · ${formatActivityActorStatus(target.status)}`}</option>)}
        </select>
      </label>
      : <div style={{ flex: '1 1 100%', minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {targets.map(target => target.status === 'living' && onShowIndividual
          ? <button key={`${target.role}-${target.individualId}`} type="button" onClick={() => onShowIndividual(target.individualId)} aria-label={activityActorControlLabel(target)} style={{ flex: '1 1 150px', minWidth: 0, whiteSpace: 'normal', lineHeight: 1.3 }}>{`${target.roleLabel} · Individual ${target.individualId} · current arena state`}</button>
          : <span key={`${target.role}-${target.individualId}`} style={{ flex: '1 1 150px', minWidth: 0, whiteSpace: 'normal', fontSize: 10, lineHeight: 1.35 }}>{`${target.roleLabel} · Individual ${target.individualId} · ${formatActivityActorStatus(target.status)}`}</span>)}
      </div>}
  </div>
}

export interface SimulationActivityProps {
  /** The complete snapshot is accepted as unknown so old saved worlds remain renderable. */
  world: unknown
  selectedIndividualId?: number | null
  /** Activity navigation is separate from direct arena selection. */
  onShowIndividual?: ActivityActorCallback
}

export function SimulationActivity({ world, selectedIndividualId, onShowIndividual }: SimulationActivityProps) {
  const activityPresent = hasWorldActivityTelemetry(world)
  const activity = field(world, 'activity')
  const activityDropped = field(world, 'activityDropped')
  const config = field(world, 'config')
  const currentCreatures = field(world, 'creatures')
  const feed = deriveSimulationActivity(activity, activityDropped)
  const latestKey = activityKey(feed.latest)
  const previousKey = useRef<string | null | undefined>(undefined)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    const previous = previousKey.current
    previousKey.current = latestKey
    // Existing retained records are context, not newly recorded moments. A
    // fresh event after an empty/reset state is announced once.
    if (previous === undefined) return
    if (latestKey === null || latestKey === previous) {
      setAnnouncement(current => current ? '' : current)
      return
    }
    setAnnouncement(formatActivityAnnouncement(feed.latest))
  }, [latestKey])

  if (!activityPresent) return null

  const latest = feed.latest
  const earlier = latest ? feed.entries.slice(1) : []
  return <div className="interventions" role="group" aria-labelledby="simulation-activity-title">
    <span><strong id="simulation-activity-title" style={{ fontSize: 12 }}>What happened</strong><small style={{ fontSize: 10 }}>Recent key moments · bounded discrete events</small></span>
    {latest ? <div style={{ flex: '1 1 100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="journal-kicker" style={{ margin: 0, fontSize: 10, overflowWrap: 'anywhere' }}>{latest.kindLabel} · {formatActivityProvenance(latest)}</span>
        <strong style={{ fontSize: 12, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{latest.summary}</strong>
        <span style={{ fontSize: 11, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{formatActivityContext(latest, config)}</span>
        {(onShowIndividual || selectedIndividualId !== undefined) && <ActivityActorAffordances moment={latest} currentCreatures={currentCreatures} selectedIndividualId={selectedIndividualId} onShowIndividual={onShowIndividual}/>}
      </div>
      {earlier.length > 0 && <details>
        <summary style={{ fontSize: 11, minHeight: 44, display: 'list-item', boxSizing: 'border-box', padding: '12px 0', lineHeight: '20px', cursor: 'pointer' }}>Show {earlier.length} earlier retained {earlier.length === 1 ? 'key moment' : 'key moments'}</summary>
        <ol aria-label="Earlier retained key moments, newest first" style={{ flex: '1 1 100%', minWidth: 0, margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
          {earlier.map(moment => <li key={`${moment.sequence}-${moment.sourceIndex}`} style={{ minWidth: 0, padding: '4px 0', overflowWrap: 'anywhere' }}>
            <span className="journal-kicker" style={{ margin: 0, fontSize: 10, overflowWrap: 'anywhere' }}>{moment.kindLabel} · {formatActivityProvenance(moment)}</span>
            <strong style={{ display: 'block', fontSize: 12, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{moment.summary}</strong>
            <span style={{ display: 'block', fontSize: 11, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{formatActivityContext(moment, config)}</span>
            {(onShowIndividual || selectedIndividualId !== undefined) && <ActivityActorAffordances moment={moment} currentCreatures={currentCreatures} selectedIndividualId={selectedIndividualId} onShowIndividual={onShowIndividual}/>}
          </li>)}
        </ol>
      </details>}
      </div> : <p className="journal-equation" style={{ flex: '1 1 auto', fontSize: 11 }}>{NO_ACTIVITY_MOMENTS}</p>}
    <small style={{ flexBasis: '100%', fontSize: 10, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{formatActivityRetentionContext(feed)}</small>
    <output className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</output>
  </div>
}

export default SimulationActivity
