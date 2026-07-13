import { sanitizeConfig } from '../simulation/config'
import type { Config } from '../simulation/types'
import type { ExperimentMetric, ExperimentPlan, InterventionConfigKey, InterventionPatch } from './types'

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
]

export const EXPERIMENT_METRIC_OPTIONS: readonly { key: ExperimentMetric; label: string }[] = [
  { key: 'population', label: 'Population' },
  { key: 'survivalRate', label: 'Survival rate' },
  { key: 'births', label: 'Births' },
  { key: 'hunted', label: 'Hunted' },
  { key: 'energyDeaths', label: 'Energy deaths' },
  { key: 'foodConsumed', label: 'Food consumed' },
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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function maximumExperimentGenerations(replicates: number): number {
  const cleanReplicates = clamp(Math.round(replicates || 2), 2, 20)
  return Math.min(40, Math.floor(2_000 / (cleanReplicates * 2)))
}

export function constraintFor(key: InterventionConfigKey): InterventionConstraint {
  return INTERVENTION_CONSTRAINTS.find(item => item.key === key)!
}

export function normalizeInterventionValue(key: InterventionConfigKey, value: number): number {
  const constraint = constraintFor(key)
  const finite = Number.isFinite(value) ? value : constraint.min
  const stepped = Math.round((finite - constraint.min) / constraint.step) * constraint.step + constraint.min
  return Number(clamp(stepped, constraint.min, constraint.max).toFixed(6))
}

export function defaultExperimentDraft(baseConfig: Config): ExperimentDraft {
  const generations = 12
  return {
    replicates: 6,
    generations,
    masterSeed: baseConfig.seed,
    metric: 'population',
    stopOnExtinction: true,
    interventionGeneration: 5,
    interventionKey: 'foodPerDay',
    interventionValue: normalizeInterventionValue('foodPerDay', Math.round(baseConfig.foodPerDay * .4)),
  }
}

export function applyExperimentPreset(preset: ExperimentPreset, draft: ExperimentDraft, baseConfig: Config): ExperimentDraft {
  const interventionGeneration = clamp(Math.round(draft.generations * .4), 1, draft.generations)
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
    interventionValue: normalizeInterventionValue('foodPerDay', Math.round(baseConfig.foodPerDay * .35)),
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
  const constraint = constraintFor(draft.interventionKey)
  const controlValue = normalizeInterventionValue(draft.interventionKey, baseConfig[draft.interventionKey])
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
