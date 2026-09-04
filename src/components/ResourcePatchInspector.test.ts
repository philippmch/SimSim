import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultConfig } from '../simulation/config'
import { createWorld } from '../simulation/engine'
import { effectiveFoodRegrowthRate } from '../simulation/environment'
import { patchFoodEnergy, patchQualityMultiplier } from '../simulation/patchQuality'
import type { World } from '../simulation/types'
import {
  ResourcePatchInspector,
  formatResourcePatchCurrentEnergy,
  formatResourcePatchOrdinal,
  formatResourcePatchProgress,
  formatResourcePatchQuality,
  formatResourcePatchStatus,
  summarizeResourcePatch,
} from './ResourcePatchInspector'

const makeWorld = (overrides: Partial<typeof defaultConfig> = {}): World => createWorld({ ...defaultConfig, initialPopulation: 1, foodPerDay: 42, ...overrides })

describe('resource patch inspector summary', () => {
  it('derives live count and energy from world.food rather than patch stock', () => {
    const world = makeWorld({ patchCapacity: 10, foodRegrowthRate: .2, patchQualityVariation: .5 })
    const patch = world.environment.patches[0]
    patch.stock = 999
    world.food = [
      { id: 901, x: patch.x, y: patch.y, patchId: patch.id, energy: 5 },
      { id: 902, x: patch.x, y: patch.y, patchId: patch.id, energy: 7 },
      { id: 903, x: .1, y: .1, patchId: null, energy: 100 },
    ]
    const summary = summarizeResourcePatch(world, patch.id)!
    const multiplier = patchQualityMultiplier(patch.qualityBias, world.config.patchQualityVariation)
    expect(summary.ordinal).toBe(1)
    expect(summary.currentFoodCount).toBe(2)
    expect(summary.capacity).toBe(10)
    expect(summary.fillRatio).toBe(.2)
    expect(summary.currentTotalFoodEnergy).toBe(12)
    expect(summary.currentAverageFoodEnergy).toBe(6)
    expect(summary.newlyProducedItemEnergy).toBe(patchFoodEnergy(world.config.foodEnergy, patch.qualityBias, world.config.patchQualityVariation))
    expect(summary.potentialRegrowthPerGeneration).toBeCloseTo(10 * effectiveFoodRegrowthRate(world.environment, world.config) * multiplier, 12)
    expect(summary.patchFull).toBe(false)
    expect(summary.globalFoodCapBlocked).toBe(false)
    expect(formatResourcePatchQuality(summary)).toContain('×')
  })

  it('reports deterministic accumulator progress and full/global blocking', () => {
    const world = makeWorld({ patchCapacity: 2, foodRegrowthRate: .2 })
    const patch = world.environment.patches[0]
    patch.accumulator = .375
    world.food = [
      { id: 910, x: patch.x, y: patch.y, patchId: patch.id, energy: 22 },
      { id: 911, x: patch.x, y: patch.y, patchId: patch.id, energy: 22 },
    ]
    const summary = summarizeResourcePatch(world, patch.id)!
    expect(summary.nextItemAccumulator).toBe(.375)
    expect(summary.nextItemProgress).toBe(.375)
    expect(summary.patchFull).toBe(true)
    expect(summary.blocked).toBe(true)
    expect(formatResourcePatchProgress(summary)).toContain('Production is currently blocked')
    expect(formatResourcePatchStatus(summary)).toContain('patch is full')

    world.food = Array.from({ length: 180 }, (_, index) => ({ id: 1000 + index, x: patch.x, y: patch.y, patchId: patch.id, energy: 22 }))
    const capped = summarizeResourcePatch(world, patch.id)!
    expect(capped.globalFoodCapBlocked).toBe(true)
    expect(formatResourcePatchStatus(capped)).toContain('global food safety cap')
  })

  it('distinguishes an empty patch from food with zero energy', () => {
    const world = makeWorld()
    const patch = world.environment.patches[0]
    world.food = world.food.filter(food => food.patchId !== patch.id)
    const summary = summarizeResourcePatch(world, patch.id)!
    expect(summary.currentFoodCount).toBe(0)
    expect(summary.currentTotalFoodEnergy).toBe(0)
    expect(summary.currentAverageFoodEnergy).toBeNull()
    expect(formatResourcePatchCurrentEnergy(summary)).toBe('0 total · no current food')
    expect(renderToStaticMarkup(createElement(ResourcePatchInspector, { world, selectedPatchId: patch.id, onClose: () => {} }))).toContain('0 total · no current food')
  })

  it('uses explicit classic wording and never treats patch stock as live', () => {
    const world = makeWorld({ ecologyMode: 'classic' })
    const patch = world.environment.patches[0]
    patch.stock = 999
    world.food = [{ id: 920, x: patch.x, y: patch.y, patchId: patch.id, energy: 22 }]
    const summary = summarizeResourcePatch(world, patch.id)!
    expect(summary.qualityCategory).toBe('inactive')
    expect(summary.qualityMultiplier).toBeNull()
    expect(summary.capacity).toBeNull()
    expect(summary.potentialRegrowthPerGeneration).toBeNull()
    expect(formatResourcePatchStatus(summary)).toContain('quality and within-generation regrowth are inactive')
    expect(formatResourcePatchStatus(summary)).toContain('patch stock is not treated as live')
    const markup = renderToStaticMarkup(createElement(ResourcePatchInspector, { world, selectedPatchId: patch.id, onClose: () => {} }))
    expect(markup).toContain('Classic mode: generation-pulse food')
    expect(markup).toContain('Inactive in classic mode')
    expect(markup).not.toContain('999')
    expect(markup).not.toContain('Patch stock 999')
  })

  it('stays finite and quiet for malformed records or missing selections', () => {
    const world = makeWorld()
    const patch = world.environment.patches[0]
    patch.accumulator = Number.NaN
    patch.qualityBias = Number.POSITIVE_INFINITY
    world.config.patchCapacity = Number.NaN
    world.config.foodEnergy = Number.NaN
    world.food = [{ id: 930, x: patch.x, y: patch.y, patchId: patch.id, energy: Number.NaN }]
    const summary = summarizeResourcePatch(world, patch.id)!
    expect(summary.currentTotalFoodEnergy).toBeNull()
    expect(summary.currentAverageFoodEnergy).toBeNull()
    expect(summary.nextItemProgress).toBeNull()
    expect(summary.capacity).toBeNull()
    expect(summary.newlyProducedItemEnergy).toBeNull()
    expect(formatResourcePatchProgress(summary)).toContain('unavailable')
    expect(renderToStaticMarkup(createElement(ResourcePatchInspector, { world, selectedPatchId: 999999, onClose: () => {} }))).toBe('')
  })
})

describe('resource patch inspector markup helpers', () => {
  it('keeps ordinal labels user-facing and avoids internal identifiers', () => {
    expect(formatResourcePatchOrdinal(2)).toBe('Resource patch 2')
    expect(formatResourcePatchOrdinal(Number.NaN)).toBe('Resource patch')
  })
})
