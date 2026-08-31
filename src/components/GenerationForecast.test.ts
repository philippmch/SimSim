import { describe, expect, it } from 'vitest'
import { CLASSIC_MODES, defaultConfig, MAX_POPULATION } from '../simulation/config'
import { createWorld } from '../simulation/engine'
import { formatGenerationForecastAriaLabel, formatGenerationForecastBirths, formatGenerationForecastEquation, formatGenerationForecastLosses, summarizeGenerationForecast, type GenerationForecastSummary } from './GenerationForecast'

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
  })

  it('forecasts energy carryover and regrowth reproduction eligibility', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 3, foodPerDay: 0, energyRetention: .5 })
    const [parent, nonParent, depleted] = world.creatures
    Object.assign(parent, { alive: true, home: true, energy: 100 })
    Object.assign(nonParent, { alive: true, home: true, energy: 69 })
    Object.assign(depleted, { alive: false, home: true, energy: 0, deathCause: 'energy' })

    const summary = summarizeGenerationForecast(world)

    expect(summary).toMatchObject({ evaluatedCohort: 3, survivors: 2, eligibleParents: 1, admittedBirths: 1, projectedNextPopulation: 3 })
    expect(summary.losses).toEqual({ hunted: 0, energy: 1, unfed: 0, late: 0, aged: 0 })
  })

  it('uses the population cap for admission and reports capped eligible births', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: MAX_POPULATION, foodPerDay: 0 })
    world.creatures.slice(0, MAX_POPULATION - 2).forEach(creature => Object.assign(creature, { alive: true, home: true, energy: 100 }))
    world.creatures.slice(-2).forEach(creature => Object.assign(creature, { alive: false, deathCause: 'hunted' }))

    const summary = summarizeGenerationForecast(world)

    expect(summary).toMatchObject({ evaluatedCohort: MAX_POPULATION, survivors: MAX_POPULATION - 2, eligibleParents: MAX_POPULATION - 2, admittedBirths: 2, cappedBirths: MAX_POPULATION - 4, projectedNextPopulation: MAX_POPULATION })
    expect(formatGenerationForecastBirths(summary)).toBe('118 eligible parents · 2 admitted newborns · 116 births blocked by the population cap')
  })

  it('formats the equation, nonzero losses, and counterfactual wording', () => {
    const world = createWorld({ ...defaultConfig, ...CLASSIC_MODES, initialPopulation: 2, foodPerDay: 0 })
    Object.assign(world.creatures[0], { alive: true, home: true, food: 2 })
    Object.assign(world.creatures[1], { alive: false, deathCause: 'hunted' })
    const summary = summarizeGenerationForecast(world)

    expect(formatGenerationForecastEquation(summary)).toBe('2 creatures evaluated → 1 survived + 1 newborn = 2 in the next population')
    expect(formatGenerationForecastLosses(summary)).toBe('Hunted: 1')
    expect(formatGenerationForecastAriaLabel(summary)).toContain('counterfactual, not a prediction')
    expect(formatGenerationForecastAriaLabel(summary)).toContain('This snapshot changes as creatures act.')
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
    expect(formatGenerationForecastLosses({ ...singular, losses: { hunted: 1, energy: 2, unfed: 3, late: 4, aged: 5 } })).toBe('Hunted: 1 · Energy depleted: 2 · Returned without enough food: 3 · Missed return deadline: 4 · Old age: 5')
  })

  it('is deterministic and leaves the world untouched', () => {
    const world = createWorld({ ...defaultConfig, seed: 917, initialPopulation: 12 })
    const before = structuredClone(world)
    const first = summarizeGenerationForecast(world)
    const second = summarizeGenerationForecast(world)

    expect(first).toEqual(second)
    expect(world).toEqual(before)
  })
})
