import { sanitizeConfig } from '../simulation/config'
import type { Config } from '../simulation/types'
import {
  SETTLEMENT_MATURITY_UNAVAILABLE,
  SETTLEMENT_REPRODUCTION_UNAVAILABLE,
  formatSettlementBirthCap,
  formatSettlementEquation,
  formatSettlementLosses,
  formatSettlementMaturityBreakdown,
  formatSettlementReproductionBreakdown,
  summarizeSettlementReport,
} from './SettlementReport'
import { applyInterventionsAtBoundary } from '../experiments/runner'
import type { ExperimentMetric, ExperimentResult, GenerationResult, ReplicateResult, Scenario } from '../experiments/types'
import { EXPERIMENT_METRIC_OPTIONS } from '../experiments/ui'

export interface ExperimentSettlementEvidenceProps {
  result: ExperimentResult
  metric: ExperimentMetric
  replicateIndex: number
  onReplicateChange: (replicateIndex: number) => void
  onReplay: (config: Config) => void
}

interface MatchedSettlement {
  generation: number
  control: NonNullable<ReturnType<typeof summarizeSettlementReport>>
  treatment: NonNullable<ReturnType<typeof summarizeSettlementReport>>
}

interface MetricConsistency {
  generation: number
  higher: number
  lower: number
  unchanged: number
  total: number
}

const metricLabel = (key: ExperimentMetric): string => EXPERIMENT_METRIC_OPTIONS.find(item => item.key === key)?.label ?? key

function finiteGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function selectedReplicate(result: ExperimentResult, replicateIndex: number): ReplicateResult | null {
  if (!Array.isArray(result.replicates) || !result.replicates.length) return null
  const index = Number.isSafeInteger(replicateIndex) ? Math.max(0, Math.min(result.replicates.length - 1, replicateIndex)) : 0
  return result.replicates[index] ?? null
}

/** Return the seed that the replay button must stage for the selected row. */
export function selectedExperimentReplaySeed(result: ExperimentResult, replicateIndex: number): number {
  const replicate = selectedReplicate(result, replicateIndex)
  return replicate?.pairedSeed ?? result.plan.masterSeed
}

/** Keep replay aligned with the visible matched-seed selector and control arm. */
export function experimentReplayConfig(result: ExperimentResult, replicateIndex: number): Config {
  const replicate = selectedReplicate(result, replicateIndex)
  const seed = replicate?.pairedSeed ?? result.plan.masterSeed
  return sanitizeConfig({ ...result.plan.baseConfig, ...(result.plan.scenarioA.config ?? {}), seed })
}

function effectiveConfigSeries(result: ExperimentResult, scenario: Scenario): Config[] {
  // The runner always replaces a scenario seed with the paired replicate seed.
  // Use the plan seed here because only non-seed divergence is being described.
  let config = sanitizeConfig({ ...result.plan.baseConfig, ...(scenario.config ?? {}), seed: result.plan.baseConfig.seed })
  const interventions = scenario.interventions ?? []
  const applied = new Set<string>()
  const series: Config[] = []
  const horizon = finiteGeneration(result.plan.generations) ? result.plan.generations : 0
  for (let generation = 1; generation <= horizon; generation++) {
    const application = applyInterventionsAtBoundary(config, interventions, generation, applied)
    config = application.config
    application.appliedIds.forEach(id => applied.add(id))
    series.push(config)
  }
  return series
}

function sameEffectiveConfig(control: Config, treatment: Config): boolean {
  for (const key of Object.keys(control) as (keyof Config)[]) {
    if (key !== 'seed' && control[key] !== treatment[key]) return false
  }
  return true
}

/** Find the first boundary where the two arms' effective setups actually differ. */
export function firstEffectiveArmDivergence(result: ExperimentResult): number | null {
  const control = effectiveConfigSeries(result, result.plan.scenarioA)
  const treatment = effectiveConfigSeries(result, result.plan.scenarioB)
  const horizon = Math.min(control.length, treatment.length)
  for (let index = 0; index < horizon; index++) {
    if (!sameEffectiveConfig(control[index], treatment[index])) return index + 1
  }
  return null
}

function hasCompleteSettlementAccounting(summary: NonNullable<ReturnType<typeof summarizeSettlementReport>>): boolean {
  const equation = formatSettlementEquation(summary)
  const losses = formatSettlementLosses(summary)
  const reproduction = formatSettlementReproductionBreakdown(summary)
  const birthCap = formatSettlementBirthCap(summary)
  const maturity = formatSettlementMaturityBreakdown(summary)
  const lossesComplete = summary.totalLosses !== null && !losses.includes('unavailable')
  const reproductionComplete = reproduction !== SETTLEMENT_REPRODUCTION_UNAVAILABLE && !reproduction.includes('unavailable')
  const capComplete = birthCap !== 'Birth-cap count unavailable'
  const maturityComplete = summary.maturityTelemetry !== 'invalid'
    && (summary.maturityTelemetry !== 'available' || maturity !== SETTLEMENT_MATURITY_UNAVAILABLE)
  return equation !== 'Settlement equation unavailable' && lossesComplete && reproductionComplete && capComplete && maturityComplete
}

function latestMatchedSettlement(replicate: ReplicateResult | null): MatchedSettlement | null {
  if (!replicate) return null
  const controlByGeneration = new Map<number, GenerationResult>()
  const treatmentByGeneration = new Map<number, GenerationResult>()
  for (const point of replicate.scenarioA.generations ?? []) {
    if (finiteGeneration(point.generation)) controlByGeneration.set(point.generation, point)
  }
  for (const point of replicate.scenarioB.generations ?? []) {
    if (finiteGeneration(point.generation)) treatmentByGeneration.set(point.generation, point)
  }
  const commonGenerations = [...controlByGeneration.keys()]
    .filter(generation => treatmentByGeneration.has(generation))
    .sort((a, b) => b - a)
  for (const generation of commonGenerations) {
    const controlPoint = controlByGeneration.get(generation)
    const treatmentPoint = treatmentByGeneration.get(generation)
    const control = summarizeSettlementReport(controlPoint?.settlementEvidence)
    const treatment = summarizeSettlementReport(treatmentPoint?.settlementEvidence)
    if (control?.generation === generation && treatment?.generation === generation
      && hasCompleteSettlementAccounting(control) && hasCompleteSettlementAccounting(treatment)) return { generation, control, treatment }
  }
  return null
}

function metricConsistency(result: ExperimentResult, metric: ExperimentMetric): MetricConsistency | null {
  const aggregates = (result.aggregates ?? []).filter(point => point.metric === metric)
  for (let index = aggregates.length - 1; index >= 0; index--) {
    const generation = aggregates[index].generation
    if (!finiteGeneration(generation)) continue
    const deltas = (result.replicates ?? []).flatMap(replicate => replicate.pairedDeltas ?? [])
      .filter(point => point.generation === generation)
      .map(point => point.metrics[metric])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    if (!deltas.length) continue
    return {
      generation,
      higher: deltas.filter(value => value > 0).length,
      lower: deltas.filter(value => value < 0).length,
      unchanged: deltas.filter(value => value === 0).length,
      total: deltas.length,
    }
  }
  return null
}

function signed(value: number): string {
  if (!Number.isSafeInteger(value)) return 'unavailable'
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'
}

function populationDifference(settlement: MatchedSettlement): string | null {
  if (!settlement.control || !settlement.treatment) return null
  const survivorDifference = settlement.treatment.survivors - settlement.control.survivors
  const birthDifference = settlement.treatment.admittedBirths - settlement.control.admittedBirths
  const nextDifference = settlement.treatment.exactNextPopulation - settlement.control.exactNextPopulation
  if (![survivorDifference, birthDifference, nextDifference].every(Number.isSafeInteger)) return null
  if (survivorDifference + birthDifference !== nextDifference) return null
  return `For this one matched seed at Generation ${settlement.generation}, treatment − control next population = ${signed(nextDifference)} creature${Math.abs(nextDifference) === 1 ? '' : 's'}, decomposed as ${signed(survivorDifference)} survivors plus ${signed(birthDifference)} admitted births. This is exact within-seed accounting, not aggregate causal proof.`
}

function consistencySentence(result: ExperimentResult, metric: ExperimentMetric): string {
  const consistency = metricConsistency(result, metric)
  if (!consistency) return `No finite matched-seed deltas are available for ${metricLabel(metric)}. This panel reports descriptive evidence only; it is not proof beyond the simulated treatment.`
  const divergence = firstEffectiveArmDivergence(result)
  const divergenceText = divergence === null ? ' No effective arm divergence is recorded in this plan.' : ` The arms first diverge at Generation ${divergence}.`
  return `At the latest comparable aggregate, Generation ${consistency.generation}, treatment was higher in ${consistency.higher}, lower in ${consistency.lower}, and unchanged in ${consistency.unchanged} of ${consistency.total} finite matched-seed ${metricLabel(metric)} contrasts.${divergenceText} This is a within-model matched-seed contrast and descriptive evidence, not proof beyond the simulated treatment; matched seeds do not imply identical starting populations.`
}

const copyStyle = { margin: '6px 0 0', color: 'var(--muted)', fontSize: 11, lineHeight: 1.45, overflowWrap: 'anywhere' } as const
const sectionStyle = { marginTop: 16, padding: '12px 0 0', borderTop: '1px solid var(--line)' } as const
const seedControlsStyle = { marginTop: 10 } as const
const cardTextStyle = { margin: '6px 0 0', color: 'var(--muted)', fontSize: 10, lineHeight: 1.45, overflowWrap: 'anywhere' } as const

function SettlementCard({ label, scenarioLabel, summary }: { label: 'Control' | 'Treatment'; scenarioLabel: string; summary: NonNullable<MatchedSettlement['control']> }) {
  const showScenarioLabel = scenarioLabel.trim().toLowerCase() !== label.toLowerCase()
  return <div style={{ overflowWrap: 'anywhere' }}>
    <strong>{label}</strong>
    {showScenarioLabel && <span>{scenarioLabel}</span>}
    <h5 style={{ margin: '9px 0 0', fontSize: 11 }}>Generation {summary.generation} → {summary.nextGeneration}</h5>
    <p style={cardTextStyle}>{formatSettlementEquation(summary)}</p>
    <p style={cardTextStyle}>{formatSettlementLosses(summary)}</p>
    <p style={cardTextStyle}>{formatSettlementReproductionBreakdown(summary)}</p>
  </div>
}

export function ExperimentSettlementEvidence({ result, metric, replicateIndex, onReplicateChange, onReplay }: ExperimentSettlementEvidenceProps) {
  const replicate = selectedReplicate(result, replicateIndex)
  const selectedIndex = replicate ? (result.replicates ?? []).indexOf(replicate) : 0
  const seed = selectedExperimentReplaySeed(result, selectedIndex)
  const matchedSettlement = latestMatchedSettlement(replicate)
  const difference = matchedSettlement ? populationDifference(matchedSettlement) : null
  const controlInterventions = result.plan.scenarioA.interventions ?? []
  return <section aria-labelledby="experiment-accounting-title" style={sectionStyle}>
    <h4 id="experiment-accounting-title" style={{ margin: 0, fontSize: 14 }}>What changed?</h4>
    <p style={copyStyle}>{consistencySentence(result, metric)}</p>
    <div className="experiment-result-actions" style={seedControlsStyle}>
      <label>Matched seed<select aria-label="Select matched seed for population accounting and replay" value={selectedIndex} onChange={event => onReplicateChange(Number(event.currentTarget.value))}>{(result.replicates ?? []).map((item, index) => <option key={`${item.replicate}-${index}`} value={index}>#{index + 1} · {item.pairedSeed}</option>)}</select></label>
      <button type="button" className="experiment-replay" disabled={!replicate} onClick={() => onReplay(experimentReplayConfig(result, selectedIndex))}>Stage control setup + seed {seed} for live replay</button>
    </div>
    <p style={cardTextStyle}>This stages the selected control setup + seed {seed}. Choose Apply &amp; restart to replay it live.{controlInterventions.length ? ' Scheduled control-arm interventions are experiment-only and are not staged.' : ''}</p>
    <h5 style={{ margin: '13px 0 0', fontSize: 12 }}>Population accounting</h5>
    <p style={copyStyle}>Selected matched seed #{replicate ? selectedIndex + 1 : '—'} · {replicate ? replicate.pairedSeed : 'unavailable'}. The latest generation with valid settlement evidence in both arms is shown below.</p>
    {matchedSettlement ? <>
      <div className="scenario-summary" aria-label={`Population accounting for matched seed ${seed}`}>
        <SettlementCard label="Control" scenarioLabel={result.plan.scenarioA.label} summary={matchedSettlement.control!}/>
        <SettlementCard label="Treatment" scenarioLabel={result.plan.scenarioB.label} summary={matchedSettlement.treatment!}/>
      </div>
      <p style={{ ...copyStyle, color: 'var(--ink)' }}>{difference ?? 'Exact next-population difference unavailable for this matched seed.'}</p>
    </> : <p style={{ ...copyStyle, color: 'var(--muted)' }}>Population accounting unavailable for this selected matched seed: both arms need a valid retained settlement record. Legacy or malformed evidence is not treated as zero.</p>}
  </section>
}

export default ExperimentSettlementEvidence
