import { describe, expect, it } from 'vitest'
import {
  formatFoodAccounting,
  formatGenerationAccountingAriaLabel,
  summarizeGenerationAccounting,
  type GenerationAccountingInput,
} from './GenerationAccounting'

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
  dayPreyConsumed: 0,
  ...overrides,
})

describe('generation accounting', () => {
  it('recognizes a balanced generation with zero combat', () => {
    const summary = summarizeGenerationAccounting(counters())
    expect(summary).toMatchObject({ expectedFood: 42, currentFood: 42, foodBalanced: true, attackAttempts: 0, attackSuccesses: 0, attackFailures: 0, attackContested: 0, preyConsumed: 0 })
    expect(formatFoodAccounting(summary)).toContain('= 42 current · balanced')
    expect(formatGenerationAccountingAriaLabel(1, summary)).toContain('0 attack attempts, 0 successes, 0 failures, 0 threshold claim collisions, 0 prey consumed')
  })

  it('balances drought, bloom, and regrowth-style food counters', () => {
    const summary = summarizeGenerationAccounting(counters({ generationFoodStart: 10, dayFoodProduced: 8, dayFoodRemoved: 3, dayFoodConsumed: 5, foodCount: 10, dayAttackAttempts: 4, dayAttackSuccesses: 2, dayAttackFailures: 2, dayPreyConsumed: 2 }))
    expect(summary.expectedFood).toBe(10)
    expect(summary.foodBalanced).toBe(true)
    expect(formatFoodAccounting(summary)).toBe('10 start + 8 added/grown − 3 removed − 5 consumed = 10 current · balanced')
    expect(formatGenerationAccountingAriaLabel(2, summary)).toContain('4 attack attempts, 2 successes, 2 failures, 0 threshold claim collisions, 2 prey consumed')
  })

  it('flags mismatched counters instead of asserting a false balance', () => {
    const summary = summarizeGenerationAccounting(counters({ generationFoodStart: 10, dayFoodProduced: 2, dayFoodRemoved: 1, dayFoodConsumed: 1, foodCount: 9 }))
    expect(summary).toMatchObject({ expectedFood: 10, currentFood: 9, foodBalanced: false })
    expect(formatFoodAccounting(summary)).toContain('= 9 current · expected 10 · check counters')
    expect(formatGenerationAccountingAriaLabel(3, summary)).toContain('Food counters do not balance')
  })

  it('accounts for threshold claims rejected when attackers contest one prey', () => {
    const summary = summarizeGenerationAccounting(counters({ dayAttackAttempts: 2, dayAttackSuccesses: 1, dayAttackFailures: 0, dayPreyConsumed: 1 }))
    expect(summary).toMatchObject({ attackAttempts: 2, attackSuccesses: 1, attackFailures: 0, attackContested: 1, preyConsumed: 1 })
    expect(formatGenerationAccountingAriaLabel(4, summary)).toContain('1 threshold claim collision')
  })

  it('does not claim contest-mode collision data that the world counters do not retain', () => {
    const summary = summarizeGenerationAccounting(counters({ predationMode: 'contest', dayAttackAttempts: 1, dayAttackSuccesses: 1, dayAttackFailures: 0, dayPreyConsumed: 1 }))
    expect(summary.attackContested).toBeNull()
    expect(formatGenerationAccountingAriaLabel(5, summary)).not.toContain('collision')
  })
})
