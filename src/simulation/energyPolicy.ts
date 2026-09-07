import type {Config,Creature} from './types'

/** Rest saves locomotion, not the baseline energy cost paid by active creatures. */
export const restingEnergyRate=(c:Creature,cfg:Config)=>.08+cfg.senseEnergyFactor*c.sense*8

/** Ecological days permit a center-and-back trip; classic keeps its original scale. */
export const movementScale=(cfg:Config)=>cfg.ecologyMode==='energy-regrowth'?.055:.038

export const homeTravelTime=(c:Creature,cfg:Config)=>Math.hypot(c.x-c.homeX,c.y-c.homeY)/Math.max(.001,movementScale(cfg)*c.speed)
/** Share the same travel safety allowance between leaving shelter and returning. */
export const homeReturnBudget=(c:Creature,cfg:Config)=>homeTravelTime(c,cfg)*1.2+.5

/**
 * Leave shelter below one starting reserve. This fixed hunger threshold can
 * actually be crossed as metabolism consumes energy during a rest.
 * Return voluntarily only above the reproductive reserve (behavior.ts), giving
 * an energy gap between leaving and returning without additional saved state.
 * Reserve a quarter-day for a useful new trip in addition to the current return
 * allowance. This keeps slow actors near the shelter boundary from waking just
 * as their next decision would send them straight home again.
 */
export function shouldLeaveHome(c:Creature,cfg:Config,time:number){
  const remaining=Math.max(0,cfg.dayLength-time)
  return remaining>homeReturnBudget(c,cfg)+cfg.dayLength*.25&&c.energy<cfg.startingEnergy
}
