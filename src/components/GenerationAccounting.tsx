import type { AttackAttemptBasis, World } from '../simulation/types'

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
  dayAttackContested: number
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
  attackBasis: AttackAttemptBasis
  attackSuccesses: number
  attackFailures: number
  attackContested: number
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
    attackBasis: world.predationMode === 'threshold' ? 'claims' : 'admitted',
    attackSuccesses: world.dayAttackSuccesses,
    attackFailures: world.dayAttackFailures,
    attackContested: world.dayAttackContested,
    preyConsumed: world.dayPreyConsumed,
  }
}

export function formatContestedClaims(count: number): string {
  return `${count} contested same-prey ${count === 1 ? 'claim' : 'claims'}`
}

export function formatAttackAccounting(summary: GenerationAccountingSummary): string {
  const outcomes = `${summary.attackSuccesses} ${summary.attackSuccesses === 1 ? 'success' : 'successes'} + ${summary.attackFailures} ${summary.attackFailures === 1 ? 'failure' : 'failures'}`
  return summary.attackBasis === 'claims'
    ? `${summary.attackAttempts} total claims = ${outcomes} + ${formatContestedClaims(summary.attackContested)}`
    : `${summary.attackAttempts} resolved attempts = ${outcomes}; ${formatContestedClaims(summary.attackContested)} excluded before resolution`
}

export function formatFoodAccounting(summary: GenerationAccountingSummary): string {
  const equation = `${summary.foodStart} start + ${summary.foodAdded} added/grown − ${summary.foodRemoved} removed − ${summary.foodConsumed} consumed = ${summary.currentFood} current`
  return summary.foodBalanced ? `${equation} · balanced` : `${equation} · expected ${summary.expectedFood} · check counters`
}

export function formatGenerationAccountingAriaLabel(generation: number, summary: GenerationAccountingSummary): string {
  const balance = summary.foodBalanced ? 'Food counters balance.' : `Food counters do not balance; expected ${summary.expectedFood} but current food is ${summary.currentFood}. Check the counters.`
  return `Generation ${generation} accounting. Food: ${formatFoodAccounting(summary)}. ${balance} Combat: ${formatAttackAccounting(summary)}. ${summary.preyConsumed} prey consumed.`
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
    dayAttackContested: world.dayAttackContested,
    dayPreyConsumed: world.dayPreyConsumed,
  })
  return <div className="ecology-line activity-line" role="group" aria-label={formatGenerationAccountingAriaLabel(world.generation, summary)}>
    <strong>Generation accounting</strong>
    <span>Food: <b>{summary.foodStart}</b> start</span><span>+ <b>{summary.foodAdded}</b> added/grown</span><span>− <b>{summary.foodRemoved}</b> removed</span><span>− <b>{summary.foodConsumed}</b> consumed</span><span>= <b>{summary.currentFood}</b> current · {summary.foodBalanced?'balanced':<>expected <b>{summary.expectedFood}</b> · check counters</>}</span>
    <span>{summary.attackBasis==='claims'?'Attack claims':'Resolved attacks'}: <b>{summary.attackAttempts}</b></span><span>= <b>{summary.attackSuccesses}</b> {summary.attackSuccesses===1?'success':'successes'}</span><span>+ <b>{summary.attackFailures}</b> {summary.attackFailures===1?'failure':'failures'}</span><span>{summary.attackBasis==='claims'?'+ ':''}<b>{summary.attackContested}</b> {summary.attackContested===1?'contested same-prey claim':'contested same-prey claims'}{summary.attackBasis==='admitted'?' excluded before resolution':''}</span><span><b>{summary.preyConsumed}</b> prey consumed</span>
  </div>
}
