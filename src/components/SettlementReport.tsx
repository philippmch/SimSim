import type { GenerationLedger } from '../simulation/types'

export const SETTLEMENT_LOSS_CAUSES = ['hunted', 'energy', 'unfed', 'late', 'aged'] as const
export type SettlementLossCause = (typeof SETTLEMENT_LOSS_CAUSES)[number]

export const SETTLEMENT_LOSS_LABELS: Record<SettlementLossCause, string> = {
  hunted: 'Hunted',
  energy: 'Energy depleted',
  unfed: 'No food at settlement',
  late: 'Missed return deadline',
  aged: 'Old age',
}

export const SETTLEMENT_REPORT_UNAVAILABLE = 'Recorded settlement details unavailable for this retained record.'

/** Counts in a ledger are discrete population outcomes, so unsafe values stay unavailable. */
export function isFiniteNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function isValidSettlementGeneration(value: unknown): value is number {
  // Keep generation + 1 an exact, safe integer for the displayed transition.
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER
}

export function isValidSettlementNextGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 2 && value <= Number.MAX_SAFE_INTEGER
}

type SettlementLosses = Record<SettlementLossCause, number | null>

export interface SettlementReportSummary {
  generation: number
  nextGeneration: number
  evaluatedCohort: number
  survivors: number
  admittedBirths: number
  eligibleParents: number | null
  exactNextPopulation: number
  losses: SettlementLosses
  totalLosses: number | null
  cappedBirths: number | null
}

interface RecordLike {
  [key: string]: unknown
}

function record(value: unknown): RecordLike | null {
  return value !== null && typeof value === 'object' ? value as RecordLike : null
}

function read(value: unknown, key: string): unknown {
  const source = record(value)
  if (!source) return undefined
  try {
    return source[key]
  } catch {
    return undefined
  }
}

function emptyLosses(): SettlementLosses {
  return Object.fromEntries(SETTLEMENT_LOSS_CAUSES.map(cause => [cause, null])) as SettlementLosses
}

interface SettlementCore {
  generation: number
  nextGeneration: number
  evaluatedCohort: number
  survivors: number
  admittedBirths: number
  exactNextPopulation: number
}

function deriveSettlementCore(ledger: unknown): SettlementCore | null {
  const generation = getSettlementGeneration(ledger)
  const evaluatedCohort = read(ledger, 'startPopulation')
  const outcomes = read(ledger, 'outcomes')
  const survivors = read(outcomes, 'survived')
  const admittedBirths = read(ledger, 'birthsAdmitted')
  if (generation === null || !isFiniteNonnegativeInteger(evaluatedCohort) || !isFiniteNonnegativeInteger(survivors) || !isFiniteNonnegativeInteger(admittedBirths)) return null
  if (survivors > evaluatedCohort || admittedBirths > survivors) return null
  const exactNextPopulation = survivors + admittedBirths
  if (!isFiniteNonnegativeInteger(exactNextPopulation)) return null
  return {
    generation,
    nextGeneration: generation + 1,
    evaluatedCohort,
    survivors,
    admittedBirths,
    exactNextPopulation,
  }
}

/** Read only the generation label so an unavailable record can retain provenance. */
export function getSettlementGeneration(ledger: GenerationLedger | unknown): number | null {
  const generation = read(ledger, 'generation')
  return isValidSettlementGeneration(generation) ? generation : null
}

/**
 * Summarize one retained ledger without trusting the compatibility lastReport
 * placeholder or inventing values for malformed optional counters.
 */
export function summarizeSettlementReport(ledger: GenerationLedger | unknown): SettlementReportSummary | null {
  const core = deriveSettlementCore(ledger)
  if (!core) return null

  const outcomes = read(ledger, 'outcomes')
  const losses = emptyLosses()
  let allLossesValid = true
  let totalLosses = 0
  for (const cause of SETTLEMENT_LOSS_CAUSES) {
    const value = read(outcomes, cause)
    if (!isFiniteNonnegativeInteger(value)) {
      allLossesValid = false
      continue
    }
    losses[cause] = value
    totalLosses += value
    if (!isFiniteNonnegativeInteger(totalLosses)) allLossesValid = false
  }

  // A total is only useful when every cause is present and the retained
  // outcome buckets reconcile with the evaluated cohort. Known valid causes
  // remain visible below even when the aggregate must be marked unavailable.
  const reconciles = allLossesValid
    && isFiniteNonnegativeInteger(totalLosses)
    && isFiniteNonnegativeInteger(core.survivors + totalLosses)
    && core.survivors + totalLosses === core.evaluatedCohort

  const rawEligibleParents = read(ledger, 'birthsEligible')
  const rawCappedBirths = read(ledger, 'birthsCapped')
  const validEligibleParents = isFiniteNonnegativeInteger(rawEligibleParents)
    && rawEligibleParents >= core.admittedBirths
    && rawEligibleParents <= core.survivors
  const validCap = validEligibleParents
    && isFiniteNonnegativeInteger(rawCappedBirths)
    && rawEligibleParents === core.admittedBirths + rawCappedBirths
  return {
    ...core,
    eligibleParents: validEligibleParents ? rawEligibleParents : null,
    losses,
    totalLosses: reconciles ? totalLosses : null,
    cappedBirths: validCap ? rawCappedBirths : null,
  }
}

/** Select the newest retained record with a truthful core equation. */
export function summarizeLatestSettlement(ledgers: readonly GenerationLedger[] | unknown): SettlementReportSummary | null {
  if (!Array.isArray(ledgers)) return null
  return ledgers.length ? summarizeSettlementReport(ledgers[ledgers.length - 1]) : null
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function formatSettlementLosses(summary: SettlementReportSummary): string {
  const causes: string[] = []
  let allCausesValid = true
  let causeSum = 0
  for (const cause of SETTLEMENT_LOSS_CAUSES) {
    const value = read(read(summary, 'losses'), cause)
    if (!isFiniteNonnegativeInteger(value)) {
      allCausesValid = false
      causes.push(`${SETTLEMENT_LOSS_LABELS[cause]}: unavailable`)
      continue
    }
    causeSum += value
    if (!isFiniteNonnegativeInteger(causeSum)) allCausesValid = false
    if (value > 0) causes.push(`${SETTLEMENT_LOSS_LABELS[cause]}: ${value}`)
  }
  const totalLosses = read(summary, 'totalLosses')
  const evaluatedCohort = read(summary, 'evaluatedCohort')
  const survivors = read(summary, 'survivors')
  const reconciles = allCausesValid
    && isFiniteNonnegativeInteger(totalLosses)
    && isFiniteNonnegativeInteger(evaluatedCohort)
    && isFiniteNonnegativeInteger(survivors)
    && causeSum === totalLosses
    && isFiniteNonnegativeInteger(survivors + totalLosses)
    && survivors + totalLosses === evaluatedCohort
  if (!reconciles) return causes.length ? `Total losses unavailable · ${causes.join(' · ')}` : 'Loss causes unavailable'
  if (!causes.length) return `Total losses: ${totalLosses} · No recorded losses`
  return `Total losses: ${totalLosses} · ${causes.join(' · ')}`
}

export function formatSettlementEquation(summary: SettlementReportSummary): string {
  const evaluatedCohort = read(summary, 'evaluatedCohort')
  const survivors = read(summary, 'survivors')
  const admittedBirths = read(summary, 'admittedBirths')
  const exactNextPopulation = read(summary, 'exactNextPopulation')
  if (!isFiniteNonnegativeInteger(evaluatedCohort) || !isFiniteNonnegativeInteger(survivors) || !isFiniteNonnegativeInteger(admittedBirths) || !isFiniteNonnegativeInteger(exactNextPopulation) || survivors > evaluatedCohort || admittedBirths > survivors || survivors + admittedBirths !== exactNextPopulation) return 'Settlement equation unavailable'
  return `${countLabel(evaluatedCohort, 'creature')} evaluated → ${survivors} survived + ${countLabel(admittedBirths, 'admitted birth', 'admitted births')} = ${countLabel(exactNextPopulation, 'creature')} in the next population`
}

export function formatSettlementBirthCap(summary: SettlementReportSummary): string {
  const cappedBirths = read(summary, 'cappedBirths')
  const eligibleParents = read(summary, 'eligibleParents')
  const admittedBirths = read(summary, 'admittedBirths')
  const survivors = read(summary, 'survivors')
  if (!isFiniteNonnegativeInteger(cappedBirths)
    || !isFiniteNonnegativeInteger(eligibleParents)
    || !isFiniteNonnegativeInteger(admittedBirths)
    || !isFiniteNonnegativeInteger(survivors)
    || admittedBirths > eligibleParents
    || eligibleParents > survivors
    || eligibleParents !== admittedBirths + cappedBirths) return 'Birth-cap count unavailable'
  if (cappedBirths === 0) return 'No births capped'
  return `${cappedBirths} ${cappedBirths === 1 ? 'birth' : 'births'} capped by population limit`
}

export function formatSettlementReportAriaLabel(summary: SettlementReportSummary): string {
  const generation = getSettlementGeneration(summary)
  if (generation === null || formatSettlementEquation(summary) === 'Settlement equation unavailable') return 'Last recorded settlement details unavailable for this retained record.'
  const nextGeneration = read(summary, 'nextGeneration')
  if (!isValidSettlementNextGeneration(nextGeneration) || nextGeneration !== generation + 1) return 'Last recorded settlement details unavailable for this retained record.'
  const exactNextPopulation = read(summary, 'exactNextPopulation')
  if (!isFiniteNonnegativeInteger(exactNextPopulation)) return 'Last recorded settlement details unavailable for this retained record.'
  return `Last recorded settlement, Generation ${generation} to ${nextGeneration}`
}

export function formatSettlementAnnouncement(summary: SettlementReportSummary): string {
  const generation = getSettlementGeneration(summary)
  const nextGeneration = read(summary, 'nextGeneration')
  const equation = formatSettlementEquation(summary)
  if (generation === null || !isValidSettlementNextGeneration(nextGeneration) || nextGeneration !== generation + 1 || equation === 'Settlement equation unavailable') return SETTLEMENT_REPORT_UNAVAILABLE
  const exactNextPopulation = read(summary, 'exactNextPopulation')
  if (!isFiniteNonnegativeInteger(exactNextPopulation)) return SETTLEMENT_REPORT_UNAVAILABLE
  const capDescription = formatSettlementBirthCap(summary)
  const cap = capDescription === 'No births capped' ? '' : ` ${capDescription}.`
  return `Recorded settlement, Generation ${generation} → ${nextGeneration} (actual result, not a counterfactual forecast): ${equation}. ${formatSettlementLosses(summary)}.${cap}`
}

export interface SettlementReportProps {
  ledgers: readonly GenerationLedger[]
  onReviewGeneration: (generation: number) => void
}

export function SettlementReport({ ledgers, onReviewGeneration }: SettlementReportProps) {
  if (!Array.isArray(ledgers) || !ledgers.length) return null
  const latestLedger = ledgers[ledgers.length - 1]
  const summary = summarizeSettlementReport(latestLedger)
  if (!summary) {
    const generation = getSettlementGeneration(latestLedger)
    return <>
      <div className="interventions" role="group" aria-label={`Last recorded settlement unavailable${generation === null ? '' : ` for Generation ${generation}`}`}>
        <span><strong>Last recorded settlement</strong><small>Recorded result unavailable</small></span>
        <span style={{ flex: '1 1 100%', whiteSpace: 'normal', color: 'var(--muted)' }}>{SETTLEMENT_REPORT_UNAVAILABLE}</span>
      </div>
      <output className="sr-only" role="status" aria-live="polite" aria-atomic="true">{generation === null ? SETTLEMENT_REPORT_UNAVAILABLE : `Last recorded settlement for Generation ${generation} is unavailable.`}</output>
    </>
  }

  const nonzeroLosses = SETTLEMENT_LOSS_CAUSES.filter(cause => summary.losses[cause] !== null && summary.losses[cause] > 0)
  const reviewLabel = `Review generation ${summary.generation}`
  return <>
    <div className="interventions" role="group" aria-label={formatSettlementReportAriaLabel(summary)}>
      <span><strong>Last recorded settlement</strong><small>Actual recorded result · Generation {summary.generation} → {summary.nextGeneration}</small></span>
      <div style={{ display: 'flex', flex: '1 1 100%', flexWrap: 'wrap', alignItems: 'center', gap: '5px 10px', minWidth: 0 }}>
        <span style={{ flexDirection: 'row', whiteSpace: 'nowrap' }}>Evaluated <b>{summary.evaluatedCohort}</b></span>
        <span style={{ flexDirection: 'row', whiteSpace: 'nowrap' }}>Survivors <b>{summary.survivors}</b></span>
        <span style={{ flexDirection: 'row', whiteSpace: 'nowrap' }}>Admitted births <b>{summary.admittedBirths}</b></span>
        <span style={{ flexDirection: 'row', whiteSpace: 'nowrap' }}>Exact next population <b>{summary.exactNextPopulation}</b></span>
        {summary.totalLosses === null ? <span style={{ flexDirection: 'row', whiteSpace: 'normal' }}>{formatSettlementLosses(summary)}</span> : <>
          <span style={{ flexDirection: 'row', whiteSpace: 'nowrap' }}>Total losses <b>{summary.totalLosses}</b></span>
          {nonzeroLosses.length ? nonzeroLosses.map(cause => <span key={cause} style={{ flexDirection: 'row', whiteSpace: 'nowrap' }}>{SETTLEMENT_LOSS_LABELS[cause]} <b>{summary.losses[cause]}</b></span>) : <span style={{ flexDirection: 'row', whiteSpace: 'nowrap' }}>No recorded losses</span>}
        </>}
        {summary.cappedBirths === null ? <span style={{ flexDirection: 'row', whiteSpace: 'normal' }}>{formatSettlementBirthCap(summary)}</span> : <span style={{ flexDirection: 'row', whiteSpace: 'nowrap' }}>Capped births <b>{summary.cappedBirths}</b></span>}
      </div>
      <button type="button" className="settings-toggle" onClick={() => onReviewGeneration(summary.generation)} aria-label={reviewLabel}>{reviewLabel}</button>
    </div>
    <output className="sr-only" role="status" aria-live="polite" aria-atomic="true">{formatSettlementAnnouncement(summary)}</output>
  </>
}

export default SettlementReport
