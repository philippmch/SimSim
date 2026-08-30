import {SIMULATION_TIMESTEP,tick} from './engine'
import type {World} from './types'
export const MAX_TICKS_PER_PULSE=8
export function scheduledTicks(elapsed:number,speed:number,remainder=0){const total=Math.max(0,elapsed)*speed+remainder,count=Math.min(MAX_TICKS_PER_PULSE,Math.floor(total/SIMULATION_TIMESTEP));return{count,remainder:total-count*SIMULATION_TIMESTEP}}
export function runScheduled(world:World,count:number){for(let i=0;i<count;i++)tick(world,SIMULATION_TIMESTEP)}

/**
 * A manual action step is intentionally bounded.  The extra two ticks cover
 * floating-point edge cases at a reaction boundary and a final boundary tick.
 */
export function nextActionMaxTicks(reactionTime:number){
  if(!Number.isFinite(reactionTime)||reactionTime<=0)return 1
  return Math.max(1,Math.ceil(reactionTime/SIMULATION_TIMESTEP)+2)
}

export type NextActionStop='beat'|'generation-boundary'|'no-active'|'bounded'
export interface NextActionResult{ticks:number;stop:NextActionStop}
export interface NextActionContext{selectedIndividualId:number|null;selectedWasActive:boolean}

/** Capture the inspected creature state at the exact start of a manual step. */
export function captureNextActionContext(world:World):NextActionContext{
  const selectedIndividualId=world.inspectedIndividualId
  const selected=selectedIndividualId===null?undefined:world.creatures.find(creature=>creature.individualId===selectedIndividualId)
  return{selectedIndividualId,selectedWasActive:Boolean(selected?.alive&&!selected.home)}
}

/**
 * Advance to the next decision beat without consuming wall-clock time.
 *
 * In realistic mode, decisions are held until the next reaction window.  A
 * creature with the initial -1 marker is the special case: one tick captures
 * its first window.  Perfect perception and zero reaction time are explicitly
 * one-tick actions.  The generation guard prevents a boundary reset from
 * immediately being treated as another next-window target.
 */
export function advanceToNextAction(world:World):NextActionResult{
  const active=()=>world.creatures.filter(creature=>creature.alive&&!creature.home)
  const initial=active()
  if(!initial.length)return{ticks:0,stop:'no-active'}

  const reactionTime=world.config.reactionTime
  const startingGeneration=world.generation
  if(world.config.perceptionMode==='perfect'||!Number.isFinite(reactionTime)||reactionTime<=0){
    tick(world,SIMULATION_TIMESTEP)
    return{ticks:1,stop:world.generation===startingGeneration?'beat':'generation-boundary'}
  }

  const initialWindow=Math.max(...initial.map(creature=>creature.reactionWindow))
  const targetWindow=initialWindow<0?0:initialWindow+1
  const maxTicks=nextActionMaxTicks(reactionTime)
  let ticks=0
  while(ticks<maxTicks&&world.generation===startingGeneration){
    tick(world,SIMULATION_TIMESTEP)
    ticks++
    if(world.generation!==startingGeneration)return{ticks,stop:'generation-boundary'}
    const remaining=active()
    if(!remaining.length)return{ticks,stop:'no-active'}
    if(remaining.every(creature=>creature.reactionWindow>=targetWindow))return{ticks,stop:'beat'}
  }
  return{ticks,stop:'bounded'}
}
