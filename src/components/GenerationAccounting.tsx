import type { AttackAttemptBasis, FoodPatch, World } from '../simulation/types'

export interface ResourcePressureInput {
  ecologyMode: World['config']['ecologyMode']
  currentFood: number
  targetFood: number
  foodBudget: number
  patches: ReadonlyArray<Pick<FoodPatch, 'stock'>> | null | undefined
  configuredPatchCount?: number
  patchCapacity: number
  globalFoodCap: number
}

export interface ResourcePressureSummary {
  ecologyMode: World['config']['ecologyMode']
  currentFood: number | null
  targetFood: number | null
  foodBudget: number | null
  actualPatchCount: number | null
  configuredPatchCount: number | null
  patchStock: number | null
  patchCapacity: number | null
  effectiveCapacity: number | null
  globalFoodCap: number | null
  patchStockReconciles: boolean | null
  patchStockRatio: number | null
}

function nonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function formatResourceValue(value: number | null | undefined, decimals = 1): string {
  const safe = nonnegative(value)
  return safe === null ? 'unavailable' : safe.toFixed(decimals)
}

export function formatResourceCount(value: number | null | undefined): string {
  const safe = nonnegative(value)
  return safe === null ? 'unavailable' : String(Math.round(safe))
}

export function formatResourceRatio(value: number | null | undefined): string {
  const safe = nonnegative(value)
  return safe === null ? 'unavailable' : `${Math.round(safe * 100)}%`
}

/**
 * Summarize live resource pressure without treating seasonal controls as
 * current stock. Patch stock is trusted only when it is complete and adds up
 * to the current food count.
 */
export function summarizeResourcePressure(input: ResourcePressureInput): ResourcePressureSummary {
  const currentFood = nonnegative(input.currentFood)
  const targetFood = nonnegative(input.targetFood)
  const foodBudget = nonnegative(input.foodBudget)
  const patchCapacity = nonnegative(input.patchCapacity)
  const globalFoodCap = nonnegative(input.globalFoodCap)
  const patches = Array.isArray(input.patches) ? input.patches : null
  const actualPatchCount = patches ? patches.length : null
  const configuredPatchCount = nonnegative(input.configuredPatchCount)
  const stocks = patches?.map(patch => nonnegative(patch?.stock)) ?? null
  const validStocks = stocks !== null && stocks.every(stock => stock !== null)
  const patchStock = validStocks ? stocks.reduce((sum, stock) => sum + stock!, 0) : null
  const effectiveCapacity = actualPatchCount !== null && patchCapacity !== null && globalFoodCap !== null
    ? Math.min(actualPatchCount * patchCapacity, globalFoodCap)
    : null
  const patchStockReconciles = patchStock === null || currentFood === null ? null : Math.abs(patchStock - currentFood) < 1e-9
  const patchStockRatio = patchStock !== null && patchStockReconciles === true && effectiveCapacity !== null && effectiveCapacity > 0
    ? patchStock / effectiveCapacity
    : null
  return { ecologyMode: input.ecologyMode, currentFood, targetFood, foodBudget, actualPatchCount, configuredPatchCount, patchStock, patchCapacity, effectiveCapacity, globalFoodCap, patchStockReconciles, patchStockRatio }
}

export function formatResourcePressureSegments(summary: ResourcePressureSummary): string[] {
  const current = formatResourceCount(summary.currentFood)
  const target = formatResourceValue(summary.targetFood)
  const budget = formatResourceValue(summary.foodBudget)
  const actualPatches = formatResourceCount(summary.actualPatchCount)
  const configuredPatches = formatResourceCount(summary.configuredPatchCount)
  const patches = summary.actualPatchCount !== null && summary.configuredPatchCount !== null
    ? summary.actualPatchCount === summary.configuredPatchCount
      ? `${actualPatches} patches (configured ${configuredPatches})`
      : `${actualPatches} actual / ${configuredPatches} configured patches`
    : `${actualPatches} actual patches · configured ${configuredPatches}`
  const cap = `global cap ${formatResourceCount(summary.globalFoodCap)}`
  if (summary.ecologyMode === 'classic') {
    return [`Current food ${current}`, `Seasonal target ${target}`, `Supply budget ${budget}`, patches, 'Patch capacity inactive', cap, 'Target + budget update at generation boundaries', "Rounded budget → that generation's replacement food pulse", 'No within-generation regrowth']
  }
  const patchStock = formatResourceCount(summary.patchStock)
  const effectiveCapacity = formatResourceCount(summary.effectiveCapacity)
  const stock = summary.patchStock === null
    ? 'Patch stock unavailable'
    : summary.patchStockReconciles === false
      ? `Patch stock ${patchStock} does not match ${current} current food`
      : summary.patchStockReconciles === null
        ? `Patch stock ${patchStock}; reconciliation unavailable`
        : summary.effectiveCapacity === null
          ? `Patch stock ${patchStock}; effective capacity unavailable`
          : summary.effectiveCapacity === 0
            ? `Patch stock ${patchStock}/0 (no capacity)`
            : `Patch stock ${patchStock}/${effectiveCapacity} (${formatResourceRatio(summary.patchStockRatio)})`
  return [`Current food ${current}`, `Seasonal target ${target}`, `Supply budget ${budget}`, patches, stock, `Capacity ${formatResourceCount(summary.patchCapacity)}/patch`, `Effective capacity ${effectiveCapacity}`, cap, 'Target + budget update at generation boundaries', 'Budget scales configured regrowth', 'Capacity and caps can limit additions', 'Food also changes through eating, regrowth, and live shocks']
}

export function formatResourcePressureLine(summary: ResourcePressureSummary): string {
  return formatResourcePressureSegments(summary).join(' · ')
}

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

export interface GenerationAccountingProps {
  world: World
  /** Passed by App to keep the accounting chunk independent of config imports. */
  globalFoodCap: number
}

export function GenerationAccounting({ world, globalFoodCap }: GenerationAccountingProps) {
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
  const pressure = summarizeResourcePressure({
    ecologyMode: world.config.ecologyMode,
    currentFood: world.food.length,
    targetFood: world.environment.targetFood,
    foodBudget: world.environment.foodBudget,
    patches: world.environment.patches,
    configuredPatchCount: world.config.foodPatchCount,
    patchCapacity: world.config.patchCapacity,
    globalFoodCap,
  })
  return <>
    <div className="ecology-line activity-line" role="group" aria-labelledby="resource-pressure-title">
      <strong id="resource-pressure-title">Resource pressure</strong>{formatResourcePressureSegments(pressure).map((segment,index)=><span key={`${index}-${segment}`}>{segment}</span>)}
    </div>
    <div className="ecology-line activity-line" role="group" aria-label={formatGenerationAccountingAriaLabel(world.generation, summary)}>
      <strong>Generation accounting</strong>
      <span>Food: <b>{summary.foodStart}</b> start</span><span>+ <b>{summary.foodAdded}</b> added/grown</span><span>− <b>{summary.foodRemoved}</b> removed</span><span>− <b>{summary.foodConsumed}</b> consumed</span><span>= <b>{summary.currentFood}</b> current · {summary.foodBalanced?'balanced':<>expected <b>{summary.expectedFood}</b> · check counters</>}</span>
      <span>{summary.attackBasis==='claims'?'Attack claims':'Resolved attacks'}: <b>{summary.attackAttempts}</b></span><span>= <b>{summary.attackSuccesses}</b> {summary.attackSuccesses===1?'success':'successes'}</span><span>+ <b>{summary.attackFailures}</b> {summary.attackFailures===1?'failure':'failures'}</span><span>{summary.attackBasis==='claims'?'+ ':''}<b>{summary.attackContested}</b> {summary.attackContested===1?'contested same-prey claim':'contested same-prey claims'}{summary.attackBasis==='admitted'?' excluded before resolution':''}</span><span><b>{summary.preyConsumed}</b> prey consumed</span>
    </div>
  </>
}

export default GenerationAccounting
