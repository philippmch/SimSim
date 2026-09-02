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

export type NextActionStop='beat'|'generation-boundary'|'no-active'|'selected-inactive'|'bounded'
/** Numeric cursor metadata for the activity records produced by one manual step. */
export interface NextActionActivityWindow{
  startSequence:number
  endSequence:number
  recordedCount:number
  sequenceReset:boolean
}
export interface NextActionResult{ticks:number;stop:NextActionStop;activity?:NextActionActivityWindow}
export interface NextActionContext{selectedIndividualId:number|null;selectedWasActive:boolean}
export interface NextActionStep{stepContext:NextActionContext;stepResult:NextActionResult}

/**
 * Return the strongest valid retained activity cursor.  The engine repairs
 * legacy worlds by reconciling activitySequence with retained entry
 * sequences, so a raw field read here could make an event window start too
 * early and include an intervention from before the manual step.
 */
function activitySequenceCursor(world:World){
  let cursor=Number.isSafeInteger(world.activitySequence)&&world.activitySequence>=0?world.activitySequence:0
  if(Array.isArray(world.activity))for(const entry of world.activity){
    const sequence=(entry as {sequence?:unknown}|null)?.sequence
    if(typeof sequence==='number'&&Number.isSafeInteger(sequence)&&sequence>cursor)cursor=sequence
  }
  return cursor
}

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

  // A selected active creature is the subject of a manual step. Other actors
  // may be in a later (or earlier) reaction window after an intervention such
  // as founder migration, so their windows must not hold the selected actor
  // back. An inspected creature that is already home/dead is intentionally
  // treated like no selection so the historical all-active behavior remains
  // unchanged.
  const selectedIndividualId=world.inspectedIndividualId
  const selected=selectedIndividualId===null?undefined:initial.find(creature=>creature.individualId===selectedIndividualId)
  const selectedWasActive=Boolean(selected)
  const selectedIsActive=()=>selectedWasActive&&active().some(creature=>creature.individualId===selectedIndividualId)
  const selectedBecameInactive=()=>{
    if(!selectedWasActive||selectedIsActive())return undefined
    return active().length?'selected-inactive':'no-active'
  }

  const reactionTime=world.config.reactionTime
  const startingGeneration=world.generation
  if(world.config.perceptionMode==='perfect'||!Number.isFinite(reactionTime)||reactionTime<=0){
    tick(world,SIMULATION_TIMESTEP)
    if(world.generation!==startingGeneration)return{ticks:1,stop:'generation-boundary'}
    const selectedStop=selectedBecameInactive()
    return{ticks:1,stop:selectedStop??'beat'}
  }

  const initialWindow=selected?selected.reactionWindow:Math.max(...initial.map(creature=>creature.reactionWindow))
  const targetWindow=initialWindow<0?0:initialWindow+1
  const maxTicks=nextActionMaxTicks(reactionTime)
  let ticks=0
  while(ticks<maxTicks&&world.generation===startingGeneration){
    tick(world,SIMULATION_TIMESTEP)
    ticks++
    if(world.generation!==startingGeneration)return{ticks,stop:'generation-boundary'}
    const remaining=active()
    if(!remaining.length)return{ticks,stop:'no-active'}
    const selectedStop=selectedBecameInactive()
    if(selectedStop)return{ticks,stop:selectedStop}
    if(selected){
      const current=remaining.find(creature=>creature.individualId===selectedIndividualId)
      if(current&&current.reactionWindow>=targetWindow)return{ticks,stop:'beat'}
    }else if(remaining.every(creature=>creature.reactionWindow>=targetWindow))return{ticks,stop:'beat'}
  }
  return{ticks,stop:'bounded'}
}

/**
 * Execute one explicit manual step and attach a primitive activity window.
 * Keep this separate from advanceToNextAction so existing simulation callers
 * retain its exact, compact result shape.
 *
 * A sequence reset can happen when the engine rebases a MAX_SAFE_INTEGER
 * activity cursor.  In that case a numeric range would be misleading, so
 * recordedCount is deliberately zero and consumers must honor sequenceReset.
 */
export function advanceToNextActionWithContext(world:World):NextActionStep{
  const stepContext=captureNextActionContext(world)
  const startSequence=activitySequenceCursor(world)
  const stepResult=advanceToNextAction(world)
  const endSequence=activitySequenceCursor(world)
  const sequenceReset=endSequence<startSequence
  const activity:NextActionActivityWindow={
    startSequence,
    endSequence,
    recordedCount:sequenceReset?0:endSequence-startSequence,
    sequenceReset,
  }
  return{stepContext,stepResult:{...stepResult,activity}}
}
