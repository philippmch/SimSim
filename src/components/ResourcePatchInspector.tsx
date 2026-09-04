import { MAX_FOOD } from '../simulation/config'
import { effectiveFoodRegrowthRate } from '../simulation/environment'
import { patchFoodEnergy, patchQualityMultiplier, safePatchQualityVariation } from '../simulation/patchQuality'
import type { Config, Food, FoodPatch, World } from '../simulation/types'
import { resourcePatchOrdinal } from './ResourcePatchPresentation'

type EcologyMode = Config['ecologyMode']
type PatchRecord = Pick<FoodPatch, 'id' | 'x' | 'y' | 'stock' | 'accumulator' | 'qualityBias'>

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nonnegative = (value: unknown): number | null => finite(value) && value >= 0 ? value : null

function safePatchCapacity(value: unknown): number | null {
  if (!finite(value) || value < 0) return null
  return Math.min(MAX_FOOD, Math.trunc(value))
}

function safePatchAccumulator(value: unknown): number | null {
  if (!finite(value) || value < 0) return null
  const fraction = value % 1
  return Math.max(0, Math.min(.999999999999, fraction))
}

function safeFoodList(world: World): Food[] {
  return Array.isArray(world?.food) ? world.food : []
}

function safePatchList(world: World): PatchRecord[] {
  return Array.isArray(world?.environment?.patches) ? world.environment.patches as PatchRecord[] : []
}

function safeEffectiveRate(world: World): number | null {
  try {
    const rate = effectiveFoodRegrowthRate(world.environment, world.config)
    return finite(rate) ? Math.max(0, rate) : null
  } catch {
    return null
  }
}

export type ResourcePatchQualityCategory = 'poor' | 'typical' | 'rich' | 'uniform' | 'inactive'

export interface ResourcePatchSummary {
  ordinal: number | null
  ecologyMode: EcologyMode
  qualityCategory: ResourcePatchQualityCategory
  qualityMultiplier: number | null
  currentFoodCount: number
  capacity: number | null
  fillRatio: number | null
  currentTotalFoodEnergy: number | null
  currentAverageFoodEnergy: number | null
  validFoodEnergyCount: number
  newlyProducedItemEnergy: number | null
  potentialRegrowthPerGeneration: number | null
  nextItemAccumulator: number | null
  nextItemProgress: number | null
  patchFull: boolean
  globalFoodCapBlocked: boolean
  blocked: boolean
}

/** User-facing ordinal formatting never reveals the internal patch identity. */
export function formatResourcePatchOrdinal(ordinal: unknown): string {
  return typeof ordinal === 'number' && Number.isSafeInteger(ordinal) && ordinal > 0
    ? `Resource patch ${ordinal}`
    : 'Resource patch'
}

export function formatResourcePatchNumber(value: unknown, digits = 1): string {
  if (!finite(value)) return 'unavailable'
  const safe = Math.max(0, value)
  const precision = Number.isSafeInteger(digits) && digits >= 0 && digits <= 20 ? digits : 1
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(precision)
}

export function formatResourcePatchPercent(value: unknown): string {
  if (!finite(value)) return 'unavailable'
  return `${Math.max(0, Math.min(100, value * 100)).toFixed(0)}%`
}

export function formatResourcePatchQualityCategory(category: ResourcePatchQualityCategory): string {
  if (category === 'rich') return 'Rich patch'
  if (category === 'poor') return 'Poor patch'
  if (category === 'uniform') return 'Uniform quality'
  if (category === 'inactive') return 'Inactive in classic mode'
  return 'Typical patch'
}

export function formatResourcePatchQuality(summary: Pick<ResourcePatchSummary, 'qualityCategory' | 'qualityMultiplier'>): string {
  const category = formatResourcePatchQualityCategory(summary.qualityCategory)
  return summary.qualityMultiplier === null
    ? category
    : `${category} · ${formatResourcePatchNumber(summary.qualityMultiplier, 2)}×`
}

export function formatResourcePatchCurrentEnergy(summary: Pick<ResourcePatchSummary, 'currentFoodCount' | 'currentTotalFoodEnergy' | 'currentAverageFoodEnergy'>): string {
  if (summary.currentFoodCount === 0) return '0 total · no current food'
  return `${formatResourcePatchNumber(summary.currentTotalFoodEnergy, 1)} total · ${formatResourcePatchNumber(summary.currentAverageFoodEnergy, 1)} average`
}

export function formatResourcePatchProgress(summary: Pick<ResourcePatchSummary, 'ecologyMode' | 'nextItemAccumulator' | 'nextItemProgress' | 'blocked'>): string {
  if (summary.ecologyMode === 'classic') return 'Inactive in classic mode.'
  if (summary.nextItemAccumulator === null || summary.nextItemProgress === null) return 'Accumulator unavailable.'
  const progress = `Accumulator ${formatResourcePatchNumber(summary.nextItemAccumulator, 2)}/1.00 · ${formatResourcePatchPercent(summary.nextItemProgress)} toward the next item.`
  return summary.blocked ? `${progress} Production is currently blocked.` : progress
}

export function formatResourcePatchStatus(summary: Pick<ResourcePatchSummary, 'ecologyMode' | 'patchFull' | 'globalFoodCapBlocked' | 'blocked' | 'potentialRegrowthPerGeneration'>): string {
  if (summary.ecologyMode === 'classic') return 'Classic mode: generation-pulse food; patch quality and within-generation regrowth are inactive; patch stock is not treated as live.'
  if (summary.patchFull && summary.globalFoodCapBlocked) return 'Blocked: this patch is full and the global food safety cap is reached.'
  if (summary.patchFull) return 'Blocked: this patch is full; eating can open capacity again.'
  if (summary.globalFoodCapBlocked) return 'Blocked: the global food safety cap is reached; eating can open room again.'
  if (summary.potentialRegrowthPerGeneration === null || summary.potentialRegrowthPerGeneration <= 0) return 'Paused: no positive regrowth potential is configured for this generation.'
  return 'Available: this patch can regrow until its capacity or the global food safety cap blocks additions.'
}

function qualityCategory(ecologyMode: EcologyMode, variation: number, multiplier: number): ResourcePatchQualityCategory {
  if (ecologyMode === 'classic') return 'inactive'
  if (variation === 0) return 'uniform'
  if (multiplier <= .9) return 'poor'
  if (multiplier >= 1.1) return 'rich'
  return 'typical'
}

/**
 * Derive a patch's live inspector facts from the current world. In particular,
 * food count and energy come from world.food; patch.stock is never presented as
 * the live item count here.
 */
export function summarizeResourcePatch(world: World, selectedPatchId: number | null): ResourcePatchSummary | null {
  if (!world || typeof selectedPatchId !== 'number' || !Number.isFinite(selectedPatchId)) return null
  const patches = safePatchList(world)
  const patch = patches.find(candidate => candidate && candidate.id === selectedPatchId)
  if (!patch) return null
  const ecologyMode = world.config?.ecologyMode === 'energy-regrowth' ? 'energy-regrowth' : 'classic'
  const variation = ecologyMode === 'energy-regrowth' ? safePatchQualityVariation(world.config?.patchQualityVariation) : 0
  const multiplier = patchQualityMultiplier(patch.qualityBias, variation)
  const ordinal = resourcePatchOrdinal(patches, selectedPatchId)
  const matchingFood = safeFoodList(world).filter(food => food && food.patchId === selectedPatchId)
  const energies = matchingFood.map(food => nonnegative(food.energy)).filter((energy): energy is number => energy !== null)
  const rawTotal = energies.length > 0 ? energies.reduce((sum, energy) => sum + energy, 0) : 0
  const total = matchingFood.length === 0 ? 0 : energies.length > 0 && finite(rawTotal) ? rawTotal : null
  const average = total !== null && energies.length > 0 ? total / energies.length : null
  const capacity = ecologyMode === 'energy-regrowth' ? safePatchCapacity(world.config?.patchCapacity) : null
  const fillRatio = capacity !== null && capacity > 0 ? matchingFood.length / capacity : null
  const patchFull = capacity !== null && matchingFood.length >= capacity
  const globalFoodCount = safeFoodList(world).length
  const globalFoodCapBlocked = globalFoodCount >= MAX_FOOD
  const configuredFoodEnergy = nonnegative(world.config?.foodEnergy)
  const newlyProducedItemEnergy = ecologyMode === 'energy-regrowth'
    ? configuredFoodEnergy === null ? null : patchFoodEnergy(configuredFoodEnergy, patch.qualityBias, variation)
    : patchFoodEnergy(22, 0, 0)
  const effectiveRate = ecologyMode === 'energy-regrowth' ? safeEffectiveRate(world) : null
  const potential = effectiveRate !== null && capacity !== null
    ? capacity * effectiveRate * multiplier
    : null
  const nextItemAccumulator = ecologyMode === 'energy-regrowth' ? safePatchAccumulator(patch.accumulator) : null
  const nextItemProgress = nextItemAccumulator
  const blocked = ecologyMode === 'energy-regrowth' && (patchFull || globalFoodCapBlocked)
  return {
    ordinal,
    ecologyMode,
    qualityCategory: qualityCategory(ecologyMode, variation, multiplier),
    qualityMultiplier: ecologyMode === 'energy-regrowth' ? multiplier : null,
    currentFoodCount: matchingFood.length,
    capacity,
    fillRatio,
    currentTotalFoodEnergy: total,
    currentAverageFoodEnergy: average,
    validFoodEnergyCount: energies.length,
    newlyProducedItemEnergy: finite(newlyProducedItemEnergy) ? newlyProducedItemEnergy : null,
    potentialRegrowthPerGeneration: finite(potential) ? Math.max(0, potential) : null,
    nextItemAccumulator,
    nextItemProgress,
    patchFull,
    globalFoodCapBlocked,
    blocked,
  }
}

export interface ResourcePatchInspectorProps {
  world: World
  selectedPatchId: number | null
  onClose: () => void
}

export function ResourcePatchInspector({ world, selectedPatchId, onClose }: ResourcePatchInspectorProps) {
  const summary = summarizeResourcePatch(world, selectedPatchId)
  if (!summary) return null
  const patchLabel = formatResourcePatchOrdinal(summary.ordinal)
  const quality = formatResourcePatchQuality(summary)
  const causalChain = summary.ecologyMode === 'energy-regrowth'
    ? 'Quality multiplier → regrowth pace and new-item energy → the food value creatures compare and receive when they collect it.'
    : 'Classic mode uses generation-pulse food. Patch quality and within-generation regrowth are inactive; patch stock is not treated as live.'
  return <section className="inspector" aria-label={`${patchLabel} inspector`}>
    <div className="inspector-head"><div><h2>{patchLabel}</h2><p>{quality}</p></div><button type="button" onClick={onClose} aria-label="Close resource patch inspector">×</button></div>
    <div className="utility-breakdown" role="note"><strong>How this patch affects the run</strong><span>{causalChain}</span></div>
    <div className="inspector-grid"><dl style={{ gridColumn: '1/-1' }}>
      <div><dt>Quality</dt><dd>{quality}</dd></div>
      <div><dt>Current food</dt><dd>{summary.ecologyMode === 'energy-regrowth' && summary.capacity !== null ? `${formatResourcePatchNumber(summary.currentFoodCount, 0)} / ${formatResourcePatchNumber(summary.capacity, 0)}` : `${formatResourcePatchNumber(summary.currentFoodCount, 0)} attributed items`}</dd></div>
      <div><dt>Fill</dt><dd>{summary.ecologyMode === 'classic' ? 'Inactive in classic mode' : formatResourcePatchPercent(summary.fillRatio)}</dd></div>
      <div><dt>Current energy</dt><dd>{formatResourcePatchCurrentEnergy(summary)}</dd></div>
      <div><dt>New item energy</dt><dd>{formatResourcePatchNumber(summary.newlyProducedItemEnergy, 1)}{summary.ecologyMode === 'classic' ? ' fixed pulse energy' : ''}</dd></div>
      <div><dt>Potential regrowth / generation</dt><dd>{summary.ecologyMode === 'classic' ? 'Inactive in classic mode' : `${formatResourcePatchNumber(summary.potentialRegrowthPerGeneration, 1)} items`}</dd></div>
      <div><dt>Next item</dt><dd>{formatResourcePatchProgress(summary)}</dd></div>
      <div><dt>Status</dt><dd>{formatResourcePatchStatus(summary)}</dd></div>
    </dl></div>
    {summary.ecologyMode === 'energy-regrowth' && summary.validFoodEnergyCount < summary.currentFoodCount && <p className="utility-breakdown" role="note">Some current food energy values are unavailable; totals exclude malformed values.</p>}
  </section>
}

export default ResourcePatchInspector
