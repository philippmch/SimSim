import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../simulation/config'
import type { ExperimentResult, GenerationResult, ReplicateResult, SettlementEvidence } from '../experiments/types'
import { ExperimentSettlementEvidence, experimentReplayConfig, selectedExperimentReplaySeed } from './ExperimentSettlementEvidence'

const evidence = (generation: number, overrides: Partial<SettlementEvidence> = {}): SettlementEvidence => ({
  generation,
  startPopulation: 10,
  outcomes: { survived: 5, hunted: 1, energy: 1, unfed: 1, late: 1, aged: 1 },
  birthsEligible: 3,
  birthsAdmitted: 2,
  birthsCapped: 1,
  birthsImmature: 1,
  ...overrides,
})

const generation = (number: number, value: number, settlementEvidence?: SettlementEvidence): GenerationResult => ({
  generation: number,
  metrics: { avgSpeed: value },
  appliedInterventionIds: [],
  ...(settlementEvidence === undefined ? {} : { settlementEvidence }),
})

const aggregate = (generationNumber: number, count: number) => ({
  generation: generationNumber,
  metric: 'avgSpeed' as const,
  scenarioA: { count, mean: 1, median: 1, q1: 1, q3: 1, interval: [1, 1] as const },
  scenarioB: { count, mean: 2, median: 2, q1: 2, q3: 2, interval: [2, 2] as const },
  effect: { count, mean: 1, median: 1, q1: 1, q3: 1, interval: [1, 1] as const },
})

const replicate = (index: number, delta: number, options: { legacy?: boolean; malformed?: boolean } = {}): ReplicateResult => {
  const controlEvidence = options.legacy
    ? undefined
    : options.malformed
      ? ({ ...evidence(2), startPopulation: 'ten' } as unknown as SettlementEvidence)
      : evidence(2)
  const treatmentEvidence = options.legacy ? undefined : evidence(2)
  return {
    replicate: index,
    pairedSeed: 100 + index,
    scenarioA: { scenarioId: 'control', scenarioLabel: 'Control arm', replaySeed: 100 + index, extinct: false, completedGenerations: 2, generations: [generation(1, 1), generation(2, 1, controlEvidence)] },
    scenarioB: { scenarioId: 'treatment', scenarioLabel: 'Treatment arm', replaySeed: 100 + index, extinct: false, completedGenerations: 2, generations: [generation(1, 1), generation(2, 1 + delta, treatmentEvidence)] },
    pairedDeltas: [{ generation: 1, metrics: { avgSpeed: 0 } }, { generation: 2, metrics: { avgSpeed: delta } }],
  }
}

const result = (replicates: readonly ReplicateResult[] = [replicate(0, 1)]): ExperimentResult => ({
  schemaVersion: 1,
  plan: {
    id: 'evidence-test',
    label: 'Evidence test',
    masterSeed: 7,
    replicates: replicates.length,
    generations: 2,
    baseConfig: { ...defaultConfig, initialPopulation: 10 },
    scenarioA: { id: 'control', label: 'Control arm' },
    scenarioB: { id: 'treatment', label: 'Treatment arm', interventions: [{ id: 'pressure', generation: 2, changes: { foodPerDay: 4 } }] },
    metrics: ['avgSpeed'],
  },
  replicates,
  aggregates: [aggregate(1, replicates.length), aggregate(2, replicates.filter(item => item.pairedDeltas.some(delta => typeof delta.metrics.avgSpeed === 'number')).length)],
  completedGenerationRuns: replicates.length * 4,
})

const renderEvidence = (input: ExperimentResult, replicateIndex = 0) => renderToStaticMarkup(createElement(ExperimentSettlementEvidence, {
  result: input,
  metric: 'avgSpeed',
  replicateIndex,
  onReplicateChange: vi.fn(),
  onReplay: vi.fn(),
}))

describe('ExperimentSettlementEvidence', () => {
  it('shows population accounting even when the selected metric is not population', () => {
    const markup = renderEvidence(result())
    expect(markup).toContain('What changed?')
    expect(markup).toContain('Population accounting')
    expect(markup).toContain('10 creatures evaluated → 5 survived + 2 admitted births = 7 creatures in the next population')
    expect(markup).toContain('Control arm')
    expect(markup).toContain('Treatment arm')
  })

  it('uses audited settlement formatters for exact reconciliation, losses, maturity, and cap evidence', () => {
    const markup = renderEvidence(result())
    expect(markup).toContain('Total losses: 5 · Hunted: 1 · Energy depleted: 1 · No food at settlement: 1 · Missed return deadline: 1 · Old age: 1')
    expect(markup).toContain('3 mature + energy-eligible')
    expect(markup).toContain('1 waiting for maturity')
    expect(markup).toContain('1 at or below energy cost')
    expect(markup).toContain('→ births · 2 admitted · 1 capped')
    expect(markup).toContain('For this one matched seed at Generation 2, treatment − control next population = 0 creatures, decomposed as 0 survivors plus 0 admitted births.')
    expect(markup).not.toContain('aria-live')
  })

  it('chooses the latest generation with valid evidence in both arms', () => {
    const base = replicate(0, 1)
    const laterMalformed = ({ ...evidence(2), startPopulation: 'ten' } as unknown as SettlementEvidence)
    const input = result([{
      ...base,
      scenarioA: { ...base.scenarioA, generations: [generation(1, 1, evidence(1)), generation(2, 1, evidence(2))] },
      scenarioB: { ...base.scenarioB, generations: [generation(1, 1, evidence(1)), generation(2, 2, laterMalformed)] },
    }])
    const markup = renderEvidence(input)
    expect(markup).toContain('Generation 1 → 2')
    expect(markup).not.toContain('Generation 2 → 3')
  })

  it('does not let partial loss or reproduction telemetry displace an older complete pair', () => {
    const base = replicate(0, 1)
    const badLoss = { ...evidence(2), outcomes: { ...evidence(2).outcomes, hunted: 'unknown' } } as unknown as SettlementEvidence
    const badReproduction = { ...evidence(2), birthsEligible: 99 } as SettlementEvidence
    const input = result([{
      ...base,
      scenarioA: { ...base.scenarioA, generations: [generation(1, 1, evidence(1)), generation(2, 1, badLoss)] },
      scenarioB: { ...base.scenarioB, generations: [generation(1, 1, evidence(1)), generation(2, 2, badReproduction)] },
    }])
    const markup = renderEvidence(input)
    expect(markup).toContain('Generation 1 → 2')
    expect(markup).not.toContain('Generation 2 → 3')
  })

  it('counts finite treatment higher, lower, and unchanged contrasts at the latest comparable generation', () => {
    const markup = renderEvidence(result([replicate(0, 2), replicate(1, -1), replicate(2, 0)]))
    expect(markup).toContain('Generation 2, treatment was higher in 1, lower in 1, and unchanged in 1 of 3 finite matched-seed Average speed contrasts.')
    expect(markup).toContain('The arms first diverge at Generation 2.')
    expect(markup).toContain('within-model matched-seed contrast and descriptive evidence, not proof beyond the simulated treatment')
    expect(markup).toContain('matched seeds do not imply identical starting populations')
  })

  it('reports the first effective divergence for scenario setup differences', () => {
    const input = result()
    const scenarioDifference = {
      ...input,
      plan: { ...input.plan, scenarioB: { ...input.plan.scenarioB, config: { foodPerDay: 4 }, interventions: [] } },
    }
    expect(renderEvidence(scenarioDifference)).toContain('The arms first diverge at Generation 1.')
  })

  it('counts a control-arm intervention as divergence and ignores seed-only differences', () => {
    const input = result()
    const controlIntervention = {
      ...input,
      plan: {
        ...input.plan,
        scenarioA: { ...input.plan.scenarioA, config: { seed: 9001 }, interventions: [{ id: 'control-pressure', generation: 2, changes: { foodPerDay: 4 } }] },
        scenarioB: { ...input.plan.scenarioB, config: { seed: 9002 }, interventions: [] },
      },
    }
    expect(renderEvidence(controlIntervention)).toContain('The arms first diverge at Generation 2.')

    const equalArms = {
      ...input,
      plan: {
        ...input.plan,
        scenarioA: { ...input.plan.scenarioA, config: { seed: 9001 }, interventions: [{ id: 'control-pressure', generation: 2, changes: { foodPerDay: 4 } }] },
        scenarioB: { ...input.plan.scenarioB, config: { seed: 9002 }, interventions: [{ id: 'treatment-pressure', generation: 2, changes: { foodPerDay: 4 } }] },
      },
    }
    expect(renderEvidence(equalArms)).toContain('No effective arm divergence is recorded in this plan.')
  })

  it('keeps legacy missing evidence unavailable instead of inferring zeros', () => {
    const markup = renderEvidence(result([replicate(0, 1, { legacy: true })]))
    expect(markup).toContain('Population accounting unavailable for this selected matched seed')
    expect(markup).toContain('Legacy or malformed evidence is not treated as zero.')
    expect(markup).not.toContain('waiting for maturity')
  })

  it('keeps malformed evidence unavailable', () => {
    const markup = renderEvidence(result([replicate(0, 1, { malformed: true })]))
    expect(markup).toContain('Population accounting unavailable for this selected matched seed')
    expect(markup).not.toContain('10 creatures evaluated')
  })

  it('labels the selected seed and derives replay from that same control seed', () => {
    const input = result([replicate(0, 1), replicate(1, 0)])
    const replayInput = {
      ...input,
      plan: {
        ...input.plan,
        scenarioA: {
          ...input.plan.scenarioA,
          config: { foodPerDay: 8 },
          interventions: [{ id: 'control-pressure', generation: 2, changes: { foodPerDay: 4 } }],
        },
      },
    }
    const markup = renderEvidence(replayInput, 1)
    expect(markup).toContain('Matched seed')
    expect(markup).toContain('#2 · 101')
    expect(markup).toContain('Stage control setup + seed 101 for live replay')
    expect(markup).toContain('This stages the selected control setup + seed 101. Choose Apply &amp; restart to replay it live.')
    expect(markup).toContain('Scheduled control-arm interventions are experiment-only and are not staged.')
    expect(selectedExperimentReplaySeed(input, 1)).toBe(101)
    expect(experimentReplayConfig(replayInput, 1)).toMatchObject({ seed: 101, foodPerDay: 8 })
  })
})
