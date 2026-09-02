import { MAX_POPULATION } from '../simulation/config'
import { settleLifecycle } from '../simulation/lifecycle'
import type { World } from '../simulation/types'
import type { ArenaPlaybackStatus } from './ArenaCanvas'
import type { CSSProperties } from 'react'
import { FORECAST_LOSS_CAUSES, FORECAST_LOSS_LABELS } from './SettlementPreview'
import type { ForecastLossCause } from './SettlementPreview'

export { FORECAST_LOSS_CAUSES, FORECAST_LOSS_LABELS, summarizeSelectedSettlementPreview } from './SettlementPreview'
export type { ForecastLossCause, SelectedSettlementPreview, SelectedSettlementReproductionStatus } from './SettlementPreview'

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
