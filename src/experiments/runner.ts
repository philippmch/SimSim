import { createWorld, getStats, runGeneration } from '../simulation/engine'
import { sanitizeConfig } from '../simulation/config'
import type { Config, World } from '../simulation/types'
import {
  EXPERIMENT_METRICS,
  INTERVENTION_CONFIG_KEYS,
  type AggregatePoint,
  type ArmResult,
  type DistributionSummary,
  type ExperimentMetric,
  type ExperimentPlan,
  type ExperimentProgress,
  type ExperimentResult,
  type GenerationIntervention,
  type GenerationResult,
  type MetricValues,
  type PairedGenerationDelta,
  type ReplicateResult,
  type RunExperimentOptions,
  type Scenario,
  type SettlementEvidence,
} from './types'

export const MAX_GENERATION_RUNS = 2_000
const MAX_SEED = 9_999_999
const METRIC_SET = new Set<string>(EXPERIMENT_METRICS)
const INTERVENTION_KEY_SET = new Set<string>(INTERVENTION_CONFIG_KEYS)
export class ExperimentCancelledError extends Error {
  constructor(public readonly completedGenerationRuns: number) {
    super('Experiment cancelled')
    this.name = 'ExperimentCancelledError'
  }
}

/** A stable integer mixer. It never reads or changes a World RNG state. */
export function derivePairedSeed(masterSeed: number, replicateIndex: number): number {
  let x = ((Number.isFinite(masterSeed) ? Math.trunc(masterSeed) : 1) ^ Math.imul(replicateIndex + 1, 0x9e3779b1)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) % MAX_SEED + 1
}

export function validateExperimentPlan(plan: ExperimentPlan): void {
  if (!plan || typeof plan !== 'object') throw new TypeError('Experiment plan is required')
  if (!plan.id.trim()) throw new RangeError('Experiment id is required')
  if (!Number.isInteger(plan.replicates) || plan.replicates < 1) throw new RangeError('Replicates must be a positive integer')
  if (!Number.isInteger(plan.generations) || plan.generations < 1) throw new RangeError('Generations must be a positive integer')
  const planned = plan.replicates * plan.generations * 2
  if (!Number.isSafeInteger(planned) || planned > MAX_GENERATION_RUNS) {
    throw new RangeError('Experiment exceeds the 2,000 generation-run limit')
  }
  if (!Number.isFinite(plan.masterSeed)) throw new RangeError('Master seed must be finite')
  if (!plan.metrics.length) throw new RangeError('Select at least one metric')
  const metrics = new Set<string>()
  for (const metric of plan.metrics) {
    if (!METRIC_SET.has(metric)) throw new RangeError(`Unsupported metric: ${metric}`)
    if (metrics.has(metric)) throw new RangeError(`Duplicate metric: ${metric}`)
    metrics.add(metric)
  }
  validateScenario(plan.scenarioA, plan.generations)
  validateScenario(plan.scenarioB, plan.generations)
  if (plan.scenarioA.id === plan.scenarioB.id) throw new RangeError('Scenario ids must differ')
}

function validateScenario(scenario: Scenario, generations: number): void {
  if (!scenario.id.trim()) throw new RangeError('Scenario id is required')
  const ids = new Set<string>()
  for (const intervention of scenario.interventions ?? []) {
    if (!intervention.id.trim()) throw new RangeError(`Intervention id is required in ${scenario.id}`)
    if (ids.has(intervention.id)) throw new RangeError(`Duplicate intervention id: ${intervention.id}`)
    ids.add(intervention.id)
    if (!Number.isInteger(intervention.generation) || intervention.generation < 1 || intervention.generation > generations) {
      throw new RangeError(`Intervention ${intervention.id} is outside the experiment horizon`)
    }
    for (const [key, value] of Object.entries(intervention.changes)) {
      if (!INTERVENTION_KEY_SET.has(key)) throw new RangeError(`Unsupported intervention key: ${key}`)
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`Intervention ${intervention.id}.${key} must be finite`)
    }
  }
}

export interface InterventionApplication {
  config: Config
  appliedIds: readonly string[]
}

/**
 * Applies each intervention scheduled for this one-based boundary exactly once.
 * Both the input configuration and the intervention list remain untouched.
 */
export function applyInterventionsAtBoundary(
  config: Config,
  interventions: readonly GenerationIntervention[],
  generation: number,
  alreadyApplied: ReadonlySet<string> = new Set(),
): InterventionApplication {
  const scheduled = interventions.filter(item => item.generation === generation && !alreadyApplied.has(item.id))
  if (!scheduled.length) return { config, appliedIds: [] }
  const patch: Partial<Config> = {}
  for (const intervention of scheduled) {
    for (const key of INTERVENTION_CONFIG_KEYS) {
      const value = intervention.changes[key]
      if (value !== undefined) (patch as Record<string, number>)[key] = value
    }
  }
  return {
    config: sanitizeConfig({ ...config, ...patch }),
    appliedIds: scheduled.map(item => item.id),
  }
}

function metricValues(world: World, metrics: readonly ExperimentMetric[]): MetricValues {
  const stats = getStats(world)
  const ledger = world.ledger.at(-1)
  const values: MetricValues = {}
  for (const metric of metrics) {
    switch (metric) {
      case 'population': values[metric] = stats.population; break
      case 'avgSpeed': values[metric] = stats.population ? stats.avgSpeed : null; break
      case 'avgSize': values[metric] = stats.population ? stats.avgSize : null; break
      case 'avgSense': values[metric] = stats.population ? stats.avgSense : null; break
      case 'avgAggression': values[metric] = stats.population ? stats.avgAggression : null; break
      case 'avgCaution': values[metric] = stats.population ? stats.avgCaution : null; break
      case 'avgExploration': values[metric] = stats.population ? stats.avgExploration : null; break
      case 'avgEnergy': values[metric] = stats.population ? stats.avgEnergy : null; break
      case 'avgAge': values[metric] = stats.population ? stats.avgAge : null; break
      case 'survivalRate': values[metric] = ledger && ledger.startPopulation ? ledger.outcomes.survived / ledger.startPopulation : 0; break
      case 'births': values[metric] = ledger?.birthsAdmitted ?? 0; break
      case 'hunted': values[metric] = ledger?.outcomes.hunted ?? 0; break
      case 'energyDeaths': values[metric] = ledger?.outcomes.energy ?? 0; break
      case 'unfed': values[metric] = ledger?.outcomes.unfed ?? 0; break
      case 'late': values[metric] = ledger?.outcomes.late ?? 0; break
      case 'aged': values[metric] = ledger?.outcomes.aged ?? 0; break
      case 'foodAtStart': values[metric] = ledger?.foodAtStart ?? 0; break
      case 'foodProduced': values[metric] = ledger?.foodProduced ?? 0; break
      case 'foodConsumed': values[metric] = ledger?.foodConsumed ?? 0; break
      case 'resourceAbundance': values[metric] = ledger?.foodRemaining ?? 0; break
      case 'preyConsumed': values[metric] = ledger?.preyConsumed ?? 0; break
      case 'attackSuccessRate': values[metric] = ledger?.attackAttempts ? ledger.attackSuccesses / ledger.attackAttempts : null; break
    }
  }
  return values
}

/**
 * Copy the authoritative ledger entry produced by the just-completed
 * generation.  Experiment results must not retain references into a mutable
 * World, and the optional maturity field must remain distinguishable from a
 * legacy ledger that never had that field.
 */
function snapshotSettlementEvidence(world: World, generation: number): SettlementEvidence {
  const ledger = world.ledger.at(-1)
  if (!ledger || ledger.generation !== generation) {
    throw new Error(`Generation ${generation} did not produce an authoritative settlement ledger`)
  }
  const evidence: SettlementEvidence = {
    generation: ledger.generation,
    startPopulation: ledger.startPopulation,
    outcomes: {
      survived: ledger.outcomes.survived,
      hunted: ledger.outcomes.hunted,
      energy: ledger.outcomes.energy,
      unfed: ledger.outcomes.unfed,
      late: ledger.outcomes.late,
      aged: ledger.outcomes.aged,
    },
    birthsEligible: ledger.birthsEligible,
    birthsAdmitted: ledger.birthsAdmitted,
    birthsCapped: ledger.birthsCapped,
  }
  if (Object.hasOwn(ledger, 'birthsImmature')) evidence.birthsImmature = ledger.birthsImmature
  return evidence
}

function createScenarioConfig(baseConfig: Config, scenario: Scenario, seed: number): Config {
  return sanitizeConfig({ ...baseConfig, ...(scenario.config ?? {}), seed })
}

interface RunState {
  completed: number
  planned: number
  sinceYield: number
}

const hostYield = () => new Promise<void>(resolve => setTimeout(resolve, 0))

async function checkpoint(
  state: RunState,
  options: RunExperimentOptions,
  progress: Omit<ExperimentProgress, 'completedGenerationRuns' | 'plannedGenerationRuns'>,
): Promise<void> {
  state.completed++
  state.sinceYield++
  options.onProgress?.({ ...progress, completedGenerationRuns: state.completed, plannedGenerationRuns: state.planned })
  if (options.signal?.aborted) throw new ExperimentCancelledError(state.completed)
  const yieldEvery = Math.max(1, Math.min(16, Math.trunc(options.yieldEvery ?? 4)))
  if (state.sinceYield >= yieldEvery) {
    state.sinceYield = 0
    await hostYield()
    if (options.signal?.aborted) throw new ExperimentCancelledError(state.completed)
  }
}

async function runArm(
  plan: ExperimentPlan,
  scenario: Scenario,
  seed: number,
  replicate: number,
  state: RunState,
  options: RunExperimentOptions,
): Promise<ArmResult> {
  let config = createScenarioConfig(plan.baseConfig, scenario, seed)
  const interventions = scenario.interventions ?? []
  const applied = new Set<string>()
  const generations: GenerationResult[] = []

  // Generation-one interventions must affect initial food/environment creation.
  const initialApplication = applyInterventionsAtBoundary(config, interventions, 1, applied)
  config = initialApplication.config
  initialApplication.appliedIds.forEach(id => applied.add(id))
  const world = createWorld(config)
  let appliedNow = initialApplication.appliedIds

  for (let index = 0; index < plan.generations; index++) {
    if (options.signal?.aborted) throw new ExperimentCancelledError(state.completed)
    const generation = index + 1
    const activeConfig = world.config
    const nextApplication = generation < plan.generations
      ? applyInterventionsAtBoundary(activeConfig, interventions, generation + 1, applied)
      : { config: activeConfig, appliedIds: [] }

    // Ticks and settlement retain the current configuration. The engine uses
    // the optional next configuration only for generation-boundary targets and
    // the classic next-generation food pulse.
    runGeneration(world, nextApplication.config)
    const settlementEvidence = snapshotSettlementEvidence(world, generation)
    generations.push({ generation, metrics: metricValues(world, plan.metrics), appliedInterventionIds: [...appliedNow], settlementEvidence })
    world.config = nextApplication.config
    nextApplication.appliedIds.forEach(id => applied.add(id))
    appliedNow = nextApplication.appliedIds
    await checkpoint(state, options, { replicate, scenarioId: scenario.id, generation })
    if (plan.stopOnExtinction && world.creatures.length === 0) break
  }

  return {
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
    replaySeed: seed,
    extinct: world.creatures.length === 0,
    completedGenerations: generations.length,
    generations,
  }
}

function pairedDeltas(a: ArmResult, b: ArmResult, metrics: readonly ExperimentMetric[]): PairedGenerationDelta[] {
  const aByGeneration = new Map(a.generations.map(point => [point.generation, point]))
  return b.generations.flatMap(pointB => {
    const pointA = aByGeneration.get(pointB.generation)
    if (!pointA) return []
    const values: MetricValues = {}
    for (const metric of metrics) {
      const av = pointA.metrics[metric]
      const bv = pointB.metrics[metric]
      // A paired effect is only defined when both arms observed this metric.
      // In particular, two unavailable values are not evidence of a zero
      // effect: they must stay unavailable so they do not enter aggregates.
      values[metric] = typeof av === 'number' && Number.isFinite(av)
        && typeof bv === 'number' && Number.isFinite(bv)
        ? (bv === av ? 0 : bv - av)
        : null
    }
    return [{ generation: pointB.generation, metrics: values }]
  })
}

export function quantile(values: readonly number[], probability: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const position = Math.max(0, Math.min(1, probability)) * (sorted.length - 1)
  const lower = Math.floor(position)
  const fraction = position - lower
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction
}

export function summarizeDistribution(values: readonly number[]): DistributionSummary {
  if (!values.length) return { count: 0, mean: null, median: null, q1: null, q3: null, interval: [null, null] }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const q1 = quantile(values, .25)
  const q3 = quantile(values, .75)
  return { count: values.length, mean, median: quantile(values, .5), q1, q3, interval: [q1, q3] }
}

export function aggregateReplicates(
  replicates: readonly ReplicateResult[],
  generations: number,
  metrics: readonly ExperimentMetric[],
): AggregatePoint[] {
  const result: AggregatePoint[] = []
  for (let generation = 1; generation <= generations; generation++) {
    for (const metric of metrics) {
      const a: number[] = [], b: number[] = [], effects: number[] = []
      for (const replicate of replicates) {
        const av = replicate.scenarioA.generations.find(point => point.generation === generation)?.metrics[metric]
        const bv = replicate.scenarioB.generations.find(point => point.generation === generation)?.metrics[metric]
        const effect = replicate.pairedDeltas.find(point => point.generation === generation)?.metrics[metric]
        if (typeof av === 'number') a.push(av)
        if (typeof bv === 'number') b.push(bv)
        if (typeof effect === 'number') effects.push(effect)
      }
      result.push({
        generation,
        metric,
        scenarioA: summarizeDistribution(a),
        scenarioB: summarizeDistribution(b),
        effect: summarizeDistribution(effects),
      })
    }
  }
  return result
}

export async function runExperiment(plan: ExperimentPlan, options: RunExperimentOptions = {}): Promise<ExperimentResult> {
  validateExperimentPlan(plan)
  if (options.signal?.aborted) throw new ExperimentCancelledError(0)
  const state: RunState = { completed: 0, planned: plan.replicates * plan.generations * 2, sinceYield: 0 }
  const replicates: ReplicateResult[] = []

  for (let replicate = 0; replicate < plan.replicates; replicate++) {
    const seed = derivePairedSeed(plan.masterSeed, replicate)
    const scenarioA = await runArm(plan, plan.scenarioA, seed, replicate, state, options)
    const scenarioB = await runArm(plan, plan.scenarioB, seed, replicate, state, options)
    replicates.push({
      replicate,
      pairedSeed: seed,
      scenarioA,
      scenarioB,
      pairedDeltas: pairedDeltas(scenarioA, scenarioB, plan.metrics),
    })
  }

  return {
    schemaVersion: 1,
    plan: clonePlan(plan),
    replicates,
    aggregates: aggregateReplicates(replicates, plan.generations, plan.metrics),
    completedGenerationRuns: state.completed,
  }
}

function clonePlan(plan: ExperimentPlan): ExperimentPlan {
  return {
    ...plan,
    baseConfig: { ...plan.baseConfig },
    metrics: [...plan.metrics],
    scenarioA: cloneScenario(plan.scenarioA),
    scenarioB: cloneScenario(plan.scenarioB),
  }
}

function cloneScenario(scenario: Scenario): Scenario {
  return {
    ...scenario,
    config: scenario.config ? { ...scenario.config } : undefined,
    interventions: scenario.interventions?.map(item => ({ ...item, changes: { ...item.changes } })),
  }
}
