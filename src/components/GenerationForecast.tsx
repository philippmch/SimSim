import { MAX_POPULATION } from '../simulation/config'
import { settleLifecycle, type LifecycleOutcomeCause } from '../simulation/lifecycle'
import type { World } from '../simulation/types'
import type { ArenaPlaybackStatus } from './ArenaCanvas'
import type { CSSProperties } from 'react'

export const FORECAST_LOSS_CAUSES = ['hunted', 'energy', 'unfed', 'late', 'aged'] as const satisfies readonly Exclude<LifecycleOutcomeCause, 'survived'>[]
export type ForecastLossCause = (typeof FORECAST_LOSS_CAUSES)[number]
export const FORECAST_LOSS_LABELS: Record<ForecastLossCause, string> = {
  hunted: 'Hunted',
  energy: 'Energy depleted',
  unfed: 'No food at settlement',
  late: 'Missed return deadline',
  aged: 'Old age',
}

export interface GenerationForecastSummary {
  generation: number
  evaluatedCohort: number
  survivors: number
  projectedNextPopulation: number
  eligibleParents: number
  admittedBirths: number
  cappedBirths: number
  losses: Record<ForecastLossCause, number>
}

export type SelectedSettlementReproductionStatus = 'admitted' | 'eligible-capacity-blocked' | 'not-eligible'

/**
 * Scalar, read-only settlement facts for one individual.  Keeping this
 * projection separate from World means the lazy inspector never needs the
 * whole cohort (or a mutable creature collection) to explain its outcome.
 */
export interface SelectedSettlementPreview {
  individualId: number
  generation: number
  mode: World['config']['ecologyMode']
  outcome: LifecycleOutcomeCause
  nextAge: number | null
  retainedEnergy: number | null
  settledEnergy: number | null
  reproductionStatus: SelectedSettlementReproductionStatus
  foodAtSettlement: number
  reproductionCost: number
  eligibleParentCount: number
  availableBirthSlots: number
}

const finiteNonNegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0

/**
 * Project the exact lifecycle settlement for a selected individual.  The
 * underlying policy is run for the complete cohort so admission and capacity
 * competition remain authoritative; settleLifecycle is pure and keyed, so it
 * does not consume World.rngState.
 */
export function summarizeSelectedSettlementPreview(world: World, individualId: number | null | undefined): SelectedSettlementPreview | null {
  if (typeof individualId !== 'number' || !Number.isSafeInteger(individualId) || individualId < 1) return null
  const settlement = settleLifecycle(world.creatures, world.config, {
    seed: world.config.seed,
    generation: world.generation,
    maxPopulation: MAX_POPULATION,
  })
  const outcome = settlement.outcomes.find(item => item.individual.individualId === individualId)
  if (!outcome) return null
  const survivor = settlement.survivors.find(item => item.individual.individualId === individualId)
  const reproductionStatus: SelectedSettlementReproductionStatus = !survivor?.reproductionEligible
    ? 'not-eligible'
    : survivor.birthAdmitted ? 'admitted' : 'eligible-capacity-blocked'
  return {
    individualId,
    generation: world.generation,
    mode: settlement.mode,
    outcome: outcome.cause,
    nextAge: survivor?.nextAge ?? null,
    retainedEnergy: survivor?.retainedEnergy ?? null,
    settledEnergy: survivor?.settledEnergy ?? null,
    reproductionStatus,
    foodAtSettlement: finiteNonNegative(outcome.individual.food),
    reproductionCost: finiteNonNegative(world.config.reproductionEnergyCost),
    eligibleParentCount: settlement.eligibleParents.length,
    availableBirthSlots: settlement.availableBirthSlots,
  }
}

/** Summarize the exact settlement that would happen if the current generation ended now. */
export function summarizeGenerationForecast(world: World): GenerationForecastSummary {
  const settlement = settleLifecycle(world.creatures, world.config, {
    seed: world.config.seed,
    generation: world.generation,
    maxPopulation: MAX_POPULATION,
  })
  const losses = Object.fromEntries(FORECAST_LOSS_CAUSES.map(cause => [cause, settlement.outcomeCounts[cause]])) as Record<ForecastLossCause, number>
  return {
    generation: world.generation,
    evaluatedCohort: settlement.outcomes.length,
    survivors: settlement.survivors.length,
    projectedNextPopulation: settlement.survivors.length + settlement.admittedParents.length,
    eligibleParents: settlement.eligibleParents.length,
    admittedBirths: settlement.admittedParents.length,
    cappedBirths: settlement.birthsCapped,
    losses,
  }
}

export function formatGenerationForecastEquation(summary: GenerationForecastSummary): string {
  const creatures = (count: number) => `${count} ${count === 1 ? 'creature' : 'creatures'}`
  const newborns = (count: number) => `${count} ${count === 1 ? 'newborn' : 'newborns'}`
  return `${creatures(summary.evaluatedCohort)} evaluated → ${summary.survivors} survived + ${newborns(summary.admittedBirths)} = ${summary.projectedNextPopulation} in the next population`
}

export function formatGenerationForecastLosses(summary: GenerationForecastSummary): string {
  const losses = FORECAST_LOSS_CAUSES.filter(cause => summary.losses[cause] > 0).map(cause => `${FORECAST_LOSS_LABELS[cause]}: ${summary.losses[cause]}`)
  return losses.length ? losses.join(' · ') : 'No current losses'
}

export function formatGenerationForecastBirths(summary: GenerationForecastSummary): string {
  const parents = `${summary.eligibleParents} ${summary.eligibleParents === 1 ? 'eligible parent' : 'eligible parents'}`
  const newborns = `${summary.admittedBirths} ${summary.admittedBirths === 1 ? 'admitted newborn' : 'admitted newborns'}`
  const blocked = `${summary.cappedBirths} ${summary.cappedBirths === 1 ? 'birth' : 'births'} blocked by the population cap`
  return `${parents} · ${newborns} · ${blocked}`
}

export function formatGenerationForecastHeading(status: ArenaPlaybackStatus): string {
  if (status === 'Awaiting settlement') return 'Settlement preview'
  if (status === 'Extinct') return 'Population extinct'
  return 'If generation ended now'
}

function safeGeneration(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER ? value : null
}

/** Keep the counterfactual transition explicit without implying that it has been recorded. */
export function formatGenerationForecastTransition(summary: GenerationForecastSummary, status: ArenaPlaybackStatus = 'Running'): string {
  if (status === 'Extinct') return 'Forecast transition unavailable · no current cohort'
  const generation = safeGeneration(summary.generation)
  return generation === null ? 'Forecast transition unavailable' : `Forecast transition · Generation ${generation} → ${generation + 1}`
}

export function formatGenerationForecastFraming(status: ArenaPlaybackStatus): string {
  if (status === 'Awaiting settlement') return 'Not recorded until Finish generation'
  if (status === 'Extinct') return 'No cohort remains to evaluate'
  return 'Counterfactual snapshot · not a prediction · updates as creatures act'
}

export function formatGenerationForecastAriaLabel(summary: GenerationForecastSummary, status: ArenaPlaybackStatus = 'Running'): string {
  const heading = formatGenerationForecastHeading(status)
  const transition = formatGenerationForecastTransition(summary, status)
  const framing = formatGenerationForecastFraming(status)
  if (status === 'Extinct') return `${heading}. ${transition}. ${framing}.`
  const details = `${formatGenerationForecastEquation(summary)}. Loss causes: ${formatGenerationForecastLosses(summary)}. ${formatGenerationForecastBirths(summary)}.`
  return `${heading}. ${transition}. ${framing}. ${details}`
}

const forecastLaneStyle: CSSProperties = {
  flex: '1 1 320px',
  minWidth: 0,
  borderLeft: '3px dotted var(--muted)',
  paddingLeft: '9px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
}

const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', minWidth: 0 }
const detailStyle: CSSProperties = { color: 'var(--muted)', lineHeight: 1.45, whiteSpace: 'normal' }

export function GenerationForecast({ world, playbackStatus }: { world: World; playbackStatus: ArenaPlaybackStatus }) {
  const summary = summarizeGenerationForecast(world)
  const heading = formatGenerationForecastHeading(playbackStatus)
  const transition = formatGenerationForecastTransition(summary, playbackStatus)
  const framing = formatGenerationForecastFraming(playbackStatus)
  if (playbackStatus === 'Extinct') return <div data-handoff-kind="forecast" role="group" aria-label={formatGenerationForecastAriaLabel(summary, playbackStatus)} style={forecastLaneStyle}>
    <span style={labelStyle}><strong>{heading}</strong><small>{transition}</small></span>
    <span style={detailStyle}>{framing}</span>
  </div>
  return <div data-handoff-kind="forecast" role="group" aria-label={formatGenerationForecastAriaLabel(summary, playbackStatus)} style={forecastLaneStyle}>
    <span style={labelStyle}><strong>{heading}</strong><small>{transition}</small></span>
    <span style={{ ...detailStyle, color: 'var(--ink)' }}>{formatGenerationForecastEquation(summary)}</span>
    <span style={detailStyle}>Losses if settled now: {formatGenerationForecastLosses(summary)}</span>
    <span style={detailStyle}>{formatGenerationForecastBirths(summary)}</span>
    <span style={detailStyle}>{framing}</span>
  </div>
}
