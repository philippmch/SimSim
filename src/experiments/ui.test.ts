import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../simulation/config'
import {
  EXPERIMENT_PRESETS,
  EXPERIMENT_METRIC_OPTIONS,
  INTERVENTION_CONSTRAINTS,
  applyExperimentPreset,
  availableInterventionConstraints,
  buildExperimentPlan,
  defaultExperimentDraft,
  experimentProgressIsCurrent,
  formatExperimentMetricValue,
  maximumExperimentGenerations,
  treatmentNoOpReason,
  inactiveInterventionReason,
  workerEventIsCurrent,
} from './ui'

describe('experiment lab UI helpers', () => {
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
