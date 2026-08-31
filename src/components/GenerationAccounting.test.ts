import { describe, expect, it } from 'vitest'
import {
  formatContestedClaims,
  formatAttackAccounting,
  formatFoodAccounting,
  formatGenerationAccountingAriaLabel,
  formatResourcePressureLine,
  formatResourcePressureSegments,
  formatResourceRatio,
  formatResourceValue,
  GenerationAccounting,
  summarizeResourcePressure,
  summarizeGenerationAccounting,
  type GenerationAccountingInput,
  type ResourcePressureInput,
} from './GenerationAccounting'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createWorld, defaultConfig } from '../simulation/engine'
import { CLASSIC_MODES } from '../simulation/config'

const counters = (overrides: Partial<GenerationAccountingInput> = {}): GenerationAccountingInput => ({
  predationMode: 'threshold',
  generationFoodStart: 42,
  dayFoodProduced: 0,
  dayFoodRemoved: 0,
  dayFoodConsumed: 0,
  foodCount: 42,
  dayAttackAttempts: 0,
  dayAttackSuccesses: 0,
  dayAttackFailures: 0,
  dayAttackContested: 0,
  dayPreyConsumed: 0,
  ...overrides,
})

const pressure = (overrides: Partial<ResourcePressureInput> = {}): ResourcePressureInput => ({
  ecologyMode: 'energy-regrowth',
  currentFood: 20,
  targetFood: 25.25,
  foodBudget: 22.5,
  patches: [{ stock: 12 }, { stock: 8 }],
  configuredPatchCount: 4,
  patchCapacity: 20,
  globalFoodCap: 100,
  ...overrides,
})

describe('generation accounting', () => {
  it('recognizes a balanced generation with zero combat', () => {
    const summary = summarizeGenerationAccounting(counters())
    expect(summary).toMatchObject({ expectedFood: 42, currentFood: 42, foodBalanced: true, attackAttempts: 0, attackSuccesses: 0, attackFailures: 0, attackContested: 0, preyConsumed: 0 })
    expect(formatFoodAccounting(summary)).toContain('= 42 current · balanced')
    expect(formatGenerationAccountingAriaLabel(1, summary)).toContain('0 total claims = 0 successes + 0 failures + 0 contested same-prey claims')
  })

  it('balances drought, bloom, and regrowth-style food counters', () => {
    const summary = summarizeGenerationAccounting(counters({ predationMode: 'contest', generationFoodStart: 10, dayFoodProduced: 8, dayFoodRemoved: 3, dayFoodConsumed: 5, foodCount: 10, dayAttackAttempts: 4, dayAttackSuccesses: 2, dayAttackFailures: 2, dayPreyConsumed: 2 }))
    expect(summary.expectedFood).toBe(10)
    expect(summary.foodBalanced).toBe(true)
    expect(formatFoodAccounting(summary)).toBe('10 start + 8 added/grown − 3 removed − 5 consumed = 10 current · balanced')
    expect(formatGenerationAccountingAriaLabel(2, summary)).toContain('4 resolved attempts = 2 successes + 2 failures; 0 contested same-prey claims excluded before resolution')
  })

  it('flags mismatched counters instead of asserting a false balance', () => {
    const summary = summarizeGenerationAccounting(counters({ generationFoodStart: 10, dayFoodProduced: 2, dayFoodRemoved: 1, dayFoodConsumed: 1, foodCount: 9 }))
    expect(summary).toMatchObject({ expectedFood: 10, currentFood: 9, foodBalanced: false })
    expect(formatFoodAccounting(summary)).toContain('= 9 current · expected 10 · check counters')
    expect(formatGenerationAccountingAriaLabel(3, summary)).toContain('Food counters do not balance')
  })

  it('uses the authoritative live contested count in threshold mode', () => {
    const summary = summarizeGenerationAccounting(counters({ dayAttackAttempts: 2, dayAttackSuccesses: 1, dayAttackFailures: 0, dayAttackContested: 1, dayPreyConsumed: 1 }))
    expect(summary).toMatchObject({ attackAttempts: 2, attackBasis: 'claims', attackSuccesses: 1, attackFailures: 0, attackContested: 1, preyConsumed: 1 })
    expect(formatAttackAccounting(summary)).toBe('2 total claims = 1 success + 0 failures + 1 contested same-prey claim')
    expect(formatGenerationAccountingAriaLabel(4, summary)).toContain('2 total claims = 1 success + 0 failures + 1 contested same-prey claim')
  })

  it('uses the authoritative live contested count in contest mode', () => {
    const summary = summarizeGenerationAccounting(counters({ predationMode: 'contest', dayAttackAttempts: 2, dayAttackSuccesses: 1, dayAttackFailures: 1, dayAttackContested: 1, dayPreyConsumed: 1 }))
    expect(summary).toMatchObject({ attackAttempts: 2, attackBasis: 'admitted', attackSuccesses: 1, attackFailures: 1, attackContested: 1 })
    expect(formatAttackAccounting(summary)).toBe('2 resolved attempts = 1 success + 1 failure; 1 contested same-prey claim excluded before resolution')
    expect(formatGenerationAccountingAriaLabel(5, summary)).toContain('2 resolved attempts = 1 success + 1 failure; 1 contested same-prey claim excluded before resolution')
  })

  it('pluralizes contested same-prey claims and always exposes them', () => {
    expect(formatContestedClaims(1)).toBe('1 contested same-prey claim')
    expect(formatContestedClaims(0)).toBe('0 contested same-prey claims')
    expect(formatContestedClaims(2)).toBe('2 contested same-prey claims')
    const summary = summarizeGenerationAccounting(counters({ dayAttackContested: 2 }))
    expect(formatGenerationAccountingAriaLabel(6, summary)).toContain('2 contested same-prey claims')
  })
})

describe('resource pressure', () => {
  it('summarizes actual patch capacity and reconciled advanced stock', () => {
    const summary = summarizeResourcePressure(pressure())
    expect(summary).toMatchObject({
      currentFood: 20,
      targetFood: 25.25,
      foodBudget: 22.5,
      actualPatchCount: 2,
      configuredPatchCount: 4,
      patchStock: 20,
      patchCapacity: 20,
      effectiveCapacity: 40,
      globalFoodCap: 100,
      patchStockReconciles: true,
      patchStockRatio: .5,
    })
    expect(formatResourcePressureLine(summary)).toContain('Current food 20')
    expect(formatResourcePressureLine(summary)).toContain('25.3')
    expect(formatResourcePressureLine(summary)).toContain('2 actual / 4 configured patches')
    expect(formatResourcePressureLine(summary)).toContain('Patch stock 20/40 (50%)')
    expect(formatResourcePressureLine(summary)).toContain('Capacity 20/patch')
    expect(formatResourcePressureLine(summary)).toContain('Effective capacity 40')
    expect(formatResourcePressureLine(summary)).toContain('global cap 100')
    expect(formatResourcePressureSegments(summary)).toEqual(expect.arrayContaining(['Current food 20', '2 actual / 4 configured patches', 'global cap 100']))
    expect(formatResourcePressureSegments(summary).slice(-4)).toEqual(['Target + budget update at generation boundaries', 'Budget scales configured regrowth', 'Capacity and caps can limit additions', 'Food also changes through eating, regrowth, and live shocks'])
  })

  it('uses the tighter of patch capacity and the global cap, including zero capacity', () => {
    const patchBound = summarizeResourcePressure(pressure())
    const globalBound = summarizeResourcePressure(pressure({ currentFood: 20, patches: [{stock:5},{stock:5},{stock:5},{stock:5}], configuredPatchCount: 4, globalFoodCap: 50 }))
    const noPatches = summarizeResourcePressure(pressure({ currentFood: 0, patches: [], configuredPatchCount: 0, globalFoodCap: 50 }))
    const zeroPatchCapacity = summarizeResourcePressure(pressure({ currentFood: 0, patches: [{stock:0}], configuredPatchCount: 1, patchCapacity: 0, globalFoodCap: 50 }))
    expect(patchBound.effectiveCapacity).toBe(40)
    expect(globalBound.effectiveCapacity).toBe(50)
    expect(globalBound.patchStockRatio).toBe(.4)
    expect(noPatches).toMatchObject({effectiveCapacity:0,patchStock:0,patchStockReconciles:true,patchStockRatio:null})
    expect(zeroPatchCapacity).toMatchObject({effectiveCapacity:0,patchStock:0,patchStockReconciles:true,patchStockRatio:null})
    expect(formatResourcePressureLine(noPatches)).toContain('Patch stock 0/0 (no capacity)')
  })

  it('keeps mathematical seasonal targets visible above the global cap', () => {
    const summary = summarizeResourcePressure(pressure({ targetFood: 210, foodBudget: 40, globalFoodCap: 40 }))
    expect(summary.targetFood).toBe(210)
    expect(formatResourcePressureLine(summary)).toContain('Seasonal target 210.0')
    expect(formatResourcePressureLine(summary)).toContain('Supply budget 40.0')
  })

  it('withholds patch stock ratio when data is invalid or does not reconcile', () => {
    const mismatch = summarizeResourcePressure(pressure({ currentFood: 21 }))
    const invalid = summarizeResourcePressure(pressure({ patches: [{ stock: 12 }, { stock: Number.NaN }] }))
    expect(mismatch.patchStockReconciles).toBe(false)
    expect(mismatch.patchStockRatio).toBeNull()
    expect(formatResourcePressureLine(mismatch)).toContain('Patch stock 20 does not match 21 current food')
    expect(invalid.patchStock).toBeNull()
    expect(invalid.patchStockReconciles).toBeNull()
    expect(formatResourcePressureLine(invalid)).toContain('Patch stock unavailable')
    const badNumbers = summarizeResourcePressure(pressure({ currentFood: -1, targetFood: Number.POSITIVE_INFINITY, foodBudget: Number.NaN, patchCapacity: -4, globalFoodCap: Number.NaN }))
    expect(formatResourcePressureLine(badNumbers)).not.toMatch(/NaN|Infinity/)
    expect(formatResourcePressureLine(badNumbers)).toContain('unavailable')
  })

  it('explains classic pulse semantics and inactive patch capacity', () => {
    const summary = summarizeResourcePressure(pressure({ ecologyMode: 'classic', currentFood: 7, targetFood: 12.2, foodBudget: 10.6 }))
    const line = formatResourcePressureLine(summary)
    expect(line).toContain('Current food 7')
    expect(line).toContain('Patch capacity inactive')
    expect(line).toContain("Rounded budget → that generation's replacement food pulse")
    expect(line).toContain('No within-generation regrowth')
    expect(formatResourcePressureSegments(summary).slice(-3)).toEqual(['Target + budget update at generation boundaries', "Rounded budget → that generation's replacement food pulse", 'No within-generation regrowth'])
    expect(line).not.toContain('Patch stock 20/40')
  })

  it('uses explicit finite formatting and a complete readable summary', () => {
    expect(formatResourceValue(1.25)).toBe('1.3')
    expect(formatResourceValue(-1)).toBe('unavailable')
    expect(formatResourceValue(Number.NaN)).toBe('unavailable')
    expect(formatResourceRatio(.125)).toBe('13%')
    expect(formatResourceRatio(Number.POSITIVE_INFINITY)).toBe('unavailable')
    const line = formatResourcePressureLine(summarizeResourcePressure(pressure()))
    expect(line).toContain('Current food 20')
    expect(line).toContain('Budget scales configured regrowth')
    expect(line).toContain('Capacity and caps can limit additions')
    expect(line).toContain('Food also changes through eating, regrowth, and live shocks')
  })

  it('renders both ecology modes with the resource line before accounting', () => {
    const advanced = createWorld({ ...defaultConfig, initialPopulation: 1 })
    const classic = createWorld({ ...defaultConfig, ...CLASSIC_MODES, initialPopulation: 1 })
    const advancedMarkup = renderToStaticMarkup(createElement(GenerationAccounting, { world: advanced, globalFoodCap: 180 }))
    const classicMarkup = renderToStaticMarkup(createElement(GenerationAccounting, { world: classic, globalFoodCap: 180 }))
    expect(advancedMarkup.indexOf('Resource pressure')).toBeLessThan(advancedMarkup.indexOf('Generation accounting'))
    expect(advancedMarkup).toContain('Budget scales configured regrowth')
    expect(advancedMarkup).toContain('role="group" aria-labelledby="resource-pressure-title"')
    expect(advancedMarkup).not.toContain('aria-label="Resource pressure.')
    expect(classicMarkup).toContain('Patch capacity inactive')
    expect(classicMarkup).toContain('replacement food pulse')
  })
})
