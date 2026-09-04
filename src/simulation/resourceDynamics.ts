import { clamp,keyedRandom } from './random'
import {patchQualityMultiplier,safePatchQualityBias,safePatchQualityVariation} from './patchQuality'

export type ResourceEcologyMode='classic'|'energy-regrowth'

export interface ResourcePatchSpec{
  id:number
  x:number
  y:number
  stock?:number
  accumulator?:number
  spawnSequence?:number
  /** Intrinsic patch signal; absent legacy records are neutral. */
  qualityBias?:number
}

export interface ResourcePatchState{
  id:number
  x:number
  y:number
  stock:number
  accumulator:number
  spawnSequence:number
  /** Optional on legacy live worlds; normalized state creation fills 0. */
  qualityBias?:number
}

export interface ResourceDynamicsState{patches:ResourcePatchState[]}

export interface ResourcePolicy{
  ecologyMode:ResourceEcologyMode
  patchCapacity:number
  foodRegrowthRate:number
  foodPatchSpread:number
  maxFood:number
  /** Optional for callers/configurations predating patch quality. */
  patchQualityVariation?:number
}

export interface ResourceStep{
  seed:number
  generation:number
  dt:number
  generationDuration:number
  /** Actual number of food items in the world before this step. */
  currentFoodCount:number
}

export interface ResourcePlacementSpec{
  patchId:number
  spawnSequence:number
  x:number
  y:number
}

export interface ResourceAdvance{
  branch:'classic-pulse'|'regrowth'
  state:ResourceDynamicsState
  placements:ResourcePlacementSpec[]
  foodCount:number
}

const nonNegative=(value:number)=>Number.isFinite(value)?Math.max(0,value):0
const whole=(value:number)=>Math.trunc(nonNegative(value))
const clonePatch=(patch:ResourcePatchState):ResourcePatchState=>({...patch})

export function createResourceDynamicsState(patches:readonly ResourcePatchSpec[]):ResourceDynamicsState{
  return{patches:[...patches].sort((a,b)=>a.id-b.id).map(patch=>({
    id:patch.id,x:clamp(patch.x,0,1),y:clamp(patch.y,0,1),stock:whole(patch.stock??0),
    accumulator:nonNegative(patch.accumulator??0),spawnSequence:whole(patch.spawnSequence??0),
    qualityBias:safePatchQualityBias(patch.qualityBias),
  }))}
}

interface SpawnCandidate{patchId:number;time:number;sequence:number;priority:number}

function placement(seed:number,generation:number,patch:ResourcePatchState,sequence:number,spread:number):ResourcePlacementSpec{
  const angle=keyedRandom(seed,'resource.placement.angle.v1',generation,patch.id,sequence)*Math.PI*2
  const radius=Math.sqrt(keyedRandom(seed,'resource.placement.radius.v1',generation,patch.id,sequence))*nonNegative(spread)
  return{patchId:patch.id,spawnSequence:sequence,
    x:clamp(patch.x+Math.cos(angle)*radius,.02,.98),y:clamp(patch.y+Math.sin(angle)*radius,.02,.98)}
}

/**
 * Advances resource regrowth without touching World RNG. Classic mode intentionally
 * plans no within-generation placements so the existing generation pulse remains exact.
 */
export function advanceResourceDynamics(state:ResourceDynamicsState,policy:ResourcePolicy,step:ResourceStep):ResourceAdvance{
  const patches=state.patches.map(clonePatch).sort((a,b)=>a.id-b.id)
  const currentFoodCount=whole(step.currentFoodCount)
  if(policy.ecologyMode==='classic')return{branch:'classic-pulse',state:{patches},placements:[],foodCount:currentFoodCount}

  const dt=nonNegative(step.dt),duration=Math.max(Number.EPSILON,nonNegative(step.generationDuration))
  const capacity=whole(policy.patchCapacity),globalLimit=whole(policy.maxFood)
  const basePerPatchRate=capacity*nonNegative(policy.foodRegrowthRate)/duration
  const variation=safePatchQualityVariation(policy.patchQualityVariation)
  const candidates:SpawnCandidate[]=[]
  for(const patch of patches){
    if(patch.stock>=capacity){patch.accumulator=0;continue}
    // Whole backlog represents production that was blocked previously and is discarded.
    const before=patch.accumulator%1
    const perPatchRate=variation===0?basePerPatchRate:basePerPatchRate*patchQualityMultiplier(patch.qualityBias,variation)
    const generated=perPatchRate*dt
    const total=before+generated
    const patchSlots=Math.max(0,capacity-patch.stock)
    const generatedWhole=Math.floor(total+1e-12)
    const due=Math.min(patchSlots,generatedWhole)
    const remainder=Math.max(0,total-generatedWhole)
    // Unequal floating-point rates otherwise retain ~1e-15 slicing noise.
    // Canonicalize only the new quality branch; variation 0 keeps the exact
    // pre-v6 accumulator arithmetic used by legacy trajectories.
    patch.accumulator=variation===0?remainder:Number(remainder.toFixed(12))
    for(let index=0;index<due;index++){
      const threshold=index+1
      const time=perPatchRate>0?Math.max(0,(threshold-before)/perPatchRate):0
      const sequence=patch.spawnSequence+index
      candidates.push({patchId:patch.id,time,sequence,
        priority:keyedRandom(step.seed,'resource.recruitment.v1',step.generation,patch.id,sequence)})
    }
    patch.spawnSequence+=due
  }
  candidates.sort((a,b)=>a.time-b.time||a.priority-b.priority||a.patchId-b.patchId||a.sequence-b.sequence)
  const byId=new Map(patches.map(patch=>[patch.id,patch]))
  const placements:ResourcePlacementSpec[]=[]
  let slots=Math.max(0,globalLimit-currentFoodCount)
  for(const candidate of candidates){
    if(slots<=0)break
    const patch=byId.get(candidate.patchId)!
    if(patch.stock>=capacity)continue
    placements.push(placement(step.seed,step.generation,patch,candidate.sequence,policy.foodPatchSpread))
    patch.stock++;slots--
  }
  for(const patch of patches)if(patch.stock>=capacity)patch.accumulator=0
  return{branch:'regrowth',state:{patches},placements,foodCount:currentFoodCount+placements.length}
}

/** Records consumption without mutation; callers can use a placement's patchId. */
export function consumeResourceStock(state:ResourceDynamicsState,patchId:number,count=1):ResourceDynamicsState{
  let remaining=whole(count)
  return{patches:state.patches.map(patch=>{
    if(patch.id!==patchId||remaining===0)return clonePatch(patch)
    const removed=Math.min(patch.stock,remaining);remaining-=removed
    return{...patch,stock:patch.stock-removed}
  }).sort((a,b)=>a.id-b.id)}
}
