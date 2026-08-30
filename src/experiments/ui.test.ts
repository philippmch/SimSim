import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../simulation/config'
import {
  EXPERIMENT_PRESETS,
  EXPERIMENT_STUDY_SIZES,
  DEFAULT_EXPERIMENT_STUDY_SIZE,
  EXPERIMENT_METRIC_OPTIONS,
  INTERVENTION_CONSTRAINTS,
  applyExperimentPreset,
  applyExperimentStudySize,
  availableInterventionConstraints,
  buildExperimentPlan,
  defaultExperimentDraft,
  experimentCompletionMessage,
  experimentEarlyStopNote,
  experimentGenerationRunCount,
  experimentProgressIsCurrent,
  formatExperimentMetricValue,
  identifyExperimentStudySize,
  interventionGenerationFor,
  latestComparableAggregate,
  maximumExperimentGenerations,
  treatmentNoOpReason,
  inactiveInterventionReason,
  workerEventIsCurrent,
} from './ui'
import type { AggregatePoint } from './types'

const aggregateWithEffectCount = (generation: number, count: number): AggregatePoint => ({
  generation,
  metric: 'population',
  scenarioA: { count: 0, mean: null, median: null, q1: null, q3: null, interval: [null, null] },
  scenarioB: { count: 0, mean: null, median: null, q1: null, q3: null, interval: [null, null] },
  effect: { count, mean: count ? generation : null, median: count ? generation : null, q1: count ? generation : null, q3: count ? generation : null, interval: [count ? generation : null, count ? generation : null] },
})

describe('experiment lab UI helpers', () => {
  it('selects the latest comparable aggregate and preserves its effect sample size', () => {
    const selected = latestComparableAggregate([
      aggregateWithEffectCount(1, 4),
      aggregateWithEffectCount(2, 0),
      aggregateWithEffectCount(3, 2),
      aggregateWithEffectCount(4, 0),
    ])
    expect(selected?.generation).toBe(3)
    expect(selected?.effect.count).toBe(2)
  })

  it('returns no comparable aggregate when every effect is unavailable', () => {
    expect(latestComparableAggregate([aggregateWithEffectCount(1, 0), aggregateWithEffectCount(2, 0)])).toBeNull()
    expect(latestComparableAggregate([])).toBeNull()
  })

  it('uses the labeled exploratory workload as the responsive default', () => {
    const draft = defaultExperimentDraft(defaultConfig)
    expect(DEFAULT_EXPERIMENT_STUDY_SIZE).toBe('quick')
    expect(draft).toMatchObject({ replicates: 4, generations: 6, interventionGeneration: 2 })
    expect(experimentGenerationRunCount(draft.replicates, draft.generations)).toBe(48)
    expect(EXPERIMENT_STUDY_SIZES.map(option => [option.key, option.replicates, option.generations, experimentGenerationRunCount(option.replicates, option.generations)])).toEqual([
      ['quick', 4, 6, 48],
      ['standard', 6, 8, 96],
      ['deep', 10, 16, 320],
    ])
  })

  it('applies named study sizes and marks non-matching values custom', () => {
    const draft = defaultExperimentDraft(defaultConfig)
    expect(identifyExperimentStudySize(4, 6)).toBe('quick')
    expect(identifyExperimentStudySize(6, 8)).toBe('standard')
    expect(identifyExperimentStudySize(10, 16)).toBe('deep')
    expect(identifyExperimentStudySize(6, 7)).toBe('custom')
    expect(identifyExperimentStudySize(5, 8)).toBe('custom')
    expect(applyExperimentStudySize('quick', draft)).toMatchObject({ replicates: 4, generations: 6, interventionGeneration: 2 })
    expect(applyExperimentStudySize('standard', draft)).toMatchObject({ replicates: 6, generations: 8, interventionGeneration: 3 })
    expect(applyExperimentStudySize('deep', draft)).toMatchObject({ replicates: 10, generations: 16, interventionGeneration: 6 })
  })

  it('keeps treatment timing near forty percent and clamps it to the horizon', () => {
    expect(interventionGenerationFor(6)).toBe(2)
    expect(interventionGenerationFor(8)).toBe(3)
    expect(interventionGenerationFor(16)).toBe(6)
    expect(interventionGenerationFor(0)).toBe(1)
    expect(interventionGenerationFor(Number.NaN)).toBe(1)
    expect(interventionGenerationFor(2)).toBe(1)
    expect(interventionGenerationFor(3)).toBe(1)
    expect(interventionGenerationFor(1)).toBe(1)
  })

  it('explains early extinction without overstating completed work', () => {
    expect(experimentEarlyStopNote(96, 96)).toBeNull()
    expect(experimentCompletionMessage(96, 96)).toBe('Experiment complete.')
    expect(experimentEarlyStopNote(17, 96)).toBe('Only 17 of 96 planned generation-runs completed; extinct arms stopped early.')
    expect(experimentCompletionMessage(17, 96)).toBe('Experiment complete. Only 17 of 96 planned generation-runs completed; extinct arms stopped early.')
  })

  it('builds a bounded paired plan without mutating the live configuration', () => {
    const base = { ...defaultConfig }
    const before = { ...base }
    const draft = { ...defaultExperimentDraft(base), replicates: 40, generations: 50, interventionGeneration: 99, interventionValue: -999 }
    const plan = buildExperimentPlan(base, draft)
    expect(plan).toMatchObject({ replicates: 20, generations: 40, masterSeed: base.seed })
    expect(plan.replicates * plan.generations * 2).toBe(1_600)
    expect(plan.scenarioB.interventions?.[0]).toMatchObject({ generation: 40, changes: { foodPerDay: 0 } })
    expect(base).toEqual(before)
    expect(maximumExperimentGenerations(2)).toBe(40)
    expect(maximumExperimentGenerations(40)).toBe(40)
  })

  it('maps named presets to explicit constrained treatment fields', () => {
    const draft = defaultExperimentDraft(defaultConfig)
    expect(EXPERIMENT_PRESETS.map(item => item.label)).toEqual(['Drought', 'High movement cost', 'Predation pressure'])
    expect(applyExperimentPreset('drought', draft, defaultConfig)).toMatchObject({ interventionKey: 'foodPerDay', interventionValue: 0 })
    expect(applyExperimentPreset('movement', draft, defaultConfig)).toMatchObject({ interventionKey: 'moveEnergyFactor' })
    const predation = applyExperimentPreset('predation', draft, defaultConfig)
    expect(predation.interventionKey).toBe('predatorRatio')
    expect(predation.interventionValue).toBeGreaterThanOrEqual(1.01)
  })

  it('exposes v4 metrics and bounded continuous pressure fields without changing presets', () => {
    expect(EXPERIMENT_METRIC_OPTIONS.filter(option => ['avgEnergy', 'avgAge', 'aged', 'foodProduced', 'resourceAbundance', 'attackSuccessRate'].includes(option.key)).map(option => option.label)).toEqual([
      'Food produced', 'Resource abundance', 'Attack success rate', 'Age deaths', 'Average energy', 'Average age',
    ])
    expect(INTERVENTION_CONSTRAINTS.filter(item => ['foodRegrowthRate', 'attackCost', 'reactionTime', 'reproductionEnergyCost'].includes(item.key)).map(item => item.key)).toEqual([
      'foodRegrowthRate', 'attackCost', 'reactionTime', 'reproductionEnergyCost',
    ])
    expect(formatExperimentMetricValue(.375, 'attackSuccessRate')).toBe('37.5%')
    expect(formatExperimentMetricValue(null, 'attackSuccessRate')).toBe('—')
    expect(EXPERIMENT_PRESETS).toHaveLength(3)
  })

  it('blocks preset treatments that are identical at their pressure bounds', () => {
    const cases = [
      ['drought', { ...defaultConfig, foodPerDay: 0 }],
      ['movement', { ...defaultConfig, moveEnergyFactor: 3 }],
      ['predation', { ...defaultConfig, predatorRatio: 1.01 }],
    ] as const
    for (const [preset, base] of cases) {
      const draft = applyExperimentPreset(preset, defaultExperimentDraft(base), base)
      expect(treatmentNoOpReason(base, draft)).toMatch(/identical to the control/)
    }
    expect(treatmentNoOpReason(defaultConfig, applyExperimentPreset('drought', defaultExperimentDraft(defaultConfig), defaultConfig))).toBeNull()
    expect(treatmentNoOpReason(defaultConfig, applyExperimentPreset('movement', defaultExperimentDraft(defaultConfig), defaultConfig))).toBeNull()
    expect(treatmentNoOpReason(defaultConfig, applyExperimentPreset('predation', defaultExperimentDraft(defaultConfig), defaultConfig))).toBeNull()
  })

  it('filters mode-inactive pressures and explains defensive no-ops',()=>{
    const classic={...defaultConfig,ecologyMode:'classic' as const,perceptionMode:'perfect' as const,predationMode:'threshold' as const}
    const keys=availableInterventionConstraints(classic).map(item=>item.key)
    expect(keys).not.toContain('foodRegrowthRate');expect(keys).not.toContain('reproductionEnergyCost');expect(keys).not.toContain('attackCost');expect(keys).not.toContain('reactionTime')
    expect(availableInterventionConstraints(defaultConfig).map(item=>item.key)).toEqual(expect.arrayContaining(['foodRegrowthRate','reproductionEnergyCost','attackCost','reactionTime']))
    expect(inactiveInterventionReason(classic,'attackCost')).toMatch(/inactive with size-threshold predation/)
    expect(treatmentNoOpReason(classic,{...defaultExperimentDraft(classic),interventionKey:'reactionTime',interventionValue:1})).toMatch(/inactive with perfect perception/)
    expect(EXPERIMENT_PRESETS).toHaveLength(3)
  })

  it('gates worker messages by the active run id', () => {
    expect(workerEventIsCurrent('run-2', 'run-2')).toBe(true)
    expect(workerEventIsCurrent('run-1', 'run-2')).toBe(false)
    expect(workerEventIsCurrent('run-2', null)).toBe(false)
    expect(experimentProgressIsCurrent('run-2', 'run-2', false)).toBe(true)
    expect(experimentProgressIsCurrent('run-2', 'run-2', true)).toBe(false)
  })
})
