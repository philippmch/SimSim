import type { World } from '../simulation/types'

export interface GenerationAccountingInput {
  predationMode: World['config']['predationMode']
  generationFoodStart: number
  dayFoodProduced: number
  dayFoodRemoved: number
  dayFoodConsumed: number
  foodCount: number
  dayAttackAttempts: number
  dayAttackSuccesses: number
  dayAttackFailures: number
  dayPreyConsumed: number
}

export interface GenerationAccountingSummary {
  foodStart: number
  foodAdded: number
  foodRemoved: number
  foodConsumed: number
  expectedFood: number
  currentFood: number
  foodBalanced: boolean
  attackAttempts: number
  attackSuccesses: number
  attackFailures: number
  attackContested: number | null
  preyConsumed: number
}

export function summarizeGenerationAccounting(world: GenerationAccountingInput): GenerationAccountingSummary {
  const foodStart = world.generationFoodStart
  const foodAdded = world.dayFoodProduced
  const foodRemoved = world.dayFoodRemoved
  const foodConsumed = world.dayFoodConsumed
  const expectedFood = foodStart + foodAdded - foodRemoved - foodConsumed
  const currentFood = world.foodCount
  return {
    foodStart,
    foodAdded,
    foodRemoved,
    foodConsumed,
    expectedFood,
    currentFood,
    foodBalanced: expectedFood === currentFood,
    attackAttempts: world.dayAttackAttempts,
    attackSuccesses: world.dayAttackSuccesses,
    attackFailures: world.dayAttackFailures,
    attackContested: world.predationMode === 'threshold' ? Math.max(0, world.dayAttackAttempts - world.dayAttackSuccesses - world.dayAttackFailures) : null,
    preyConsumed: world.dayPreyConsumed,
  }
}

export function formatFoodAccounting(summary: GenerationAccountingSummary): string {
  const equation = `${summary.foodStart} start + ${summary.foodAdded} added/grown − ${summary.foodRemoved} removed − ${summary.foodConsumed} consumed = ${summary.currentFood} current`
  return summary.foodBalanced ? `${equation} · balanced` : `${equation} · expected ${summary.expectedFood} · check counters`
}

export function formatGenerationAccountingAriaLabel(generation: number, summary: GenerationAccountingSummary): string {
  const balance = summary.foodBalanced ? 'Food counters balance.' : `Food counters do not balance; expected ${summary.expectedFood} but current food is ${summary.currentFood}. Check the counters.`
  const contested = summary.attackContested===null ? '' : `, ${summary.attackContested} threshold claim ${summary.attackContested===1?'collision':'collisions'}`
  return `Generation ${generation} accounting. Food: ${formatFoodAccounting(summary)}. ${balance} Combat: ${summary.attackAttempts} attack attempts, ${summary.attackSuccesses} successes, ${summary.attackFailures} failures${contested}, ${summary.preyConsumed} prey consumed.`
}

export function GenerationAccounting({ world }: { world: World }) {
  const summary = summarizeGenerationAccounting({
    predationMode: world.config.predationMode,
    generationFoodStart: world.generationFoodStart,
    dayFoodProduced: world.dayFoodProduced,
    dayFoodRemoved: world.dayFoodRemoved,
    dayFoodConsumed: world.dayFoodConsumed,
    foodCount: world.food.length,
    dayAttackAttempts: world.dayAttackAttempts,
    dayAttackSuccesses: world.dayAttackSuccesses,
    dayAttackFailures: world.dayAttackFailures,
    dayPreyConsumed: world.dayPreyConsumed,
  })
  return <div className="ecology-line activity-line" role="group" aria-label={formatGenerationAccountingAriaLabel(world.generation, summary)}>
    <strong>Generation accounting</strong>
    <span>Food: <b>{summary.foodStart}</b> start</span><span>+ <b>{summary.foodAdded}</b> added/grown</span><span>− <b>{summary.foodRemoved}</b> removed</span><span>− <b>{summary.foodConsumed}</b> consumed</span><span>= <b>{summary.currentFood}</b> current · {summary.foodBalanced?'balanced':<>expected <b>{summary.expectedFood}</b> · check counters</>}</span>
    <span>Attacks: <b>{summary.attackAttempts}</b> attempts</span><span><b>{summary.attackSuccesses}</b> successes</span><span><b>{summary.attackFailures}</b> failures</span>{summary.attackContested!==null&&<span><b>{summary.attackContested}</b> threshold claim {summary.attackContested===1?'collision':'collisions'}</span>}<span><b>{summary.preyConsumed}</b> prey consumed</span>
  </div>
}
