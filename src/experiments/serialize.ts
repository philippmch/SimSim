import { defaultConfig, LEGACY_V3_CONFIG_KEYS, sanitizeConfig, sanitizeLegacyConfig } from '../simulation/config'
import type { Config } from '../simulation/types'
import {
  EXPERIMENT_METRICS,
  INTERVENTION_CONFIG_KEYS,
  type ExperimentMetric,
  type ExperimentResult,
} from './types'

export const EXPERIMENT_EXPORT_VERSION = 1
export const MAX_EXPERIMENT_JSON_LENGTH = 5_000_000
const MAX_JSON_DEPTH = 64
const MAX_TEXT_LENGTH = 500
const MAX_GENERATION_RUNS = 2_000
const MAX_INTERVENTIONS = 2_000
const METRICS = new Set<string>(EXPERIMENT_METRICS)
const INTERVENTION_KEYS = new Set<string>(INTERVENTION_CONFIG_KEYS)
const CONFIG_KEYS = Object.keys(defaultConfig) as (keyof Config)[]
const CONFIG_KEY_SET = new Set<string>(CONFIG_KEYS)
const LEGACY_CONFIG_KEY_SET = new Set<string>(LEGACY_V3_CONFIG_KEYS)

export interface ExperimentExport {
  schema: 'evolution-field-lab/experiment-result'
  version: typeof EXPERIMENT_EXPORT_VERSION
  result: ExperimentResult
}

export function toExperimentJson(result: ExperimentResult, space = 2): string {
  const payload: ExperimentExport = {
    schema: 'evolution-field-lab/experiment-result',
    version: EXPERIMENT_EXPORT_VERSION,
    result,
  }
  return JSON.stringify(payload, null, space)
}

type RecordValue = Record<string, unknown>

function fail(message: string): never {
  throw new TypeError(`Invalid experiment export: ${message}`)
}

function record(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`)
  return value as RecordValue
}

function exactKeys(value: RecordValue, required: readonly string[], optional: readonly string[], path: string): void {
  const allowed = new Set([...required, ...optional])
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key} is required`)
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key} is unsupported`)
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`)
  if (value.length > max) fail(`${path} exceeds its item limit`)
  return value
}

function text(value: unknown, path: string, requireNonblank = false): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH || (requireNonblank && !value.trim())) {
    fail(`${path} must be a bounded${requireNonblank ? ', nonblank' : ''} string`)
  }
  return value
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} must be finite`)
  return value
}

function integer(value: unknown, path: string, min: number, max: number): number {
  const result = finite(value, path)
  if (!Number.isSafeInteger(result) || result < min || result > max) fail(`${path} must be an integer from ${min} to ${max}`)
  return result
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(`${path} must be boolean`)
  return value
}

function nullableFinite(value: unknown, path: string): number | null {
  return value === null ? null : finite(value, path)
}

function assertNesting(source: string): void {
  let depth = 0
  let inString = false
  let escaped = false
  for (const character of source) {
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{' || character === '[') {
      depth++
      if (depth > MAX_JSON_DEPTH) fail('JSON nesting is too deep')
    } else if (character === '}' || character === ']') depth--
  }
}

function validateConfig(value: unknown, path: string, partial = false): RecordValue {
  const config = record(value, path)
  const keys = Object.keys(config)
  const legacyFull = !partial && keys.length === LEGACY_V3_CONFIG_KEYS.length && keys.every(key => LEGACY_CONFIG_KEY_SET.has(key))
  if (partial) {
    for (const key of keys) if (!CONFIG_KEY_SET.has(key)) fail(`${path}.${key} is unsupported`)
  } else if (!legacyFull) {
    exactKeys(config, CONFIG_KEYS, [], path)
  } else {
    exactKeys(config, LEGACY_V3_CONFIG_KEYS, [], path)
  }
  const sanitized = legacyFull ? sanitizeLegacyConfig(config) : sanitizeConfig({ ...defaultConfig, ...config })
  for (const key of partial ? keys as (keyof Config)[] : legacyFull ? LEGACY_V3_CONFIG_KEYS : CONFIG_KEYS) {
    const raw = config[key]
    if (typeof defaultConfig[key] === 'boolean') {
      boolean(raw, `${path}.${key}`)
    } else if (typeof defaultConfig[key] === 'string') {
      text(raw, `${path}.${key}`, true)
      if (sanitized[key] !== raw) fail(`${path}.${key} is unsupported`)
    } else {
      finite(raw, `${path}.${key}`)
      if (sanitized[key] !== raw) fail(`${path}.${key} is outside the supported range`)
    }
  }
  return legacyFull ? sanitized as unknown as RecordValue : { ...config }
}

interface ValidatedScenario {
  id: string
  label: string
  interventions: Map<number, string[]>
}

function validateScenario(value: unknown, path: string, generations: number): ValidatedScenario {
  const scenario = record(value, path)
  exactKeys(scenario, ['id', 'label'], ['config', 'interventions'], path)
  const id = text(scenario.id, `${path}.id`, true)
  const label = text(scenario.label, `${path}.label`)
  if (scenario.config !== undefined) scenario.config=validateConfig(scenario.config, `${path}.config`, true)
  const interventions = new Map<number, string[]>()
  const seen = new Set<string>()
  for (const [index, raw] of array(scenario.interventions ?? [], `${path}.interventions`, MAX_INTERVENTIONS).entries()) {
    const itemPath = `${path}.interventions[${index}]`
    const item = record(raw, itemPath)
    exactKeys(item, ['id', 'generation', 'changes'], [], itemPath)
    const interventionId = text(item.id, `${itemPath}.id`, true)
    if (seen.has(interventionId)) fail(`${itemPath}.id is duplicated`)
    seen.add(interventionId)
    const generation = integer(item.generation, `${itemPath}.generation`, 1, generations)
    const changes = record(item.changes, `${itemPath}.changes`)
    for (const [key, rawValue] of Object.entries(changes)) {
      if (!INTERVENTION_KEYS.has(key)) fail(`${itemPath}.changes.${key} is unsupported`)
      finite(rawValue, `${itemPath}.changes.${key}`)
      const sanitized = sanitizeConfig({ ...defaultConfig, [key]: rawValue }) as unknown as RecordValue
      if (sanitized[key] !== rawValue) fail(`${itemPath}.changes.${key} is outside the supported range`)
    }
    interventions.set(generation, [...(interventions.get(generation) ?? []), interventionId])
  }
  return { id, label, interventions }
}

interface ValidatedPlan {
  id: string
  replicates: number
  generations: number
  metrics: ExperimentMetric[]
  scenarioA: ValidatedScenario
  scenarioB: ValidatedScenario
  stopOnExtinction: boolean
}

function validatePlan(value: unknown): ValidatedPlan {
  const path = 'result.plan'
  const plan = record(value, path)
  exactKeys(plan, ['id', 'label', 'masterSeed', 'replicates', 'generations', 'baseConfig', 'scenarioA', 'scenarioB', 'metrics'], ['stopOnExtinction'], path)
  const id = text(plan.id, `${path}.id`, true)
  text(plan.label, `${path}.label`)
  finite(plan.masterSeed, `${path}.masterSeed`)
  const replicates = integer(plan.replicates, `${path}.replicates`, 1, 1_000)
  const generations = integer(plan.generations, `${path}.generations`, 1, 1_000)
  if (replicates * generations * 2 > MAX_GENERATION_RUNS) fail(`${path} exceeds the generation-run limit`)
  plan.baseConfig=validateConfig(plan.baseConfig, `${path}.baseConfig`)
  const rawMetrics = array(plan.metrics, `${path}.metrics`, EXPERIMENT_METRICS.length)
  if (!rawMetrics.length) fail(`${path}.metrics must not be empty`)
  const metrics = rawMetrics.map((metric, index) => {
    if (typeof metric !== 'string' || !METRICS.has(metric)) fail(`${path}.metrics[${index}] is unsupported`)
    return metric as ExperimentMetric
  })
  if (new Set(metrics).size !== metrics.length) fail(`${path}.metrics contains duplicates`)
  const scenarioA = validateScenario(plan.scenarioA, `${path}.scenarioA`, generations)
  const scenarioB = validateScenario(plan.scenarioB, `${path}.scenarioB`, generations)
  if (scenarioA.id === scenarioB.id) fail(`${path} scenario ids must differ`)
  const stopOnExtinction = plan.stopOnExtinction === undefined ? false : boolean(plan.stopOnExtinction, `${path}.stopOnExtinction`)
  return { id, replicates, generations, metrics, scenarioA, scenarioB, stopOnExtinction }
}

function validateMetricValues(value: unknown, metrics: readonly ExperimentMetric[], path: string): void {
  const values = record(value, path)
  exactKeys(values, metrics, [], path)
  for (const metric of metrics) nullableFinite(values[metric], `${path}.${metric}`)
}

function validateGenerationRecord(
  value: unknown,
  path: string,
  generation: number,
  metrics: readonly ExperimentMetric[],
  expectedInterventions: readonly string[],
): void {
  const point = record(value, path)
  exactKeys(point, ['generation', 'metrics', 'appliedInterventionIds'], [], path)
  if (integer(point.generation, `${path}.generation`, 1, 1_000) !== generation) fail(`${path}.generation is out of sequence`)
  validateMetricValues(point.metrics, metrics, `${path}.metrics`)
  const ids = array(point.appliedInterventionIds, `${path}.appliedInterventionIds`, MAX_INTERVENTIONS)
  if (ids.length !== expectedInterventions.length) fail(`${path}.appliedInterventionIds does not match the plan`)
  ids.forEach((id, index) => {
    if (text(id, `${path}.appliedInterventionIds[${index}]`, true) !== expectedInterventions[index]) {
      fail(`${path}.appliedInterventionIds does not match the plan`)
    }
  })
}

function validateArm(
  value: unknown,
  path: string,
  plan: ValidatedPlan,
  scenario: ValidatedScenario,
  pairedSeed: number,
): number {
  const arm = record(value, path)
  exactKeys(arm, ['scenarioId', 'scenarioLabel', 'replaySeed', 'extinct', 'completedGenerations', 'generations'], [], path)
  if (text(arm.scenarioId, `${path}.scenarioId`, true) !== scenario.id) fail(`${path}.scenarioId does not match the plan`)
  if (text(arm.scenarioLabel, `${path}.scenarioLabel`) !== scenario.label) fail(`${path}.scenarioLabel does not match the plan`)
  if (integer(arm.replaySeed, `${path}.replaySeed`, 1, 9_999_999) !== pairedSeed) fail(`${path}.replaySeed is not paired`)
  boolean(arm.extinct, `${path}.extinct`)
  const completed = integer(arm.completedGenerations, `${path}.completedGenerations`, 1, plan.generations)
  const generations = array(arm.generations, `${path}.generations`, plan.generations)
  if (generations.length !== completed) fail(`${path}.completedGenerations does not match generations`)
  if (!plan.stopOnExtinction && completed !== plan.generations) fail(`${path} does not cover the fixed horizon`)
  generations.forEach((point, index) => validateGenerationRecord(
    point,
    `${path}.generations[${index}]`,
    index + 1,
    plan.metrics,
    scenario.interventions.get(index + 1) ?? [],
  ))
  return completed
}

function validatePairedDeltas(value: unknown, path: string, count: number, metrics: readonly ExperimentMetric[]): void {
  const points = array(value, path, count)
  if (points.length !== count) fail(`${path} does not match paired arm coverage`)
  points.forEach((raw, index) => {
    const pointPath = `${path}[${index}]`
    const point = record(raw, pointPath)
    exactKeys(point, ['generation', 'metrics'], [], pointPath)
    if (integer(point.generation, `${pointPath}.generation`, 1, count) !== index + 1) fail(`${pointPath}.generation is out of sequence`)
    validateMetricValues(point.metrics, metrics, `${pointPath}.metrics`)
  })
}

function validateDistribution(value: unknown, path: string, replicateLimit: number): void {
  const summary = record(value, path)
  exactKeys(summary, ['count', 'mean', 'median', 'q1', 'q3', 'interval'], [], path)
  const count = integer(summary.count, `${path}.count`, 0, replicateLimit)
  const mean = nullableFinite(summary.mean, `${path}.mean`)
  const median = nullableFinite(summary.median, `${path}.median`)
  const q1 = nullableFinite(summary.q1, `${path}.q1`)
  const q3 = nullableFinite(summary.q3, `${path}.q3`)
  const interval = array(summary.interval, `${path}.interval`, 2)
  if (interval.length !== 2) fail(`${path}.interval must contain two values`)
  const lower = nullableFinite(interval[0], `${path}.interval[0]`)
  const upper = nullableFinite(interval[1], `${path}.interval[1]`)
  if (count === 0) {
    if ([mean, median, q1, q3, lower, upper].some(item => item !== null)) fail(`${path} must be null when count is zero`)
  } else {
    if ([mean, median, q1, q3, lower, upper].some(item => item === null)) fail(`${path} cannot contain null when count is positive`)
    if ((q1 as number) > (median as number) || (median as number) > (q3 as number)) fail(`${path} quartiles are unordered`)
    if (lower !== q1 || upper !== q3) fail(`${path}.interval must equal q1 and q3`)
  }
}

function validateAggregates(value: unknown, plan: ValidatedPlan): void {
  const expected = plan.generations * plan.metrics.length
  const aggregates = array(value, 'result.aggregates', expected)
  if (aggregates.length !== expected) fail('result.aggregates does not cover every generation and metric')
  let index = 0
  for (let generation = 1; generation <= plan.generations; generation++) {
    for (const metric of plan.metrics) {
      const path = `result.aggregates[${index}]`
      const point = record(aggregates[index++], path)
      exactKeys(point, ['generation', 'metric', 'scenarioA', 'scenarioB', 'effect'], [], path)
      if (integer(point.generation, `${path}.generation`, 1, plan.generations) !== generation) fail(`${path}.generation is out of sequence`)
      if (point.metric !== metric) fail(`${path}.metric is out of sequence`)
      validateDistribution(point.scenarioA, `${path}.scenarioA`, plan.replicates)
      validateDistribution(point.scenarioB, `${path}.scenarioB`, plan.replicates)
      validateDistribution(point.effect, `${path}.effect`, plan.replicates)
    }
  }
}

function validateResult(value: unknown): void {
  const result = record(value, 'result')
  exactKeys(result, ['schemaVersion', 'plan', 'replicates', 'aggregates', 'completedGenerationRuns'], [], 'result')
  if (result.schemaVersion !== 1) fail('result.schemaVersion is unsupported')
  const plan = validatePlan(result.plan)
  const replicates = array(result.replicates, 'result.replicates', plan.replicates)
  if (replicates.length !== plan.replicates) fail('result.replicates does not match the plan')
  let completedRuns = 0
  replicates.forEach((raw, index) => {
    const path = `result.replicates[${index}]`
    const replicate = record(raw, path)
    exactKeys(replicate, ['replicate', 'pairedSeed', 'scenarioA', 'scenarioB', 'pairedDeltas'], [], path)
    if (integer(replicate.replicate, `${path}.replicate`, 0, plan.replicates - 1) !== index) fail(`${path}.replicate is out of sequence`)
    const seed = integer(replicate.pairedSeed, `${path}.pairedSeed`, 1, 9_999_999)
    const aCount = validateArm(replicate.scenarioA, `${path}.scenarioA`, plan, plan.scenarioA, seed)
    const bCount = validateArm(replicate.scenarioB, `${path}.scenarioB`, plan, plan.scenarioB, seed)
    validatePairedDeltas(replicate.pairedDeltas, `${path}.pairedDeltas`, Math.min(aCount, bCount), plan.metrics)
    completedRuns += aCount + bCount
  })
  if (integer(result.completedGenerationRuns, 'result.completedGenerationRuns', 0, MAX_GENERATION_RUNS) !== completedRuns) {
    fail('result.completedGenerationRuns does not match the replicate data')
  }
  validateAggregates(result.aggregates, plan)
}

export function fromExperimentJson(source: string): ExperimentExport {
  if (typeof source !== 'string' || source.length > MAX_EXPERIMENT_JSON_LENGTH) fail('source exceeds the size limit')
  assertNesting(source)
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    fail('source is not valid JSON')
  }
  const payload = record(value, 'export')
  exactKeys(payload, ['schema', 'version', 'result'], [], 'export')
  if (payload.schema !== 'evolution-field-lab/experiment-result') fail('schema is unsupported')
  if (payload.version !== EXPERIMENT_EXPORT_VERSION) fail('version is unsupported')
  validateResult(payload.result)
  return payload as unknown as ExperimentExport
}

function csvCell(value: string | number | null): string {
  if (value === null) return ''
  let text = String(value)
  if (typeof value === 'string' && (/^[\t\r]/.test(value) || /^\s*[=+\-@]/.test(value))) text = `'${value}`
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * Produces one observation per row. Arm observations and paired B-A effects use
 * the same columns, which makes the file directly groupable in analysis tools.
 */
export function toTidyCsv(result: ExperimentResult): string {
  const header = ['schema_version', 'plan_id', 'replicate', 'paired_seed', 'kind', 'scenario_id', 'generation', 'metric', 'value']
  const rows: (string | number | null)[][] = [header]
  for (const replicate of result.replicates) {
    for (const arm of [replicate.scenarioA, replicate.scenarioB]) {
      for (const point of arm.generations) {
        for (const metric of result.plan.metrics) {
          rows.push([result.schemaVersion, result.plan.id, replicate.replicate, replicate.pairedSeed, 'arm', arm.scenarioId, point.generation, metric, point.metrics[metric] ?? null])
        }
      }
    }
    for (const point of replicate.pairedDeltas) {
      for (const metric of result.plan.metrics) {
        rows.push([result.schemaVersion, result.plan.id, replicate.replicate, replicate.pairedSeed, 'paired_delta', 'B-A', point.generation, metric, point.metrics[metric] ?? null])
      }
    }
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\n')
}

export function metricColumnOrder(result: ExperimentResult): readonly ExperimentMetric[] {
  return [...result.plan.metrics]
}
