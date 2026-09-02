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

export type SelectedSettlementReproductionStatus = 'admitted' | 'eligible-capacity-blocked' | 'not-eligible'

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
  nextAge: number | null
  retainedEnergy: number | null
  settledEnergy: number | null
  reproductionStatus: SelectedSettlementReproductionStatus
  foodAtSettlement: number
  reproductionCost: number
  eligibleParentCount: number
  availableBirthSlots: number
}

const finiteNonNegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0

/**
 * Project the exact lifecycle settlement for a selected individual. The
 * underlying policy is run for the complete cohort so admission and capacity
 * competition remain authoritative; settleLifecycle is pure and keyed, so it
 * does not consume World.rngState.
 */
export function summarizeSelectedSettlementPreview(world: World, individualId: number | null | undefined): SelectedSettlementPreview | null {
  if (typeof individualId !== 'number' || !Number.isSafeInteger(individualId) || individualId < 1) return null
  const settlement = settleLifecycle(world.creatures, world.config, {
    seed: world.config.seed,
    generation: world.generation,
    maxPopulation: MAX_POPULATION,
  })
  const outcome = settlement.outcomes.find(item => item.individual.individualId === individualId)
  if (!outcome) return null
  const survivor = settlement.survivors.find(item => item.individual.individualId === individualId)
  const reproductionStatus: SelectedSettlementReproductionStatus = !survivor?.reproductionEligible
    ? 'not-eligible'
    : survivor.birthAdmitted ? 'admitted' : 'eligible-capacity-blocked'
  return {
    individualId,
    generation: world.generation,
    mode: settlement.mode,
    outcome: outcome.cause,
    nextAge: survivor?.nextAge ?? null,
    retainedEnergy: survivor?.retainedEnergy ?? null,
    settledEnergy: survivor?.settledEnergy ?? null,
    reproductionStatus,
    foodAtSettlement: finiteNonNegative(outcome.individual.food),
    reproductionCost: finiteNonNegative(world.config.reproductionEnergyCost),
    eligibleParentCount: settlement.eligibleParents.length,
    availableBirthSlots: settlement.availableBirthSlots,
  }
}
