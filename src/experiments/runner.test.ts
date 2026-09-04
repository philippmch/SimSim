import { describe, expect, it } from 'vitest'
import { createWorld, defaultConfig, runGeneration as runWorldGeneration } from '../simulation/engine'
import { CLASSIC_MODES, V4_ONLY_CONFIG_KEYS, V5_ONLY_CONFIG_KEYS } from '../simulation/config'
import { SETTLEMENT_OUTCOME_KEYS, type ExperimentPlan, type ReplicateResult } from './types'
import {
  ExperimentCancelledError,
  aggregateReplicates,
  applyInterventionsAtBoundary,
  derivePairedSeed,
  runExperiment,
  validateExperimentPlan,
} from './runner'
import { fromExperimentJson, MAX_EXPERIMENT_JSON_LENGTH, toExperimentJson, toTidyCsv } from './serialize'
import { latestComparableAggregate } from './ui'

const plan = (overrides: Partial<ExperimentPlan> = {}): ExperimentPlan => ({
  id: 'paired-test',
  label: 'Paired test',
  masterSeed: 4729,
  replicates: 2,
  generations: 2,
  baseConfig: { ...defaultConfig, initialPopulation: 6, foodPerDay: 8, dayLength: 5 },
  scenarioA: { id: 'control', label: 'Control' },
  scenarioB: { id: 'treatment', label: 'Treatment' },
  metrics: ['population', 'avgSpeed', 'foodConsumed'],
  ...overrides,
})

describe('paired experiment runner', () => {
  it('derives exact stable paired seeds without collisions in a small sequence', () => {
    expect([0, 1, 2, 3].map(index => derivePairedSeed(4729, index))).toEqual([
      9606443,
      537144,
      532032,
      3404053,
    ])
    expect(new Set(Array.from({ length: 100 }, (_, index) => derivePairedSeed(4729, index))).size).toBe(100)
  })

  it('produces exact zero paired deltas for identical arms', async () => {
    const result = await runExperiment(plan())
    for (const replicate of result.replicates) {
      expect(replicate.scenarioA.replaySeed).toBe(replicate.scenarioB.replaySeed)
      expect(replicate.scenarioA.generations).toEqual(replicate.scenarioB.generations)
      for (const point of replicate.pairedDeltas) {
        expect(Object.values(point.metrics).every(value => Object.is(value, 0))).toBe(true)
      }
    }
    expect(result.aggregates.every(point => point.effect.mean === 0)).toBe(true)
  })

  it('records settlement evidence even when the selected metric is not population-based', async () => {
    const result = await runExperiment(plan({ replicates: 1, generations: 1, metrics: ['foodProduced'] }))
    const point = result.replicates[0].scenarioA.generations[0]
    expect(point.metrics).toEqual({ foodProduced: expect.any(Number) })
    expect(point.settlementEvidence).toMatchObject({
      generation: 1,
      startPopulation: 6,
      outcomes: expect.any(Object),
      birthsEligible: expect.any(Number),
      birthsAdmitted: expect.any(Number),
      birthsCapped: expect.any(Number),
      birthsImmature: expect.any(Number),
    })
    expect(Object.keys(point.settlementEvidence ?? {})).toEqual([
      'generation', 'startPopulation', 'outcomes', 'birthsEligible', 'birthsAdmitted', 'birthsCapped', 'birthsImmature',
    ])
    expect(Object.keys(point.settlementEvidence!.outcomes)).toEqual(SETTLEMENT_OUTCOME_KEYS)
  })

  it('preserves the legacy absence of the optional maturity count', async () => {
    const result = await runExperiment(plan({
      replicates: 1,
      generations: 1,
      baseConfig: { ...defaultConfig, ...CLASSIC_MODES },
      metrics: ['foodProduced'],
    }))
    const evidence = result.replicates[0].scenarioA.generations[0].settlementEvidence!
    expect(Object.hasOwn(evidence, 'birthsImmature')).toBe(false)
  })

  it('keeps settlement evidence fresh and deterministic across runs and rows', async () => {
    const input = plan({ replicates: 1, generations: 2, metrics: ['avgSpeed'] })
    const first = await runExperiment(input)
    const second = await runExperiment(input)
    expect(second).toEqual(first)

    const firstA = first.replicates[0].scenarioA.generations
    const secondA = second.replicates[0].scenarioA.generations
    const firstEvidence = firstA[0].settlementEvidence!
    expect(firstA[0].settlementEvidence).not.toBe(firstA[1].settlementEvidence)
    expect(firstEvidence.outcomes).not.toBe(firstA[1].settlementEvidence!.outcomes)
    expect(firstEvidence.outcomes).not.toBe(secondA[0].settlementEvidence!.outcomes)

    const originalSurvived = secondA[0].settlementEvidence!.outcomes.survived
    ;(firstEvidence.outcomes as Record<string, number>).survived = originalSurvived + 1
    expect(secondA[0].settlementEvidence!.outcomes.survived).toBe(originalSurvived)
  })

  it('preserves exact settlement accounting invariants in every runner result', async () => {
    const result = await runExperiment(plan({ replicates: 2, generations: 3, metrics: ['foodConsumed'] }))
    for (const replicate of result.replicates) {
      for (const arm of [replicate.scenarioA, replicate.scenarioB]) {
        for (const point of arm.generations) {
          const evidence = point.settlementEvidence!
          const outcomeTotal = Object.values(evidence.outcomes).reduce((sum, count) => sum + count, 0)
          expect(outcomeTotal).toBe(evidence.startPopulation)
          expect(evidence.birthsEligible).toBe(evidence.birthsAdmitted + evidence.birthsCapped)
          expect(evidence.birthsEligible).toBeLessThanOrEqual(evidence.outcomes.survived)
          if (Object.hasOwn(evidence, 'birthsImmature')) {
            expect(evidence.birthsEligible + evidence.birthsImmature!).toBeLessThanOrEqual(evidence.outcomes.survived)
          }
        }
      }
    }
  })

  it('keeps all advanced ecology metrics exactly paired for identical arms', async () => {
    const metrics = ['avgEnergy', 'avgAge', 'aged', 'foodProduced', 'resourceAbundance', 'attackSuccessRate'] as const
    const result = await runExperiment(plan({ replicates: 1, generations: 2, metrics }))
    for (const point of result.replicates[0].pairedDeltas) {
      expect(Object.fromEntries(metrics.map(metric => [metric, point.metrics[metric]]))).toEqual({
        avgEnergy: 0,
        avgAge: 0,
        aged: 0,
        foodProduced: 0,
        resourceAbundance: 0,
        attackSuccessRate: point.generation === 1 ? null : 0,
      })
    }
    expect(result.schemaVersion).toBe(1)
  })

  it('uses null for undefined rates and extinct averages while event/resource counts stay zero', async () => {
    const result = await runExperiment(plan({
      replicates: 1,
      generations: 1,
      baseConfig: { ...defaultConfig, ...CLASSIC_MODES, initialPopulation: 1, foodPerDay: 0, startingEnergy: 10, dayLength: 5 },
      metrics: ['avgEnergy', 'avgAge', 'aged', 'foodProduced', 'resourceAbundance', 'attackSuccessRate'],
    }))
    expect(result.replicates[0].scenarioA.generations[0].metrics).toEqual({ avgEnergy: null, avgAge: null, aged: 0, foodProduced: 0, resourceAbundance: 0, attackSuccessRate: null })
  })

  it('keeps unavailable paired effects out of aggregates and comparable selection', async () => {
    const result = await runExperiment(plan({
      replicates: 1,
      generations: 1,
      baseConfig: { ...defaultConfig, ...CLASSIC_MODES, initialPopulation: 1, foodPerDay: 0, startingEnergy: 10, dayLength: 60 },
      scenarioB: { id: 'treatment', label: 'Treatment', config: { startingEnergy: 500, foodPerDay: 120 } },
      metrics: ['avgEnergy', 'avgAge', 'attackSuccessRate'],
    }))
    const replicate = result.replicates[0]
    expect(replicate.scenarioA.generations[0].metrics).toEqual({ avgEnergy: null, avgAge: null, attackSuccessRate: null })
    const treatmentMetrics=replicate.scenarioB.generations[0].metrics
    expect(typeof treatmentMetrics.avgEnergy==='number'&&Number.isFinite(treatmentMetrics.avgEnergy)).toBe(true)
    expect(typeof treatmentMetrics.avgAge==='number'&&Number.isFinite(treatmentMetrics.avgAge)).toBe(true)
    expect(replicate.pairedDeltas[0].metrics).toEqual({ avgEnergy: null, avgAge: null, attackSuccessRate: null })
    expect(result.aggregates.map(point => point.effect)).toEqual([
      { count: 0, mean: null, median: null, q1: null, q3: null, interval: [null, null] },
      { count: 0, mean: null, median: null, q1: null, q3: null, interval: [null, null] },
      { count: 0, mean: null, median: null, q1: null, q3: null, interval: [null, null] },
    ])
    expect(latestComparableAggregate(result.aggregates)).toBeNull()
  })

  it('runs v4 continuous pressure interventions deterministically from their scheduled boundary', async () => {
    const input = plan({
      replicates: 1,
      generations: 2,
      baseConfig: { ...defaultConfig, initialPopulation: 5, foodPerDay: 8, dayLength: 5 },
      metrics: ['population', 'avgEnergy', 'foodProduced', 'resourceAbundance', 'attackSuccessRate'],
      scenarioB: { id: 'treatment', label: 'Treatment', interventions: [{ id: 'v4-pressure', generation: 2, changes: { foodRegrowthRate: .5, attackCost: 12, reactionTime: .5, reproductionEnergyCost: 55 } }] },
    })
    const first = await runExperiment(input), second = await runExperiment(input)
    expect(second).toEqual(first)
    expect(first.replicates[0].scenarioB.generations.map(point => point.appliedInterventionIds)).toEqual([[], ['v4-pressure']])
    expect(first.replicates[0].pairedDeltas[0].metrics).toEqual({
      population: 0,
      avgEnergy: 0,
      foodProduced: 0,
      resourceAbundance: 0,
      attackSuccessRate: null,
    })
    expect(fromExperimentJson(toExperimentJson(first)).result).toEqual(first)
    expect(toTidyCsv(first)).toContain(',foodProduced,')
  })

  it('reruns deterministically', async () => {
    const input = plan({
      scenarioB: { id: 'treatment', label: 'Treatment', config: { foodPerDay: 4 } },
    })
    expect(await runExperiment(input)).toEqual(await runExperiment(input))
  })

  it('applies scheduled interventions once at the correct boundary without mutating inputs', () => {
    const base = { ...defaultConfig }
    const interventions = [{ id: 'drought', generation: 3, changes: { foodPerDay: 3, foodTrend: -.05 } }] as const
    const before = structuredClone(interventions)
    const early = applyInterventionsAtBoundary(base, interventions, 2)
    expect(early).toEqual({ config: base, appliedIds: [] })
    const exact = applyInterventionsAtBoundary(base, interventions, 3)
    expect(exact.config).toMatchObject({ foodPerDay: 3, foodTrend: -.05 })
    expect(exact.appliedIds).toEqual(['drought'])
    const repeated = applyInterventionsAtBoundary(exact.config, interventions, 3, new Set(exact.appliedIds))
    expect(repeated).toEqual({ config: exact.config, appliedIds: [] })
    expect(base).toEqual(defaultConfig)
    expect(interventions).toEqual(before)
  })

  it('records runner interventions only on their scheduled generation and preserves the plan', async () => {
    const input = plan({
      replicates: 1,
      generations: 3,
      baseConfig: { ...defaultConfig, ...CLASSIC_MODES, initialPopulation: 1, foodPerDay: 8, seasonAmplitude: 0, environmentResponse: 1, dayLength: 5 },
      metrics: ['foodAtStart'],
      scenarioA: {
        id: 'control',
        label: 'Control',
        interventions: [{ id: 'drought', generation: 2, changes: { foodPerDay: 0 } }],
      },
    })
    const before = structuredClone(input)
    const result = await runExperiment(input)
    expect(result.replicates[0].scenarioA.generations.map(point => point.appliedInterventionIds)).toEqual([
      [],
      ['drought'],
      [],
    ])
    expect(result.replicates[0].scenarioA.generations.map(point => point.metrics.foodAtStart)).toEqual([8, 0, 0])
    expect(result.replicates[0].scenarioB.generations.map(point => point.metrics.foodAtStart)).toEqual([8, 8, 8])
    expect(fromExperimentJson(toExperimentJson(result)).result).toEqual(result)
    expect(input).toEqual(before)
  })

  it('applies setup configuration at the boundary without leaking into the final tick',()=>{
    const classic=createWorld({...defaultConfig,...CLASSIC_MODES,seed:71,initialPopulation:1,foodPerDay:8,seasonAmplitude:0,environmentResponse:1,dayLength:5})
    const classicBoundary={...classic.config,foodPerDay:0}
    runWorldGeneration(classic,classicBoundary)
    expect(classic.config.foodPerDay).toBe(8)
    expect(classic.environment.targetFood).toBe(0)
    expect(classic.food).toHaveLength(0)

    const advanced=createWorld({...defaultConfig,seed:73,initialPopulation:1,foodPerDay:8,seasonAmplitude:0,environmentResponse:1,foodRegrowthRate:1,patchCapacity:20,dayLength:5})
    const control=structuredClone(advanced),advancedBoundary={...advanced.config,foodPerDay:0}
    runWorldGeneration(advanced,advancedBoundary);runWorldGeneration(control)
    expect(advanced.config.foodPerDay).toBe(8)
    expect(advanced.environment.targetFood).toBe(0)
    expect(advanced.ledger[0].foodProduced).toBe(control.ledger[0].foodProduced)
    expect(advanced.ledger[0]).toEqual(control.ledger[0])
  })

  it('roundtrips multiple distinct interventions at the same generation', async () => {
    const result = await runExperiment(plan({
      replicates: 1,
      generations: 2,
      scenarioB: {
        id: 'treatment',
        label: 'Treatment',
        interventions: [
          { id: 'drought', generation: 2, changes: { foodPerDay: 3 } },
          { id: 'movement-cost', generation: 2, changes: { moveEnergyFactor: 1.4 } },
        ],
      },
    }))
    expect(result.replicates[0].scenarioB.generations[1].appliedInterventionIds).toEqual(['drought', 'movement-cost'])
    expect(fromExperimentJson(toExperimentJson(result)).result).toEqual(result)
  })

  it('aggregates paired fixtures with deterministic quartiles and mean effects', () => {
    const replicates = [1, 3, 9].map((b, replicate): ReplicateResult => ({
      replicate,
      pairedSeed: replicate + 1,
      scenarioA: { scenarioId: 'a', scenarioLabel: 'A', replaySeed: replicate + 1, extinct: false, completedGenerations: 1, generations: [{ generation: 1, metrics: { population: 1 }, appliedInterventionIds: [] }] },
      scenarioB: { scenarioId: 'b', scenarioLabel: 'B', replaySeed: replicate + 1, extinct: false, completedGenerations: 1, generations: [{ generation: 1, metrics: { population: b }, appliedInterventionIds: [] }] },
      pairedDeltas: [{ generation: 1, metrics: { population: b - 1 } }],
    }))
    const [aggregate] = aggregateReplicates(replicates, 1, ['population'])
    expect(aggregate.scenarioB).toMatchObject({ count: 3, mean: 13 / 3, median: 3, q1: 2, q3: 6 })
    expect(aggregate.effect).toMatchObject({ count: 3, mean: 10 / 3, median: 2, q1: 1, q3: 5 })
  })

  it('rejects plans beyond the hard generation-run cap', () => {
    expect(() => validateExperimentPlan(plan({ replicates: 101, generations: 10 }))).toThrow(/2,000 generation-run limit/)
    expect(() => validateExperimentPlan(plan({ replicates: 100, generations: 10 }))).not.toThrow()
  })

  it('stops an arm after recording extinction when requested', async () => {
    const result = await runExperiment(plan({
      replicates: 1,
      generations: 4,
      stopOnExtinction: true,
      baseConfig: { ...defaultConfig, ...CLASSIC_MODES, initialPopulation: 1, foodPerDay: 0, startingEnergy: 10, dayLength: 5 },
      metrics: ['population'],
    }))
    expect(result.replicates[0].scenarioA).toMatchObject({ extinct: true, completedGenerations: 1 })
    expect(result.replicates[0].scenarioB).toMatchObject({ extinct: true, completedGenerations: 1 })
    expect(result.completedGenerationRuns).toBe(2)
    expect(fromExperimentJson(toExperimentJson(result)).result).toEqual(result)
  })

  it('cancels cooperatively and reports completed work', async () => {
    const controller = new AbortController()
    const progress: number[] = []
    const promise = runExperiment(plan({ replicates: 2, generations: 3 }), {
      signal: controller.signal,
      yieldEvery: 1,
      onProgress(update) {
        progress.push(update.completedGenerationRuns)
        if (update.completedGenerationRuns === 1) controller.abort()
      },
    })
    await expect(promise).rejects.toMatchObject({ name: 'ExperimentCancelledError', completedGenerationRuns: 1 })
    await expect(promise).rejects.toBeInstanceOf(ExperimentCancelledError)
    expect(progress).toEqual([1])
  })

  it('exports stable versioned JSON and tidy CSV rows', async () => {
    const result = await runExperiment(plan({ replicates: 1, generations: 1, metrics: ['population'] }))
    const json = toExperimentJson(result)
    expect(fromExperimentJson(json)).toMatchObject({
      schema: 'evolution-field-lab/experiment-result',
      version: 1,
      result: { schemaVersion: 1 },
    })
    const lines = toTidyCsv(result).split('\n')
    expect(lines[0]).toBe('schema_version,plan_id,replicate,paired_seed,kind,scenario_id,generation,metric,value')
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain(',arm,control,1,population,')
    expect(lines[3]).toContain(',paired_delta,B-A,1,population,0')
  })

  it('roundtrips settlement evidence without changing the version or CSV row shape', async () => {
    const result = await runExperiment(plan({ replicates: 1, generations: 2, metrics: ['foodProduced'] }))
    const imported = fromExperimentJson(toExperimentJson(result))
    expect(imported.version).toBe(1)
    expect(imported.result).toEqual(result)
    expect(toTidyCsv(imported.result).split('\n')).toHaveLength(7)
  })

  it('rejects a contradictory next-population transition between adjacent evidence rows', async () => {
    const result = await runExperiment(plan({ replicates: 1, generations: 2, metrics: ['foodProduced'] }))
    const payload = JSON.parse(toExperimentJson(result))
    const generations = payload.result.replicates[0].scenarioA.generations
    const previous = generations[0].settlementEvidence
    const current = generations[1].settlementEvidence
    const priorNextPopulation = previous.outcomes.survived + previous.birthsAdmitted
    const contradictoryStartPopulation = priorNextPopulation === 0 ? 1 : 0
    current.startPopulation = contradictoryStartPopulation
    current.outcomes = {
      survived: contradictoryStartPopulation,
      hunted: 0,
      energy: 0,
      unfed: 0,
      late: 0,
      aged: 0,
    }
    current.birthsEligible = 0
    current.birthsAdmitted = 0
    current.birthsCapped = 0
    if (Object.hasOwn(current, 'birthsImmature')) current.birthsImmature = 0
    expect(() => fromExperimentJson(JSON.stringify(payload))).toThrow(TypeError)
  })

  it.each(['population', 'survivalRate', 'births', 'hunted', 'energyDeaths', 'unfed', 'late', 'aged'] as const)(
    'rejects a contradictory settlement evidence-backed %s metric',
    async metric => {
      const result = await runExperiment(plan({ replicates: 1, generations: 1, metrics: [metric] }))
      const payload = JSON.parse(toExperimentJson(result))
      const point = payload.result.replicates[0].scenarioA.generations[0]
      const evidence = point.settlementEvidence
      const expected = metric === 'population'
        ? evidence.outcomes.survived + evidence.birthsAdmitted
        : metric === 'survivalRate'
          ? evidence.startPopulation ? evidence.outcomes.survived / evidence.startPopulation : 0
          : metric === 'births'
            ? evidence.birthsAdmitted
            : evidence.outcomes[metric === 'energyDeaths' ? 'energy' : metric]
      point.metrics[metric] = expected === 0 ? 1 : 0
      expect(() => fromExperimentJson(JSON.stringify(payload))).toThrow(TypeError)
    },
  )

  it('bounds population evidence and rejects a next-population overflow beyond the simulation cap', async () => {
    const result = await runExperiment(plan({ replicates: 1, generations: 1, metrics: ['foodProduced'] }))
    const validJson = toExperimentJson(result)
    const mutateEvidence = (change: (evidence: any) => void) => {
      const payload = JSON.parse(validJson)
      change(payload.result.replicates[0].scenarioA.generations[0].settlementEvidence)
      return JSON.stringify(payload)
    }
    expect(() => fromExperimentJson(mutateEvidence(evidence => {
      evidence.startPopulation = 121
    }))).toThrow(TypeError)
    expect(() => fromExperimentJson(mutateEvidence(evidence => {
      evidence.outcomes = { survived: 120, hunted: 0, energy: 0, unfed: 0, late: 0, aged: 0 }
      evidence.startPopulation = 120
      evidence.birthsEligible = 1
      evidence.birthsAdmitted = 1
      evidence.birthsCapped = 0
      if (Object.hasOwn(evidence, 'birthsImmature')) evidence.birthsImmature = 0
    }))).toThrow(TypeError)
  })

  it('accepts legacy generation records that omit the optional settlement evidence', async () => {
    const result = await runExperiment(plan({ replicates: 1, generations: 1, metrics: ['population'] }))
    const payload = JSON.parse(toExperimentJson(result))
    delete payload.result.replicates[0].scenarioA.generations[0].settlementEvidence
    delete payload.result.replicates[0].scenarioB.generations[0].settlementEvidence
    const imported = fromExperimentJson(JSON.stringify(payload))
    expect(imported.result.replicates[0].scenarioA.generations[0]).not.toHaveProperty('settlementEvidence')
    expect(imported.result.replicates[0].scenarioB.generations[0]).not.toHaveProperty('settlementEvidence')
  })

  it('normalizes exact legacy v3 result configs to classic modes', async () => {
    const result = await runExperiment(plan({ replicates: 1, generations: 1, metrics: ['population'] }))
    const payload = JSON.parse(toExperimentJson(result))
    for (const key of [...V4_ONLY_CONFIG_KEYS, ...V5_ONLY_CONFIG_KEYS]) delete payload.result.plan.baseConfig[key]
    const imported = fromExperimentJson(JSON.stringify(payload))
    expect(imported.result.plan.baseConfig).toMatchObject({ ecologyMode: 'classic', perceptionMode: 'perfect', predationMode: 'threshold' })
    expect(imported.result.plan.baseConfig.foodEnergy).toBe(defaultConfig.foodEnergy)
    expect(imported.result.plan.baseConfig.maturityAge).toBe(0)
  })

  it('normalizes exact legacy v4 result configs without changing ecological modes and inherits maturity in partial scenarios', async () => {
    const input = plan({
      replicates: 1,
      generations: 2,
      baseConfig: { ...defaultConfig, seed: 6301, initialPopulation: 5, foodPerDay: 8, dayLength: 5 },
      scenarioB: { id: 'treatment', label: 'Treatment', config: { startingEnergy: 125 } },
      metrics: ['population', 'avgEnergy', 'births'],
    })
    const result = await runExperiment(input)
    const payload = JSON.parse(toExperimentJson(result)) as any
    delete payload.result.plan.baseConfig.maturityAge
    const imported = fromExperimentJson(JSON.stringify(payload))
    expect(imported.result.plan.baseConfig).toMatchObject({
      ecologyMode: 'energy-regrowth',
      perceptionMode: 'realistic',
      predationMode: 'contest',
      maturityAge: 0,
    })
    expect(imported.result.plan.scenarioB.config).toEqual({ startingEnergy: 125 })
    const migratedResult = await runExperiment(imported.result.plan)
    const explicitResult = await runExperiment({
      ...input,
      baseConfig: { ...input.baseConfig, maturityAge: 0 },
    })
    expect(migratedResult).toEqual(explicitResult)
  })

  it('neutralizes spreadsheet formulas in every string-backed CSV identifier', async () => {
    const result = await runExperiment(plan({
      id: '  =1+1',
      replicates: 1,
      generations: 1,
      metrics: ['population'],
      scenarioA: { id: '+SUM(1,1)', label: 'A' },
      scenarioB: { id: '\r@command', label: 'B' },
    }))
    const csv = toTidyCsv(result)
    expect(csv).toContain(",'  =1+1,")
    expect(csv).toContain(',"\'+SUM(1,1)",')
    expect(csv).toContain(',"\'\r@command",')
  })

  it('rejects malformed or unsafe nested experiment exports', async () => {
    const result = await runExperiment(plan({ replicates: 1, generations: 1, metrics: ['population'] }))
    const validJson = toExperimentJson(result)
    const mutate = (change: (payload: any) => void) => {
      const payload = JSON.parse(validJson)
      change(payload)
      return JSON.stringify(payload)
    }
    const malformed = [
      mutate(payload => { delete payload.result.plan.baseConfig.seed }),
      mutate(payload => { payload.result.plan.scenarioA.id = 42 }),
      mutate(payload => { payload.result.plan.metrics[0] = 'unsupportedMetric' }),
      mutate(payload => { payload.result.plan.scenarioA.interventions = Array.from({ length: 2_001 }, (_, index) => ({ id: `i-${index}`, generation: 1, changes: {} })) }),
      mutate(payload => { payload.result.replicates[0].scenarioA.generations[0].metrics.population = '42' }),
      mutate(payload => { payload.result.replicates[0].pairedDeltas[0].metrics = {} }),
      mutate(payload => { payload.result.aggregates[0].effect.interval.push(0) }),
      mutate(payload => { payload.result.aggregates[0].scenarioA.mean = Number.NaN }),
      mutate(payload => { payload.result.replicates[0].scenarioB.generations[0].unexpected = true }),
      mutate(payload => { payload.result.plan.baseConfig.ecologyMode = 'unknown' }),
      mutate(payload => { payload.result.plan.metrics = ['attackSuccessRate']; payload.result.replicates[0].scenarioA.generations[0].metrics = { attackSuccessRate: 'none' } }),
    ]
    for (const source of malformed) expect(() => fromExperimentJson(source)).toThrow(TypeError)

    const nonfinite = validJson.replace(/"pairedSeed":\s*\d+/, '"pairedSeed": 1e400')
    expect(() => fromExperimentJson(nonfinite)).toThrow(TypeError)
    expect(() => fromExperimentJson('['.repeat(65) + '0' + ']'.repeat(65))).toThrow(/nesting is too deep/)
    expect(() => fromExperimentJson(' '.repeat(MAX_EXPERIMENT_JSON_LENGTH + 1))).toThrow(/size limit/)
  })

  it('rejects malformed or inconsistent settlement evidence', async () => {
    const result = await runExperiment(plan({ replicates: 1, generations: 1, metrics: ['foodProduced'] }))
    const validJson = toExperimentJson(result)
    const mutateEvidence = (change: (evidence: any) => void) => {
      const payload = JSON.parse(validJson)
      change(payload.result.replicates[0].scenarioA.generations[0].settlementEvidence)
      return JSON.stringify(payload)
    }
    const malformed = [
      mutateEvidence(evidence => { evidence.unexpected = 1 }),
      mutateEvidence(evidence => { evidence.generation = 2 }),
      mutateEvidence(evidence => { evidence.startPopulation += 1 }),
      mutateEvidence(evidence => { evidence.outcomes.survived = -1 }),
      mutateEvidence(evidence => { evidence.outcomes.hunted = 1.5 }),
      mutateEvidence(evidence => { delete evidence.outcomes.aged }),
      mutateEvidence(evidence => { evidence.birthsEligible += 1 }),
      mutateEvidence(evidence => { evidence.birthsAdmitted += 1 }),
      mutateEvidence(evidence => { evidence.birthsEligible = evidence.outcomes.survived + 1; evidence.birthsAdmitted = evidence.birthsEligible; evidence.birthsCapped = 0 }),
      mutateEvidence(evidence => { evidence.birthsImmature = evidence.outcomes.survived + 1 }),
      mutateEvidence(evidence => { evidence.birthsImmature = 'unknown' }),
    ]
    for (const source of malformed) expect(() => fromExperimentJson(source)).toThrow(TypeError)
  })
})
