import { useEffect, useRef, type CSSProperties } from 'react'
import type { GenerationLedger } from '../simulation/types'
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
}

export function RecordedGenerationHandoff({ ledgers, onReviewGeneration, revealGeneration = null, onRevealComplete }: RecordedGenerationHandoffProps) {
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
  const equation = settlementDescription(summary)
  const lossDescription = formatSettlementLosses(summary)
  const reproductionDescription = formatSettlementReproductionBreakdown(summary)
  return <>
    <div ref={actualRef} data-handoff-kind="actual" style={actualLaneStyle}>
      <span style={labelStyle}><strong>Actual recorded result</strong><small>Generation {summary.generation} → {summary.nextGeneration} · recorded at settlement</small></span>
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
