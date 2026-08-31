import { sanitizeConfig } from '../simulation/config'
import type { Config } from '../simulation/types'
import type { AggregatePoint, ExperimentMetric, ExperimentPlan, InterventionConfigKey, InterventionPatch } from './types'

export interface InterventionConstraint {
  key: InterventionConfigKey
  label: string
  min: number
  max: number
  step: number
}

export const INTERVENTION_CONSTRAINTS: readonly InterventionConstraint[] = [
  { key: 'foodPerDay', label: 'Food per generation', min: 0, max: 120, step: 1 },
  { key: 'seasonAmplitude', label: 'Season strength', min: 0, max: .9, step: .05 },
  { key: 'seasonLength', label: 'Season length', min: 2, max: 60, step: 1 },
  { key: 'environmentResponse', label: 'Environment response', min: .01, max: 1, step: .01 },
  { key: 'foodTrend', label: 'Food trend / generation', min: -.1, max: .1, step: .01 },
  { key: 'moveEnergyFactor', label: 'Movement energy cost', min: .01, max: 3, step: .05 },
  { key: 'senseEnergyFactor', label: 'Sensing energy cost', min: 0, max: 2, step: .05 },
  { key: 'predatorRatio', label: 'Predator size ratio', min: 1.01, max: 3, step: .01 },
  { key: 'foodRegrowthRate', label: 'Food regrowth rate', min: 0, max: 1, step: .01 },
  { key: 'attackCost', label: 'Attack energy cost', min: 0, max: 100, step: 1 },
  { key: 'reactionTime', label: 'Reaction time', min: 0, max: 5, step: .05 },
  { key: 'reproductionEnergyCost', label: 'Reproduction energy cost', min: 0, max: 300, step: 5 },
]

export const EXPERIMENT_METRIC_OPTIONS: readonly { key: ExperimentMetric; label: string }[] = [
  { key: 'population', label: 'Population' },
  { key: 'survivalRate', label: 'Survival rate' },
  { key: 'births', label: 'Births' },
  { key: 'hunted', label: 'Hunted' },
  { key: 'energyDeaths', label: 'Energy deaths' },
  { key: 'foodConsumed', label: 'Food consumed' },
  { key: 'foodProduced', label: 'Food produced' },
  { key: 'resourceAbundance', label: 'Resource abundance' },
  { key: 'attackSuccessRate', label: 'Attack success rate' },
  { key: 'aged', label: 'Age deaths' },
  { key: 'avgEnergy', label: 'Average energy' },
  { key: 'avgAge', label: 'Average age' },
  { key: 'avgSpeed', label: 'Average speed' },
  { key: 'avgSize', label: 'Average size' },
  { key: 'avgSense', label: 'Average sense' },
  { key: 'avgAggression', label: 'Average aggression' },
  { key: 'avgCaution', label: 'Average caution' },
  { key: 'avgExploration', label: 'Average exploration' },
]

export type ExperimentPreset = 'drought' | 'movement' | 'predation'

export const EXPERIMENT_PRESETS: readonly { key: ExperimentPreset; label: string }[] = [
  { key: 'drought', label: 'Drought' },
  { key: 'movement', label: 'High movement cost' },
  { key: 'predation', label: 'Predation pressure' },
]

export interface ExperimentDraft {
  replicates: number
  generations: number
  masterSeed: number
  metric: ExperimentMetric
  stopOnExtinction: boolean
  interventionGeneration: number
  interventionKey: InterventionConfigKey
  interventionValue: number
}

export type ExperimentStudySizeKey = 'quick' | 'standard' | 'deep'
export type ExperimentStudySizeSelection = ExperimentStudySizeKey | 'custom'
export const DEFAULT_EXPERIMENT_STUDY_SIZE: ExperimentStudySizeKey = 'quick'

export interface ExperimentStudySizeOption {
  key: ExperimentStudySizeKey
  label: string
  replicates: number
  generations: number
}

export const EXPERIMENT_ARM_COUNT = 2

/** Count one run for each arm advancing through one generation. */
export function experimentGenerationRunCount(replicates: number, generations: number): number {
  const pairs = Number.isFinite(replicates) ? Math.max(0, Math.round(replicates)) : 0
  const horizon = Number.isFinite(generations) ? Math.max(0, Math.round(generations)) : 0
  return pairs * horizon * EXPERIMENT_ARM_COUNT
}

/** Named workloads keep the first experiment easy to run while making scale explicit. */
export const EXPERIMENT_STUDY_SIZES: readonly ExperimentStudySizeOption[] = [
  { key: 'quick', label: 'Quick exploratory', replicates: 4, generations: 6 },
  { key: 'standard', label: 'Standard', replicates: 6, generations: 8 },
  { key: 'deep', label: 'Deep', replicates: 10, generations: 16 },
]

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Return the one-based generation where a treatment should begin for a horizon. */
export function interventionGenerationFor(generations: number): number {
  const horizon = Number.isFinite(generations) ? Math.max(1, Math.round(generations)) : 1
  return clamp(Math.round(horizon * .4), 1, horizon)
}

export function identifyExperimentStudySize(replicates: number, generations: number): ExperimentStudySizeSelection {
  return EXPERIMENT_STUDY_SIZES.find(item => item.replicates === replicates && item.generations === generations)?.key ?? 'custom'
}

export function applyExperimentStudySize(
  size: ExperimentStudySizeKey,
  draft: ExperimentDraft,
): ExperimentDraft {
  const option = EXPERIMENT_STUDY_SIZES.find(item => item.key === size)
  if (!option) return draft
  return {
    ...draft,
    replicates: option.replicates,
    generations: option.generations,
    interventionGeneration: interventionGenerationFor(option.generations),
  }
}

export function experimentEarlyStopNote(completedGenerationRuns: number, plannedGenerationRuns: number): string | null {
  if (completedGenerationRuns >= plannedGenerationRuns) return null
  return `Only ${completedGenerationRuns} of ${plannedGenerationRuns} planned generation-runs completed; extinct arms stopped early.`
}

export function experimentCompletionMessage(completedGenerationRuns: number, plannedGenerationRuns: number): string {
  const note = experimentEarlyStopNote(completedGenerationRuns, plannedGenerationRuns)
  return note ? `Experiment complete. ${note}` : 'Experiment complete.'
}

/** Return the latest generation whose paired effect has at least one comparable pair. */
export function latestComparableAggregate(aggregates: readonly AggregatePoint[]): AggregatePoint | null {
  for (let index = aggregates.length - 1; index >= 0; index--) {
    const aggregate = aggregates[index]
    if (aggregate.effect.count > 0) return aggregate
  }
  return null
}

export function maximumExperimentGenerations(replicates: number): number {
  const cleanReplicates = clamp(Math.round(replicates || 2), 2, 20)
  return Math.min(40, Math.floor(2_000 / (cleanReplicates * 2)))
}

export function constraintFor(key: InterventionConfigKey): InterventionConstraint {
  return INTERVENTION_CONSTRAINTS.find(item => item.key === key)!
}

export function inactiveInterventionReason(config:Config,key:InterventionConfigKey):string|null{
  if((key==='foodRegrowthRate'||key==='reproductionEnergyCost')&&config.ecologyMode!=='energy-regrowth')return`${constraintFor(key).label} is inactive in classic lifecycle mode. Choose Energy + patch regrowth or another pressure.`
  if(key==='attackCost'&&config.predationMode!=='contest')return`${constraintFor(key).label} is inactive with size-threshold predation. Choose Contested attacks or another pressure.`
  if(key==='reactionTime'&&config.perceptionMode!=='realistic')return`${constraintFor(key).label} is inactive with perfect perception. Choose realistic perception or another pressure.`
  return null
}

export function availableInterventionConstraints(config:Config):readonly InterventionConstraint[]{return INTERVENTION_CONSTRAINTS.filter(item=>inactiveInterventionReason(config,item.key)===null)}

export function normalizeInterventionValue(key: InterventionConfigKey, value: number): number {
  const constraint = constraintFor(key)
  const finite = Number.isFinite(value) ? value : constraint.min
  const stepped = Math.round((finite - constraint.min) / constraint.step) * constraint.step + constraint.min
  return Number(clamp(stepped, constraint.min, constraint.max).toFixed(6))
}

export function defaultExperimentDraft(baseConfig: Config): ExperimentDraft {
  const study = EXPERIMENT_STUDY_SIZES.find(option => option.key === DEFAULT_EXPERIMENT_STUDY_SIZE)!
  const generations = study.generations
  return {
    replicates: study.replicates,
    generations,
    masterSeed: baseConfig.seed,
    metric: 'population',
    stopOnExtinction: true,
    interventionGeneration: interventionGenerationFor(generations),
    interventionKey: 'foodPerDay',
    interventionValue: normalizeInterventionValue('foodPerDay', baseConfig.ecologyMode === 'energy-regrowth' ? 0 : Math.round(baseConfig.foodPerDay * .4)),
  }
}

export function applyExperimentPreset(preset: ExperimentPreset, draft: ExperimentDraft, baseConfig: Config): ExperimentDraft {
  const interventionGeneration = interventionGenerationFor(draft.generations)
  if (preset === 'movement') return {
    ...draft,
    interventionGeneration,
    interventionKey: 'moveEnergyFactor',
    interventionValue: normalizeInterventionValue('moveEnergyFactor', Math.max(1.35, baseConfig.moveEnergyFactor * 1.8)),
  }
  if (preset === 'predation') return {
    ...draft,
    interventionGeneration,
    interventionKey: 'predatorRatio',
    interventionValue: normalizeInterventionValue('predatorRatio', Math.max(1.01, baseConfig.predatorRatio - .2)),
  }
  return {
    ...draft,
    interventionGeneration,
    interventionKey: 'foodPerDay',
    // Ecological mode approaches this resource target according to the configured
    // environment response; classic mode uses it for the next food pulse.
    interventionValue: normalizeInterventionValue('foodPerDay', baseConfig.ecologyMode === 'energy-regrowth' ? 0 : Math.round(baseConfig.foodPerDay * .35)),
  }
}

export function buildExperimentPlan(baseConfig: Config, draft: ExperimentDraft): ExperimentPlan {
  const replicates = clamp(Math.round(draft.replicates || 2), 2, 20)
  const generations = clamp(Math.round(draft.generations || 2), 2, maximumExperimentGenerations(replicates))
  const masterSeed = clamp(Math.round(draft.masterSeed || 1), 1, 9_999_999)
  const interventionGeneration = clamp(Math.round(draft.interventionGeneration || 1), 1, generations)
  const interventionValue = normalizeInterventionValue(draft.interventionKey, draft.interventionValue)
  const changes = { [draft.interventionKey]: interventionValue } as InterventionPatch
  return {
    id: `paired-${masterSeed}-${replicates}x${generations}`,
    label: 'Control vs treatment',
    masterSeed,
    replicates,
    generations,
    baseConfig: sanitizeConfig({ ...baseConfig }),
    scenarioA: { id: 'control', label: 'Control' },
    scenarioB: {
      id: 'treatment',
      label: 'Treatment',
      interventions: [{ id: `treatment-${draft.interventionKey}`, generation: interventionGeneration, changes }],
    },
    metrics: [draft.metric],
    stopOnExtinction: draft.stopOnExtinction,
  }
}

export function treatmentNoOpReason(baseConfig: Config, draft: ExperimentDraft): string | null {
  const inactive=inactiveInterventionReason(baseConfig,draft.interventionKey)
  if(inactive)return inactive
  const constraint = constraintFor(draft.interventionKey)
  const controlValue = baseConfig[draft.interventionKey]
  const treatmentValue = normalizeInterventionValue(draft.interventionKey, draft.interventionValue)
  if (controlValue !== treatmentValue) return null
  const boundary = controlValue === constraint.min ? 'minimum' : controlValue === constraint.max ? 'maximum' : 'current value'
  return `${constraint.label} is already at its ${boundary} (${controlValue}), so this treatment would be identical to the control. Choose another preset or change the live configuration.`
}

export function workerEventIsCurrent(requestId: string, activeRequestId: string | null): boolean {
  return activeRequestId !== null && requestId === activeRequestId
}

export function experimentProgressIsCurrent(requestId: string, activeRequestId: string | null, cancelling: boolean): boolean {
  return !cancelling && workerEventIsCurrent(requestId, activeRequestId)
}

export function formatExperimentMetricValue(value: number | null, metric?: ExperimentMetric): string {
  if (value === null) return '—'
  if (metric === 'survivalRate' || metric === 'attackSuccessRate') return `${(value * 100).toFixed(1)}%`
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2)
}
