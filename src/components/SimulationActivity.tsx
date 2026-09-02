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

function safeActorIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const actorIds: number[] = []
  for (let index = 0; index < value.length; index++) {
    try {
      const actorId = value[index]
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
  const source = Array.isArray(activity) ? activity : []
  const limit = safeRetentionLimit(retentionLimit)
  const normalized: SimulationActivityMoment[] = []
  let invalidCount = 0
  source.forEach((entry, sourceIndex) => {
    const moment = normalizeActivityMoment(entry, sourceIndex)
    if (moment) normalized.push(moment)
    else invalidCount++
  })
  normalized.sort((first, second) => second.sequence - first.sequence || second.sourceIndex - first.sourceIndex)
  const entries = normalized.slice(0, limit)
  const overflowCount = Math.max(0, normalized.length - entries.length)
  const explicitDropped = safeDroppedCount(activityDropped)
  return {
    entries,
    latest: entries[0] ?? null,
    rawCount: source.length,
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

export interface SimulationActivityProps {
  /** The complete snapshot is accepted as unknown so old saved worlds remain renderable. */
  world: unknown
}

export function SimulationActivity({ world }: SimulationActivityProps) {
  const activityPresent = hasWorldActivityTelemetry(world)
  const activity = field(world, 'activity')
  const activityDropped = field(world, 'activityDropped')
  const config = field(world, 'config')
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
      </div>
      {earlier.length > 0 && <details>
        <summary style={{ fontSize: 11, minHeight: 44, display: 'list-item', boxSizing: 'border-box', padding: '12px 0', lineHeight: '20px', cursor: 'pointer' }}>Show {earlier.length} earlier retained {earlier.length === 1 ? 'key moment' : 'key moments'}</summary>
        <ol aria-label="Earlier retained key moments, newest first" style={{ flex: '1 1 100%', minWidth: 0, margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
          {earlier.map(moment => <li key={`${moment.sequence}-${moment.sourceIndex}`} style={{ minWidth: 0, padding: '4px 0', overflowWrap: 'anywhere' }}>
            <span className="journal-kicker" style={{ margin: 0, fontSize: 10, overflowWrap: 'anywhere' }}>{moment.kindLabel} · {formatActivityProvenance(moment)}</span>
            <strong style={{ display: 'block', fontSize: 12, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{moment.summary}</strong>
            <span style={{ display: 'block', fontSize: 11, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{formatActivityContext(moment, config)}</span>
          </li>)}
        </ol>
      </details>}
      </div> : <p className="journal-equation" style={{ flex: '1 1 auto', fontSize: 11 }}>{NO_ACTIVITY_MOMENTS}</p>}
    <small style={{ flexBasis: '100%', fontSize: 10, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{formatActivityRetentionContext(feed)}</small>
    <output className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</output>
  </div>
}

export default SimulationActivity
