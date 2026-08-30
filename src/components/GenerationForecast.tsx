import { MAX_POPULATION } from '../simulation/config'
import { settleLifecycle, type LifecycleOutcomeCause } from '../simulation/lifecycle'
import type { World } from '../simulation/types'

export const FORECAST_LOSS_CAUSES = ['hunted', 'energy', 'unfed', 'late', 'aged'] as const satisfies readonly Exclude<LifecycleOutcomeCause, 'survived'>[]
export type ForecastLossCause = (typeof FORECAST_LOSS_CAUSES)[number]
export const FORECAST_LOSS_LABELS: Record<ForecastLossCause, string> = {
  hunted: 'Hunted',
  energy: 'Energy depleted',
  unfed: 'Returned without enough food',
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

export function formatGenerationForecastAriaLabel(summary: GenerationForecastSummary): string {
  return `If generation ended now (provisional): ${formatGenerationForecastEquation(summary)}. Loss causes: ${formatGenerationForecastLosses(summary)}. ${formatGenerationForecastBirths(summary)}. This forecast changes as creatures act.`
}

export function GenerationForecast({ world }: { world: World }) {
  const summary = summarizeGenerationForecast(world)
  const losses = FORECAST_LOSS_CAUSES.filter(cause => summary.losses[cause] > 0)
  return <div className="ecology-line activity-line" role="group" aria-label={formatGenerationForecastAriaLabel(summary)}>
    <strong>If generation ended now</strong>
    <span><b>{summary.evaluatedCohort}</b> creatures evaluated → <b>{summary.survivors}</b> survived</span>
    <span>+ <b>{summary.admittedBirths}</b> {summary.admittedBirths === 1 ? 'newborn' : 'newborns'} = <b>{summary.projectedNextPopulation}</b> next</span>
    {losses.length ? losses.map(cause => <span key={cause}>{FORECAST_LOSS_LABELS[cause]} <b>{summary.losses[cause]}</b></span>) : <span>No current losses</span>}
    <span><b>{summary.eligibleParents}</b> eligible {summary.eligibleParents === 1 ? 'parent' : 'parents'}</span>
    <span><b>{summary.cappedBirths}</b> {summary.cappedBirths === 1 ? 'birth' : 'births'} blocked by cap</span>
    <span>Provisional · changes as creatures act</span>
  </div>
}
