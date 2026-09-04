import { useEffect, useRef, type CSSProperties } from 'react'
import type { GenerationLedger } from '../simulation/types'
import type { ArenaPlaybackStatus } from './ArenaCanvasModel'
import {
  formatSettlementAnnouncement,
  formatSettlementEquation,
  formatSettlementLosses,
  formatSettlementReproductionBreakdown,
  getSettlementGeneration,
  summarizeLatestSettlement,
  type SettlementReportSummary,
} from './SettlementReport'

export const GENERATION_HANDOFF_UNAVAILABLE = 'Generation handoff details unavailable for this retained state.'
export const GENERATION_HANDOFF_REVEAL_SCROLL_OPTIONS: ScrollIntoViewOptions = { behavior: 'auto', block: 'nearest', inline: 'nearest' }

export interface GenerationHandoffScrollTarget {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void
}

export interface GenerationHandoffRevealTarget {
  generation: number
  target: GenerationHandoffScrollTarget
  options: ScrollIntoViewOptions
}

function safeGeneration(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER ? value : null
}

function safeNextGeneration(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 2 && value <= Number.MAX_SAFE_INTEGER ? value : null
}

function safeCurrentGeneration(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= Number.MAX_SAFE_INTEGER ? value : null
}

export interface GenerationHandoffTransition {
  endedGeneration: number
  currentGeneration: number
}

/** Connect a retained result to the current cohort only when every displayed link is safe and exact. */
export function resolveGenerationHandoffTransition(
  summary: SettlementReportSummary | null,
  currentGeneration: unknown,
  forecastPresent: boolean,
  playbackStatus: ArenaPlaybackStatus = 'Running',
): GenerationHandoffTransition | null {
  if (!summary || playbackStatus === 'Extinct' || forecastPresent !== true) return null
  const endedGeneration = safeGeneration(summary.generation)
  const nextGeneration = safeNextGeneration(summary.nextGeneration)
  const current = safeCurrentGeneration(currentGeneration)
  if (endedGeneration === null || nextGeneration === null || current === null || endedGeneration + 1 !== nextGeneration || nextGeneration !== current) return null
  return { endedGeneration, currentGeneration: current }
}

export function formatGenerationHandoffTransition(transition: GenerationHandoffTransition): string {
  return `This settlement ended Generation ${transition.endedGeneration} and started the current Generation ${transition.currentGeneration} cohort at day 0. Current-state and preview numbers belong to Generation ${transition.currentGeneration}, not this recorded result.`
}

/** Resolve only an exact, safe generation match so autoplay never reveals a stale lane. */
export function resolveGenerationHandoffRevealTarget(requestedGeneration: unknown, actualGeneration: unknown, target: GenerationHandoffScrollTarget | null): GenerationHandoffRevealTarget | null {
  const requested = safeGeneration(requestedGeneration)
  const actual = safeGeneration(actualGeneration)
  if (target === null || requested === null || actual === null || requested !== actual || typeof target.scrollIntoView !== 'function') return null
  return { generation: actual, target, options: GENERATION_HANDOFF_REVEAL_SCROLL_OPTIONS }
}

const actualLaneStyle: CSSProperties = {
  flex: '1 1 340px',
  minWidth: 0,
  borderLeft: '3px solid var(--green)',
  paddingLeft: '9px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
}

const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', minWidth: 0 }
const detailStyle: CSSProperties = { color: 'var(--muted)', lineHeight: 1.45, whiteSpace: 'normal' }
const actionRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 9px', marginTop: '2px' }

function latestSettlement(ledgers: unknown): { summary: SettlementReportSummary | null; generation: number | null } {
  const records = Array.isArray(ledgers) ? ledgers : []
  const latest = records.length ? records[records.length - 1] : null
  return { summary: summarizeLatestSettlement(records), generation: getSettlementGeneration(latest) }
}

function settlementDescription(summary: SettlementReportSummary): string {
  const equation = formatSettlementEquation(summary)
  return equation === 'Settlement equation unavailable' ? GENERATION_HANDOFF_UNAVAILABLE : equation
}

export interface RecordedGenerationHandoffProps {
  ledgers: readonly GenerationLedger[] | unknown
  onReviewGeneration: (generation: number) => void
  revealGeneration?: number | null
  onRevealComplete?: (generation: number) => void
  /** Optional live context. Omit to preserve the standalone retained-result view. */
  currentGeneration?: unknown
  forecastPresent?: boolean
  playbackStatus?: ArenaPlaybackStatus
}

export function RecordedGenerationHandoff({ ledgers, onReviewGeneration, revealGeneration = null, onRevealComplete, currentGeneration, forecastPresent = false, playbackStatus = 'Running' }: RecordedGenerationHandoffProps) {
  const actualRef = useRef<HTMLDivElement | null>(null)
  const revealAttemptRef = useRef<number | null>(null)
  const latest = latestSettlement(ledgers)
  const actualGeneration = latest.summary?.generation ?? null

  useEffect(() => {
    if (revealGeneration === null || revealGeneration === undefined) {
      revealAttemptRef.current = null
      return
    }
    const resolved = resolveGenerationHandoffRevealTarget(revealGeneration, actualGeneration, actualRef.current)
    if (!resolved || revealAttemptRef.current === resolved.generation) return

    let cancelled = false
    let frame: number | null = null
    const reveal = () => {
      if (cancelled) return
      try {
        resolved.target.scrollIntoView(resolved.options)
        revealAttemptRef.current = resolved.generation
        onRevealComplete?.(resolved.generation)
      } catch {
        // Keep the request pending if the node was detached before scrolling.
      }
    }
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(reveal)
    else reveal()
    return () => {
      cancelled = true
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    }
  }, [actualGeneration, onRevealComplete, revealGeneration])

  if (!latest.summary) {
    const provenance = latest.generation === null
      ? 'Latest retained settlement record is incomplete or invalid.'
      : `Latest retained record for Generation ${latest.generation} is incomplete or invalid.`
    return <>
      <div data-handoff-kind="actual-unavailable" style={actualLaneStyle}>
        <span style={labelStyle}><strong>Actual recorded result</strong><small>Latest settlement</small></span>
        <span style={detailStyle}>{provenance} No forecast is shown for this record.</span>
      </div>
      <output className="sr-only" role="status" aria-live="polite" aria-atomic="true">{provenance}</output>
    </>
  }

  const summary = latest.summary
  const transition = resolveGenerationHandoffTransition(summary, currentGeneration, forecastPresent, playbackStatus)
  const equation = settlementDescription(summary)
  const lossDescription = formatSettlementLosses(summary)
  const reproductionDescription = formatSettlementReproductionBreakdown(summary)
  return <>
    <div ref={actualRef} data-handoff-kind="actual" style={actualLaneStyle}>
      <span style={labelStyle}><strong>Actual recorded result</strong><small>Generation {summary.generation} → {summary.nextGeneration} · recorded at settlement</small></span>
      {transition && <span data-handoff-detail="generation-transition" role="note" aria-label="Generation transition" style={{ ...detailStyle, color: 'var(--ink)' }}>{formatGenerationHandoffTransition(transition)}</span>}
      <span style={{ ...detailStyle, color: 'var(--ink)' }}>{equation}</span>
      <span data-handoff-detail="losses" style={detailStyle}>{lossDescription}</span>
      <span data-handoff-detail="reproduction" style={detailStyle}>{reproductionDescription}</span>
      <span style={actionRowStyle}>
        <button type="button" className="settings-toggle" onClick={() => onReviewGeneration(summary.generation)} aria-label={`Review generation ${summary.generation}`}>Review generation {summary.generation}</button>
        <small style={detailStyle}>Actual result · not a counterfactual forecast</small>
      </span>
    </div>
    <output className="sr-only" role="status" aria-live="polite" aria-atomic="true">{formatSettlementAnnouncement(summary)}</output>
  </>
}

export default RecordedGenerationHandoff
