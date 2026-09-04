import type { Config } from '../simulation/types'

/** Configuration pressures that may change during a running experiment. */
export const INTERVENTION_CONFIG_KEYS = [
  'foodPerDay',
  'seasonAmplitude',
  'seasonLength',
  'environmentResponse',
  'foodTrend',
  'moveEnergyFactor',
  'senseEnergyFactor',
  'predatorRatio',
  'foodRegrowthRate',
  'attackCost',
  'reactionTime',
  'reproductionEnergyCost',
] as const satisfies readonly (keyof Config)[]

export type InterventionConfigKey = (typeof INTERVENTION_CONFIG_KEYS)[number]
export type InterventionPatch = Partial<Pick<Config, InterventionConfigKey>>

export interface GenerationIntervention {
  /** Stable within a scenario. Duplicate ids are rejected. */
  id: string
  /** One-based generation at whose start the patch takes effect. */
  generation: number
  changes: InterventionPatch
}

export interface Scenario {
  id: string
  label: string
  /** Applied to a cloned base configuration before each replicate. */
  config?: Partial<Config>
  interventions?: readonly GenerationIntervention[]
}

export const EXPERIMENT_METRICS = [
  'population',
  'avgSpeed',
  'avgSize',
  'avgSense',
  'avgAggression',
  'avgCaution',
  'avgExploration',
  'avgEnergy',
  'avgAge',
  'survivalRate',
  'births',
  'hunted',
  'energyDeaths',
  'unfed',
  'late',
  'aged',
  'foodAtStart',
  'foodProduced',
  'foodConsumed',
  'resourceAbundance',
  'preyConsumed',
  'attackSuccessRate',
] as const

export type ExperimentMetric = (typeof EXPERIMENT_METRICS)[number]
export type MetricValues = Partial<Record<ExperimentMetric, number | null>>

export interface ExperimentPlan {
  id: string
  label: string
  masterSeed: number
  replicates: number
  generations: number
  baseConfig: Config
  scenarioA: Scenario
  scenarioB: Scenario
  metrics: readonly ExperimentMetric[]
  /** When true, each arm stops after it records the extinction generation. */
  stopOnExtinction?: boolean
}

/** Stable v1 outcome keys exported with every new runner settlement record. */
export const SETTLEMENT_OUTCOME_KEYS = ['survived', 'hunted', 'energy', 'unfed', 'late', 'aged'] as const
export type SettlementOutcomeKey = (typeof SETTLEMENT_OUTCOME_KEYS)[number]
export type SettlementOutcomeCounts = Record<SettlementOutcomeKey, number>

/**
 * The authoritative population accounting captured at a generation boundary.
 *
 * This deliberately contains only the settlement fields needed to explain the
 * cohort transition.  `birthsImmature` remains optional because older ledgers
 * were recorded before reproductive-maturity telemetry existed.
 */
export interface SettlementEvidence {
  generation: number
  startPopulation: number
  outcomes: SettlementOutcomeCounts
  birthsEligible: number
  birthsAdmitted: number
  birthsCapped: number
  birthsImmature?: number
}

export interface GenerationResult {
  generation: number
  metrics: MetricValues
  appliedInterventionIds: readonly string[]
  /** Optional for legacy/manual records; every generation emitted by the runner includes it. */
  settlementEvidence?: SettlementEvidence
}

export interface ArmResult {
  scenarioId: string
  scenarioLabel: string
  replaySeed: number
  extinct: boolean
  completedGenerations: number
  generations: readonly GenerationResult[]
}

export interface PairedGenerationDelta {
  generation: number
  /** Scenario B minus scenario A. Null means one side had no numeric value. */
  metrics: MetricValues
}

export interface ReplicateResult {
  replicate: number
  pairedSeed: number
  scenarioA: ArmResult
  scenarioB: ArmResult
  pairedDeltas: readonly PairedGenerationDelta[]
}

export interface DistributionSummary {
  count: number
  mean: number | null
  median: number | null
  q1: number | null
  q3: number | null
  /** Alias-friendly deterministic central 50% interval. */
  interval: readonly [number | null, number | null]
}

export interface AggregatePoint {
  generation: number
  metric: ExperimentMetric
  scenarioA: DistributionSummary
  scenarioB: DistributionSummary
  /** Paired scenario B minus scenario A effect. */
  effect: DistributionSummary
}

export interface ExperimentResult {
  schemaVersion: 1
  plan: ExperimentPlan
  replicates: readonly ReplicateResult[]
  aggregates: readonly AggregatePoint[]
  completedGenerationRuns: number
}

export interface ExperimentProgress {
  completedGenerationRuns: number
  plannedGenerationRuns: number
  replicate: number
  scenarioId: string
  generation: number
}

export interface RunExperimentOptions {
  signal?: AbortSignal
  onProgress?: (progress: ExperimentProgress) => void
  /** Number of generation runs before yielding to the browser. Defaults to 4. */
  yieldEvery?: number
}
