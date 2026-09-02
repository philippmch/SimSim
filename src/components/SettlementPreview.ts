import { MAX_POPULATION } from '../simulation/config'
import { settleLifecycle, type LifecycleOutcomeCause } from '../simulation/lifecycle'
import type { World } from '../simulation/types'

export const FORECAST_LOSS_CAUSES = ['hunted', 'energy', 'unfed', 'late', 'aged'] as const satisfies readonly Exclude<LifecycleOutcomeCause, 'survived'>[]
export type ForecastLossCause = (typeof FORECAST_LOSS_CAUSES)[number]
export const FORECAST_LOSS_LABELS: Record<ForecastLossCause, string> = {
  hunted: 'Hunted',
  energy: 'Energy depleted',
  unfed: 'No food at settlement',
  late: 'Missed return deadline',
  aged: 'Old age',
}

export type SelectedSettlementReproductionStatus = 'admitted' | 'eligible-capacity-blocked' | 'immature' | 'not-eligible'

/**
 * Scalar, read-only settlement facts for one individual. Keeping this
 * projection separate from World means the lazy inspector never needs the
 * whole cohort (or a mutable creature collection) to explain its outcome.
 */
export interface SelectedSettlementPreview {
  individualId: number
  generation: number
  mode: World['config']['ecologyMode']
  outcome: LifecycleOutcomeCause
  /** Age at the current settlement boundary; reproduction uses this value. */
  currentAge?: number | null
  nextAge: number | null
  /** Fresh energy runs use this threshold; legacy snapshots fall back to zero. */
  maturityAge?: number
  retainedEnergy: number | null
  settledEnergy: number | null
  /** Null in classic mode, where food—not retained energy—controls reproduction. */
  energyEligible?: boolean | null
  /** Null in classic mode; true means the current age has reached the threshold. */
  maturityEligible?: boolean | null
  reproductionStatus: SelectedSettlementReproductionStatus
  foodAtSettlement: number
  reproductionCost: number
  eligibleParentCount: number
  availableBirthSlots: number
}

const finiteNonNegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0
const safeNonnegativeInteger = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null

/**
 * Project the exact lifecycle settlement for a selected individual. The
 * underlying policy is run for the complete cohort so admission and capacity
 * competition remain authoritative; settleLifecycle is pure and keyed, so it
 * does not consume World.rngState.
 */
export function summarizeSelectedSettlementPreview(world: World, individualId: number | null | undefined): SelectedSettlementPreview | null {
  if (typeof individualId !== 'number' || !Number.isSafeInteger(individualId) || individualId < 1) return null
  // Keep the optional field explicit so snapshots from before the maturity
  // rule still follow the lifecycle's compatibility fallback of zero.
  const policy = { ...world.config, maturityAge: safeNonnegativeInteger((world.config as World['config'] & { maturityAge?: unknown }).maturityAge) ?? 0 }
  const settlement = settleLifecycle(world.creatures, policy, {
    seed: world.config.seed,
    generation: world.generation,
    maxPopulation: MAX_POPULATION,
  })
  const outcome = settlement.outcomes.find(item => item.individual.individualId === individualId)
  if (!outcome) return null
  const survivor = settlement.survivors.find(item => item.individual.individualId === individualId)
  const currentAge = safeNonnegativeInteger(outcome.individual.age)
  const maturityAge = world.config.ecologyMode === 'classic' ? 0 : policy.maturityAge
  const retainedEnergy = survivor?.retainedEnergy ?? null
  const energyEligible = world.config.ecologyMode === 'classic'
    ? null
    : retainedEnergy !== null && retainedEnergy > finiteNonNegative(world.config.reproductionEnergyCost)
  const maturityEligible = world.config.ecologyMode === 'classic'
    ? null
    : currentAge !== null && currentAge >= maturityAge
  const ageImmature = currentAge !== null && currentAge < maturityAge
  const reproductionStatus: SelectedSettlementReproductionStatus = !survivor?.reproductionEligible
    ? energyEligible && ageImmature ? 'immature' : 'not-eligible'
    : survivor.birthAdmitted ? 'admitted' : 'eligible-capacity-blocked'
  return {
    individualId,
    generation: world.generation,
    mode: settlement.mode,
    outcome: outcome.cause,
    currentAge,
    nextAge: survivor?.nextAge ?? null,
    maturityAge,
    retainedEnergy,
    settledEnergy: survivor?.settledEnergy ?? null,
    energyEligible,
    maturityEligible,
    reproductionStatus,
    foodAtSettlement: finiteNonNegative(outcome.individual.food),
    reproductionCost: finiteNonNegative(world.config.reproductionEnergyCost),
    eligibleParentCount: settlement.eligibleParents.length,
    availableBirthSlots: settlement.availableBirthSlots,
  }
}
