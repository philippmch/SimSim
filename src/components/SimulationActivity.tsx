import { useEffect, useRef, useState } from 'react'
import { MAX_ACTIVITY_ENTRIES } from '../simulation/engine'
import type { WorldActivityKind } from '../simulation/types'

/** Keep the view aligned with the engine's bounded activity buffer. */
export const MAX_VISIBLE_ACTIVITY_ENTRIES = MAX_ACTIVITY_ENTRIES
export const NO_ACTIVITY_MOMENTS = 'No key moments recorded yet.'

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
  return value.filter((actorId): actorId is number => safeInteger(actorId, 1))
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
  return <div className="interventions" role="group" aria-labelledby="simulation-activity-title">
    <span><strong id="simulation-activity-title" style={{ fontSize: 12 }}>Recent key moments</strong><small style={{ fontSize: 10 }}>Bounded discrete events</small></span>
    {latest ? <div style={{ flex: '1 1 100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="journal-kicker" style={{ margin: 0, fontSize: 10, overflowWrap: 'anywhere' }}>{latest.kindLabel} · {formatActivityProvenance(latest)}</span>
        <strong style={{ fontSize: 12, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{latest.summary}</strong>
      </div>
      <details>
        <summary style={{ fontSize: 11 }}>Show all {feed.retainedCount} retained key moments</summary>
        <ol aria-label="Retained key moments, newest first" style={{ flex: '1 1 100%', minWidth: 0, margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
          {feed.entries.map(moment => <li key={`${moment.sequence}-${moment.sourceIndex}`} style={{ minWidth: 0, padding: '4px 0', overflowWrap: 'anywhere' }}>
            <span className="journal-kicker" style={{ margin: 0, fontSize: 10, overflowWrap: 'anywhere' }}>{moment.kindLabel} · {formatActivityProvenance(moment)}</span>
            <strong style={{ display: 'block', fontSize: 12, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{moment.summary}</strong>
          </li>)}
        </ol>
      </details>
    </div> : <p className="journal-equation" style={{ flex: '1 1 auto', fontSize: 11 }}>{NO_ACTIVITY_MOMENTS}</p>}
    <small style={{ flexBasis: '100%', fontSize: 10, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{formatActivityRetentionContext(feed)}</small>
    <output className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</output>
  </div>
}

export default SimulationActivity
