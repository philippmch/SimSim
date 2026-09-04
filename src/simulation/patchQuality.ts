import { clamp, keyedRandom } from './random'

/**
 * Patch quality is an intrinsic, deterministic signal.  It is deliberately
 * separate from the mutable simulation RNG so adding the mechanic cannot
 * perturb creature, obstacle, or food placement trajectories.
 */
export const PATCH_QUALITY_RANDOM_NAMESPACE = 'resource.patch-quality.bias.v1'

/** Return a bounded quality bias, treating old or malformed snapshots as neutral. */
export function safePatchQualityBias(value:unknown){
  return typeof value==='number'&&Number.isFinite(value)?clamp(value,-1,1):0
}

/** Return a bounded quality variation, treating old or malformed configs as disabled. */
export function safePatchQualityVariation(value:unknown){
  return typeof value==='number'&&Number.isFinite(value)?clamp(value,0,1):0
}

/**
 * Convert an intrinsic bias and configured variation into a patch multiplier.
 * At variation 0 this is exactly 1, preserving legacy trajectories.
 */
export function patchQualityMultiplier(bias:unknown,variation:unknown){
  return 1+safePatchQualityVariation(variation)*safePatchQualityBias(bias)
}

/** A stateless raw signal in [-1, 1), keyed only by seed and patch identity. */
export function rawPatchQualitySignal(seed:number,patchId:number){
  return keyedRandom(seed,PATCH_QUALITY_RANDOM_NAMESPACE,patchId)*2-1
}

/**
 * Generate reproducible biases for a set of patch IDs.  Centering and
 * max-absolute normalization makes the generated landscape have no aggregate
 * quality drift while still guaranteeing visible contrast whenever the raw
 * draws differ.
 */
export function createPatchQualityBiases(seed:number,patchIds:readonly number[]){
  const ids=[...new Set(patchIds.filter(id=>Number.isFinite(id)))].sort((a,b)=>a-b)
  const raw=ids.map(id=>({id,value:rawPatchQualitySignal(seed,id)}))
  if(raw.length<2)return new Map(raw.map(item=>[item.id,0]))
  const mean=raw.reduce((sum,item)=>sum+item.value,0)/raw.length
  const centered=raw.map(item=>({id:item.id,value:item.value-mean}))
  const maxAbs=Math.max(...centered.map(item=>Math.abs(item.value)))
  if(!(maxAbs>0)||!Number.isFinite(maxAbs))return new Map(ids.map(id=>[id,0]))
  return new Map(centered.map(item=>[item.id,item.value/maxAbs]))
}

/** Add deterministic biases without mutating the source patch records. */
export function withPatchQualityBiases<T extends {id:number}>(seed:number,patches:readonly T[]):(T&{qualityBias:number})[]{
  const biases=createPatchQualityBiases(seed,patches.map(patch=>patch.id))
  return patches.map(patch=>({...patch,qualityBias:biases.get(patch.id)??0}))
}

/** Scale an advanced food item while keeping malformed base values harmless. */
export function patchFoodEnergy(baseEnergy:unknown,bias:unknown,variation:unknown){
  const base=typeof baseEnergy==='number'&&Number.isFinite(baseEnergy)?Math.max(0,baseEnergy):0
  return base*patchQualityMultiplier(bias,variation)
}
