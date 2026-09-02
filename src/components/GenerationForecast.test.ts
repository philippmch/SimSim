import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CLASSIC_MODES, defaultConfig, MAX_POPULATION } from '../simulation/config'
import { createWorld } from '../simulation/engine'
import { formatGenerationForecastAriaLabel, formatGenerationForecastBirths, formatGenerationForecastEquation, formatGenerationForecastLosses, formatGenerationForecastTransition, GenerationForecast, summarizeGenerationForecast, summarizeSelectedSettlementPreview, type GenerationForecastSummary } from './GenerationForecast'
import { formatSelectedSettlementReproduction } from './CreatureInspector'

describe('generation forecast', () => {
  it('uses classic settlement rules for the current cohort and loss causes', () => {
    const world = createWorld({ ...defaultConfig, ...CLASSIC_MODES, initialPopulation: 4, foodPerDay: 0 })
    const [breeder, survivor, unfed, late] = world.creatures
    Object.assign(breeder, { alive: true, home: true, food: 2 })
    Object.assign(survivor, { alive: true, home: true, food: 1 })
    Object.assign(unfed, { alive: true, home: true, food: 0 })
    Object.assign(late, { alive: true, home: false, food: 1 })

    const summary = summarizeGenerationForecast(world)

    expect(summary).toMatchObject({ evaluatedCohort: 4, survivors: 2, eligibleParents: 1, admittedBirths: 1, cappedBirths: 0, projectedNextPopulation: 3 })
    expect(summary.losses).toEqual({ hunted: 0, energy: 0, unfed: 1, late: 1, aged: 0 })
    expect(summary.immatureParents).toBe(0)
    expect(summary.energyLimitedParents).toBe(0)
    expect(formatGenerationForecastBirths(summary)).toBe('1 eligible parent · 1 admitted newborn · 0 births blocked by the population cap')
  })

  it('forecasts energy carryover and regrowth reproduction eligibility', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 3, foodPerDay: 0, energyRetention: .5, maturityAge: 0 })
    const [parent, nonParent, depleted] = world.creatures
    Object.assign(parent, { alive: true, home: true, energy: 100 })
    Object.assign(nonParent, { alive: true, home: true, energy: 69 })
    Object.assign(depleted, { alive: false, home: true, energy: 0, deathCause: 'energy' })

    const summary = summarizeGenerationForecast(world)

    expect(summary).toMatchObject({ evaluatedCohort: 3, survivors: 2, eligibleParents: 1, admittedBirths: 1, projectedNextPopulation: 3 })
    expect(summary.losses).toEqual({ hunted: 0, energy: 1, unfed: 0, late: 0, aged: 0 })
  })

  it('partitions advanced survivors into mature, energy-ready immature, and below-cost parents', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 4, foodPerDay: 0, energyRetention: .5, reproductionEnergyCost: 35, maturityAge: 2 })
    const [mature, immature, exactCost, dualConstraint] = world.creatures
    Object.assign(mature, { alive: true, home: true, age: 2, energy: 100 })
    Object.assign(immature, { alive: true, home: true, age: 0, energy: 100 })
    Object.assign(exactCost, { alive: true, home: true, age: 2, energy: 70 })
    Object.assign(dualConstraint, { alive: true, home: true, age: 0, energy: 70 })

    const before = structuredClone(world)
    const summary = summarizeGenerationForecast(world)

    expect(summary).toMatchObject({ evaluatedCohort: 4, survivors: 4, eligibleParents: 1, immatureParents: 1, energyLimitedParents: 2, admittedBirths: 1, cappedBirths: 0, projectedNextPopulation: 5 })
    expect(formatGenerationForecastBirths(summary)).toBe('Reproduction: 1 mature + energy-eligible parent · 1 energy-ready but immature parent · 2 parents below reproduction cost · 1 admitted birth · 0 capacity-capped births.')
    expect(world).toEqual(before)
  })

  it('uses current age for maturity and keeps exact-cost or dual constraints explicit', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 1, foodPerDay: 0, energyRetention: .5, reproductionEnergyCost: 50, maturityAge: 1 })
    const [selected] = world.creatures
    Object.assign(selected, { alive: true, home: true, age: 0, energy: 100 })

    const immature = summarizeSelectedSettlementPreview(world, selected.individualId)
    expect(immature).toMatchObject({ currentAge: 0, nextAge: 1, maturityAge: 1, retainedEnergy: 50, energyEligible: false, maturityEligible: false, reproductionStatus: 'not-eligible' })
    expect(immature && formatSelectedSettlementReproduction(immature)).toContain('below required maturity age 1')

    Object.assign(selected, { age: 1, energy: 100 })
    const exact = summarizeSelectedSettlementPreview(world, selected.individualId)
    expect(exact).toMatchObject({ currentAge: 1, maturityAge: 1, retainedEnergy: 50, energyEligible: false, maturityEligible: true, reproductionStatus: 'not-eligible' })
    expect(exact && formatSelectedSettlementReproduction(exact)).toContain('must strictly exceed the 50.0 reproduction cost')

    Object.assign(selected, { age: 0, energy: 102 })
    const lowAgeEnergyReady = summarizeSelectedSettlementPreview(world, selected.individualId)
    expect(lowAgeEnergyReady).toMatchObject({ currentAge: 0, maturityAge: 1, retainedEnergy: 51, energyEligible: true, maturityEligible: false, reproductionStatus: 'immature' })
    expect(lowAgeEnergyReady && formatSelectedSettlementReproduction(lowAgeEnergyReady)).toContain('despite enough retained energy')

    Object.assign(selected, { age: 1, energy: 102 })
    const matureEligible = summarizeSelectedSettlementPreview(world, selected.individualId)
    expect(matureEligible).toMatchObject({ currentAge: 1, maturityAge: 1, retainedEnergy: 51, energyEligible: true, maturityEligible: true, reproductionStatus: 'admitted' })

    Object.assign(selected, { age: 0, energy: 98 })
    const lowEnergyDual = summarizeSelectedSettlementPreview(world, selected.individualId)
    expect(lowEnergyDual).toMatchObject({ currentAge: 0, maturityAge: 1, retainedEnergy: 49, energyEligible: false, maturityEligible: false, reproductionStatus: 'not-eligible' })
    expect(lowEnergyDual && formatSelectedSettlementReproduction(lowEnergyDual)).toContain('below required maturity age 1')
    expect(lowEnergyDual && formatSelectedSettlementReproduction(lowEnergyDual)).toContain('must strictly exceed the 50.0 reproduction cost')
  })

  it('uses the population cap for admission and reports capped eligible births', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: MAX_POPULATION, foodPerDay: 0, maturityAge: 0 })
    world.creatures.slice(0, MAX_POPULATION - 2).forEach(creature => Object.assign(creature, { alive: true, home: true, energy: 100 }))
    world.creatures.slice(-2).forEach(creature => Object.assign(creature, { alive: false, deathCause: 'hunted' }))

    const summary = summarizeGenerationForecast(world)

    expect(summary).toMatchObject({ evaluatedCohort: MAX_POPULATION, survivors: MAX_POPULATION - 2, eligibleParents: MAX_POPULATION - 2, admittedBirths: 2, cappedBirths: MAX_POPULATION - 4, projectedNextPopulation: MAX_POPULATION })
    expect(formatGenerationForecastBirths(summary)).toBe('Reproduction: 118 mature + energy-eligible parents · 0 energy-ready but immature parents · 0 parents below reproduction cost · 2 admitted births · 116 capacity-capped births.')
  })

  it('formats the equation, nonzero losses, and counterfactual wording', () => {
    const world = createWorld({ ...defaultConfig, ...CLASSIC_MODES, initialPopulation: 2, foodPerDay: 0 })
    Object.assign(world.creatures[0], { alive: true, home: true, food: 2 })
    Object.assign(world.creatures[1], { alive: false, deathCause: 'hunted' })
    const summary = summarizeGenerationForecast(world)

    expect(formatGenerationForecastEquation(summary)).toBe('2 creatures evaluated → 1 survived + 1 newborn = 2 in the next population')
    expect(formatGenerationForecastLosses(summary)).toBe('Hunted: 1')
    expect(formatGenerationForecastTransition(summary)).toBe('Forecast transition · Generation 1 → 2')
    const ariaLabel = formatGenerationForecastAriaLabel(summary)
    expect(ariaLabel).toContain('Forecast transition · Generation 1 → 2')
    expect(ariaLabel).toContain('Counterfactual snapshot · not a prediction · updates as creatures act')
    expect(ariaLabel.match(/counterfactual/gi)).toHaveLength(1)
    expect(ariaLabel.match(/updates as creatures act/gi)).toHaveLength(1)
  })

  it('keeps singular, plural, zero, and journal loss labels readable', () => {
    const singular: GenerationForecastSummary = {
      generation: 1,
      evaluatedCohort: 1,
      survivors: 1,
      projectedNextPopulation: 1,
      eligibleParents: 0,
      admittedBirths: 0,
      cappedBirths: 0,
      losses: { hunted: 0, energy: 0, unfed: 0, late: 0, aged: 0 },
    }
    expect(formatGenerationForecastEquation(singular)).toBe('1 creature evaluated → 1 survived + 0 newborns = 1 in the next population')
    expect(formatGenerationForecastBirths(singular)).toBe('0 eligible parents · 0 admitted newborns · 0 births blocked by the population cap')
    expect(formatGenerationForecastLosses(singular)).toBe('No current losses')
    expect(formatGenerationForecastLosses({ ...singular, losses: { hunted: 1, energy: 2, unfed: 3, late: 4, aged: 5 } })).toBe('Hunted: 1 · Energy depleted: 2 · No food at settlement: 3 · Missed return deadline: 4 · Old age: 5')
    expect(formatGenerationForecastTransition({ ...singular, generation: Number.NaN })).toBe('Forecast transition unavailable')
    expect(formatGenerationForecastTransition(singular, 'Extinct')).toBe('Forecast transition unavailable · no current cohort')
  })

  it('formats advanced reproduction buckets with truthful singular, plural, and zero nouns', () => {
    const zero: GenerationForecastSummary = {
      generation: 1,
      ecologyMode: 'energy-regrowth',
      evaluatedCohort: 0,
      survivors: 0,
      projectedNextPopulation: 0,
      eligibleParents: 0,
      immatureParents: 0,
      energyLimitedParents: 0,
      admittedBirths: 0,
      cappedBirths: 0,
      losses: { hunted: 0, energy: 0, unfed: 0, late: 0, aged: 0 },
    }
    expect(formatGenerationForecastBirths(zero)).toBe('Reproduction: 0 mature + energy-eligible parents · 0 energy-ready but immature parents · 0 parents below reproduction cost · 0 admitted births · 0 capacity-capped births.')

    const singular = { ...zero, survivors: 3, eligibleParents: 1, immatureParents: 1, energyLimitedParents: 1, admittedBirths: 1, cappedBirths: 1 }
    expect(formatGenerationForecastBirths(singular)).toBe('Reproduction: 1 mature + energy-eligible parent · 1 energy-ready but immature parent · 1 parent below reproduction cost · 1 admitted birth · 1 capacity-capped birth.')
    expect(formatGenerationForecastBirths(singular)).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('is deterministic and leaves the world untouched', () => {
    const world = createWorld({ ...defaultConfig, seed: 917, initialPopulation: 12 })
    const before = structuredClone(world)
    const first = summarizeGenerationForecast(world)
    const second = summarizeGenerationForecast(world)

    expect(first).toEqual(second)
    expect(world).toEqual(before)
  })

  it('uses the same active counterfactual copy while running or paused', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 2 })
    const summary = summarizeGenerationForecast(world)

    for (const playbackStatus of ['Running', 'Paused'] as const) {
      const markup = renderToStaticMarkup(createElement(GenerationForecast, { world, playbackStatus }))
      expect(markup).toContain('data-handoff-kind="forecast"')
      expect(markup).toContain('<strong>If generation ended now</strong>')
      expect(markup).toContain('Forecast transition · Generation 1 → 2')
      expect(markup).toContain('Counterfactual snapshot · not a prediction · updates as creatures act')
      expect(markup).toContain(formatGenerationForecastEquation(summary))
      expect(markup).toContain(`aria-label="${formatGenerationForecastAriaLabel(summary, playbackStatus)}"`)
      expect(markup).not.toContain('aria-live')
    }
  })

  it('labels an awaiting cohort as a settlement preview while retaining numeric details', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 2 })
    const summary = summarizeGenerationForecast(world)
    const markup = renderToStaticMarkup(createElement(GenerationForecast, { world, playbackStatus: 'Awaiting settlement' }))

    expect(markup).toContain('<strong>Settlement preview</strong>')
    expect(markup).toContain('Forecast transition · Generation 1 → 2')
    expect(markup).toContain('Not recorded until Finish generation')
    expect(markup).toContain(formatGenerationForecastEquation(summary))
    expect(markup).toContain(formatGenerationForecastLosses(summary))
    expect(markup).toContain(formatGenerationForecastBirths(summary))
    expect(markup).toContain(`aria-label="${formatGenerationForecastAriaLabel(summary, 'Awaiting settlement')}"`)
    expect(markup).not.toContain('aria-live')
  })

  it('does not show a zero-cohort settlement equation after extinction', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 2 })
    world.creatures = []
    const summary = summarizeGenerationForecast(world)
    const markup = renderToStaticMarkup(createElement(GenerationForecast, { world, playbackStatus: 'Extinct' }))

    expect(markup).toContain('<strong>Population extinct</strong>')
    expect(markup).toContain('No cohort remains to evaluate')
    expect(markup).toContain(`aria-label="${formatGenerationForecastAriaLabel(summary, 'Extinct')}"`)
    expect(markup).not.toContain('creatures evaluated')
    expect(markup).not.toContain('current losses')
    expect(markup).not.toContain('eligible parent')
    expect(markup).not.toContain('blocked by cap')
    expect(markup).not.toContain('Counterfactual')
    expect(markup).not.toContain('not a prediction')
    expect(markup).not.toContain('aria-live')
  })

  it('projects an exact classic survivor and admitted birth without mutating the world', () => {
    const world = createWorld({ ...defaultConfig, ...CLASSIC_MODES, initialPopulation: 2, foodPerDay: 0 })
    const [parent, bystander] = world.creatures
    Object.assign(parent, { alive: true, home: true, food: 2, age: 3 })
    Object.assign(bystander, { alive: true, home: true, food: 1, age: 1 })

    const preview = summarizeSelectedSettlementPreview(world, parent.individualId)

    expect(preview).toMatchObject({
      individualId: parent.individualId,
      generation: 1,
      mode: 'classic',
      outcome: 'survived',
      nextAge: 4,
      retainedEnergy: world.config.startingEnergy,
      settledEnergy: world.config.startingEnergy,
      reproductionStatus: 'admitted',
      foodAtSettlement: 2,
      eligibleParentCount: 1,
      availableBirthSlots: MAX_POPULATION - 2,
    })
  })

  it('explains the strict energy-regrowth no-birth threshold', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 1, foodPerDay: 0, energyRetention: .5, reproductionEnergyCost: 50 })
    const [selected] = world.creatures
    Object.assign(selected, { alive: true, home: true, energy: 100 })

    const preview = summarizeSelectedSettlementPreview(world, selected.individualId)

    expect(preview).toMatchObject({ mode: 'energy-regrowth', outcome: 'survived', retainedEnergy: 50, settledEnergy: 50, reproductionStatus: 'not-eligible' })
  })

  it('distinguishes an eligible parent blocked by cohort capacity', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: MAX_POPULATION, foodPerDay: 0, maturityAge: 0 })
    world.creatures.forEach(creature => Object.assign(creature, { alive: true, home: true, energy: 100 }))
    const preview = summarizeSelectedSettlementPreview(world, world.creatures[0].individualId)

    expect(preview).toMatchObject({ outcome: 'survived', reproductionStatus: 'eligible-capacity-blocked', eligibleParentCount: MAX_POPULATION, availableBirthSlots: 0 })
  })

  it('keeps each authoritative loss cause in the selected projection', () => {
    const classicWorld = createWorld({ ...defaultConfig, ...CLASSIC_MODES, initialPopulation: 2, foodPerDay: 0 })
    const [unfed, late] = classicWorld.creatures
    Object.assign(unfed, { alive: true, home: true, food: 0 })
    Object.assign(late, { alive: true, home: false, food: 1 })
    expect(summarizeSelectedSettlementPreview(classicWorld, unfed.individualId)?.outcome).toBe('unfed')
    expect(summarizeSelectedSettlementPreview(classicWorld, late.individualId)?.outcome).toBe('late')

    const energyWorld = createWorld({ ...defaultConfig, initialPopulation: 3, foodPerDay: 0 })
    const [energy, aged, hunted] = energyWorld.creatures
    Object.assign(energy, { alive: false, home: true, energy: 0, deathCause: 'energy' })
    Object.assign(aged, { alive: true, home: true, energy: 100, age: energyWorld.config.maxAge })
    Object.assign(hunted, { alive: false, home: false, energy: 100, deathCause: 'hunted' })
    expect(summarizeSelectedSettlementPreview(energyWorld, energy.individualId)?.outcome).toBe('energy')
    expect(summarizeSelectedSettlementPreview(energyWorld, aged.individualId)?.outcome).toBe('aged')
    expect(summarizeSelectedSettlementPreview(energyWorld, hunted.individualId)?.outcome).toBe('hunted')
  })

  it('returns null for missing IDs and is deterministic and pure', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 12 })
    const selected = world.creatures[0]
    Object.assign(selected, { alive: true, home: true, energy: 100 })
    const before = structuredClone(world)

    expect(summarizeSelectedSettlementPreview(world, null)).toBeNull()
    expect(summarizeSelectedSettlementPreview(world, undefined)).toBeNull()
    expect(summarizeSelectedSettlementPreview(world, 999999)).toBeNull()
    const first = summarizeSelectedSettlementPreview(world, selected.individualId)
    const second = summarizeSelectedSettlementPreview(world, selected.individualId)

    expect(first).toEqual(second)
    expect(world).toEqual(before)
    expect(world.rngState).toBe(before.rngState)
  })
})
