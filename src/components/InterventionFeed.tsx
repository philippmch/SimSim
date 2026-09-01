import { MAX_WORLD_EVENTS } from '../simulation/engine'
import type { WorldEvent } from '../simulation/types'

export const MAX_VISIBLE_INTERVENTIONS = 5
export const INTERVENTION_KIND_UNAVAILABLE = 'Intervention kind unavailable'
export const INTERVENTION_GENERATION_UNAVAILABLE = 'Generation unavailable'
export const INTERVENTION_DAY_UNAVAILABLE = 'day unavailable'
export const INTERVENTION_SUMMARY_UNAVAILABLE = 'Event summary unavailable.'
export const INTERVENTION_IMPACT_UNAVAILABLE = 'Impact unavailable'
export const NO_INTERVENTIONS_RECORDED = 'No shocks recorded in this run yet.'

const INTERVENTION_KIND_LABELS: Record<WorldEvent['kind'], string> = {
  'resource-bloom': 'Resource bloom',
  drought: 'Drought',
  'founder-migration': 'Founder migration',
}

type RecordLike = Record<string, unknown>

const isRecord = (value: unknown): value is RecordLike => typeof value === 'object' && value !== null

function field(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined
  try {
    return value[key]
  } catch {
    return undefined
  }
}

export function isValidInterventionGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

export function isValidInterventionDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function isValidInterventionCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function isValidInterventionSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

export function formatInterventionKind(value: unknown): string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(INTERVENTION_KIND_LABELS, value)
    ? INTERVENTION_KIND_LABELS[value as WorldEvent['kind']]
    : INTERVENTION_KIND_UNAVAILABLE
}

export function formatInterventionGeneration(value: unknown): string {
  return isValidInterventionGeneration(value) ? `Generation ${value}` : INTERVENTION_GENERATION_UNAVAILABLE
}

export function formatInterventionDay(value: unknown): string {
  return isValidInterventionDay(value) ? `day ${value.toFixed(2)}` : INTERVENTION_DAY_UNAVAILABLE
}

/** Preserve the stored summary verbatim when it is usable; never stringify malformed legacy data. */
export function formatInterventionSummary(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : INTERVENTION_SUMMARY_UNAVAILABLE
}

export function formatInterventionImpact(kind: unknown, count: unknown): string {
  if (!isValidInterventionCount(count)) return INTERVENTION_IMPACT_UNAVAILABLE
  if (kind === 'resource-bloom') return count === 0 ? 'No food added' : `+${count} food added`
  if (kind === 'drought') return count === 0 ? 'No food removed' : `−${count} food removed`
  if (kind === 'founder-migration') return count === 0 ? 'No founders added' : `+${count} ${count === 1 ? 'founder' : 'founders'} added`
  return `recorded count ${count}`
}

export interface InterventionFeedEntry {
  /** Buffer position, retained for legacy keys and command-order diagnostics. */
  sourceIndex: number
  sequence: number | null
  kindLabel: string
  generationLabel: string
  dayLabel: string
  impactLabel: string
  summary: string
}

export interface InterventionFeedState {
  entries: InterventionFeedEntry[]
  totalRetained: number
  omittedCount: number
  retentionLimit: number
  bufferFull: boolean
}

function normalizeRetentionLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.max(1, Math.floor(value))
    : MAX_WORLD_EVENTS
}

export function deriveInterventionFeed(events: unknown, retentionLimit = MAX_WORLD_EVENTS): InterventionFeedState {
  const safeEvents: readonly unknown[] = Array.isArray(events) ? events : []
  const limit = normalizeRetentionLimit(retentionLimit)
  // The simulation appends records in command order.  Reverse only the retained
  // tail: this keeps the newest record first and preserves that order for all
  // same-day commands (the last command remains the first row).
  const firstVisibleIndex = Math.max(0, safeEvents.length - MAX_VISIBLE_INTERVENTIONS)
  const visible = safeEvents.slice(firstVisibleIndex).map((event, index) => ({ event, sourceIndex: firstVisibleIndex + index })).reverse()
  const entries = visible.map(({ event, sourceIndex }): InterventionFeedEntry => ({
    sourceIndex,
    sequence: isValidInterventionSequence(field(event, 'sequence')) ? field(event, 'sequence') as number : null,
    kindLabel: formatInterventionKind(field(event, 'kind')),
    generationLabel: formatInterventionGeneration(field(event, 'generation')),
    dayLabel: formatInterventionDay(field(event, 'day')),
    impactLabel: formatInterventionImpact(field(event, 'kind'), field(event, 'count')),
    summary: formatInterventionSummary(field(event, 'summary')),
  }))
  return {
    entries,
    totalRetained: safeEvents.length,
    omittedCount: Math.max(0, safeEvents.length - entries.length),
    retentionLimit: limit,
    bufferFull: safeEvents.length >= limit,
  }
}

export function formatInterventionAnnouncement(entry: InterventionFeedEntry | undefined): string {
  if (!entry) return NO_INTERVENTIONS_RECORDED
  return `Latest shock${entry.sequence === null ? '' : ` record ${entry.sequence}`}: ${entry.kindLabel} · ${entry.generationLabel} · ${entry.dayLabel} · ${entry.summary}`
}

export interface InterventionFeedProps {
  /** Deliberately the world event buffer only; live telemetry and natural regrowth are not included. */
  events: readonly WorldEvent[]
}

export function InterventionFeed({ events }: InterventionFeedProps) {
  const feed = deriveInterventionFeed(events)
  const latestAnnouncement = formatInterventionAnnouncement(feed.entries[0])

  return <div className="interventions" role="group" aria-labelledby="intervention-feed-title">
    <span><strong id="intervention-feed-title">Recent shocks</strong><small>Newest retained actions</small></span>
    {feed.entries.length ? <ol role="list" aria-label="Newest retained shocks" style={{ listStyle: 'none', margin: 0, padding: 0, flex: '1 1 100%', minWidth: 0 }}>
      {feed.entries.map(entry => <li key={`${entry.sequence ?? `legacy-${entry.sourceIndex}`}-${entry.generationLabel}-${entry.dayLabel}`} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '3px 0', minWidth: 0 }}>
        <span className="journal-kicker" style={{ margin: 0, overflowWrap: 'anywhere' }}>{entry.kindLabel} · {entry.generationLabel} · {entry.dayLabel}</span>
        <strong style={{ fontSize: '10px', overflowWrap: 'anywhere' }}>{entry.summary}</strong><small>{entry.impactLabel}</small>
      </li>)}
    </ol> : <p className="journal-equation" style={{ flex: '1 1 auto' }}>{NO_INTERVENTIONS_RECORDED}</p>}
    {feed.omittedCount > 0 && <small style={{ flexBasis: '100%' }}>Showing {feed.entries.length} newest of {feed.totalRetained} retained shocks.</small>}
    {feed.bufferFull && <small style={{ flexBasis: '100%' }}>Earlier shocks may be unavailable because only the latest {feed.retentionLimit} are retained.</small>}
    <output className="sr-only" aria-live="polite" aria-atomic="true">{latestAnnouncement}</output>
  </div>
}

export default InterventionFeed
