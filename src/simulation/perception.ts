import type {Config,Creature,Food,Obstacle} from './types'
import {hasLineOfSight,isWithinFieldOfView} from './geometry'
import {clamp,distance,keyedRandom} from './random'

export type PerceptionRejectReason='range'|'fov'|'occlusion'|'detection'
export interface PerceptionCounts{total:number;detected:number;range:number;fov:number;occlusion:number;detection:number}
export interface PerceptionDiagnostics{
  mode:Config['perceptionMode']
  reactionWindow:number
  creatures:PerceptionCounts
  food:PerceptionCounts
}
export interface PerceptionResult{
  /** Includes the observer when it was present in the creature input. */
  creatures:readonly Creature[]
  food:readonly Food[]
  diagnostics:PerceptionDiagnostics
}

const emptyCounts=(total:number):PerceptionCounts=>({total,detected:0,range:0,fov:0,occlusion:0,detection:0})
const stableById=<T extends{id:number}>(items:readonly T[])=>[...items].sort((a,b)=>a.id-b.id)

/**
 * Probability of detecting an in-range target. Falloff is linear from certainty
 * at the observer to `1 - detectionFalloff` at the edge of sense range.
 */
export function detectionProbability(targetDistance:number,senseRange:number,detectionFalloff:number){
  if(!Number.isFinite(targetDistance)||targetDistance<0||!Number.isFinite(senseRange)||senseRange<=0)return 0
  if(targetDistance>senseRange)return 0
  const normalized=clamp(targetDistance/senseRange,0,1)
  const falloff=Number.isFinite(detectionFalloff)?clamp(detectionFalloff,0,1):0
  return clamp(1-falloff*normalized,0,1)
}

/** A non-zero reaction time holds stochastic detections stable for a time window. */
export function reactionWindowFor(reactionTime:number,tickIndex:number,dayTime:number){
  if(Number.isFinite(reactionTime)&&reactionTime>0)return Math.max(0,Math.floor(Math.max(0,dayTime)/reactionTime+1e-9))
  return Math.max(0,Math.trunc(Number.isFinite(tickIndex)?tickIndex:0))
}

function rejectReason(observer:Creature,target:{x:number;y:number},obstacles:readonly Obstacle[],config:Config):PerceptionRejectReason|null{
  const d=distance(observer,target)
  if(d>observer.sense)return'range'
  if(!isWithinFieldOfView(observer,target,observer.angle,config.fieldOfView))return'fov'
  if(config.obstacleOcclusion&&!hasLineOfSight(observer,target,obstacles))return'occlusion'
  return null
}

/**
 * Build the observer's local inputs from canonical, stable-id-ordered arrays.
 *
 * The engine already has a two-phase creature snapshot and can share one
 * ordered food snapshot across every observer in a tick. Keeping this core
 * separate avoids repeating the defensive copy/sort work for each observer.
 * Callers must not pass arrays whose order can change during this call.
 */
export function perceiveCanonical(observer:Creature,creatures:readonly Creature[],food:readonly Food[],obstacles:readonly Obstacle[],config:Config,generation:number,tickIndex:number,dayTime:number):PerceptionResult{
  const otherCount=creatures.reduce((count,creature)=>count+(creature.id===observer.id?0:1),0)
  const reactionWindow=reactionWindowFor(config.reactionTime,tickIndex,dayTime)
  const creatureCounts=emptyCounts(otherCount),foodCounts=emptyCounts(food.length)
  if(config.perceptionMode==='perfect'){
    creatureCounts.detected=otherCount;foodCounts.detected=food.length
    return{creatures,food,diagnostics:{mode:'perfect',reactionWindow,creatures:creatureCounts,food:foodCounts}}
  }

  const visibleCreatures:Creature[]=[],visibleFood:Food[]=[]
  for(const target of creatures){
    if(target.id===observer.id){visibleCreatures.push(target);continue}
    const rejected=rejectReason(observer,target,obstacles,config)
    if(rejected){creatureCounts[rejected]++;continue}
    const probability=detectionProbability(distance(observer,target),observer.sense,config.detectionFalloff)
    const draw=keyedRandom(config.seed,'perception-creature',generation,observer.individualId,target.individualId,reactionWindow)
    if(draw>=probability){creatureCounts.detection++;continue}
    creatureCounts.detected++;visibleCreatures.push(target)
  }
  for(const target of food){
    const rejected=rejectReason(observer,target,obstacles,config)
    if(rejected){foodCounts[rejected]++;continue}
    const probability=detectionProbability(distance(observer,target),observer.sense,config.detectionFalloff)
    const draw=keyedRandom(config.seed,'perception-food',generation,observer.individualId,target.id,reactionWindow)
    if(draw>=probability){foodCounts.detection++;continue}
    foodCounts.detected++;visibleFood.push(target)
  }
  return{creatures:visibleCreatures,food:visibleFood,diagnostics:{mode:'realistic',reactionWindow,creatures:creatureCounts,food:foodCounts}}
}

/**
 * Build the observer's local inputs without mutating inputs or consuming the
 * world's sequential RNG. Results are stable under source-array permutations.
 */
export function perceive(observer:Creature,creatures:readonly Creature[],food:readonly Food[],obstacles:readonly Obstacle[],config:Config,generation:number,tickIndex:number,dayTime:number):PerceptionResult{
  return perceiveCanonical(observer,stableById(creatures),stableById(food),obstacles,config,generation,tickIndex,dayTime)
}
