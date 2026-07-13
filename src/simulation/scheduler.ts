import {SIMULATION_TIMESTEP,tick} from './engine'
import type {World} from './types'
export const MAX_TICKS_PER_PULSE=8
export function scheduledTicks(elapsed:number,speed:number,remainder=0){const total=Math.max(0,elapsed)*speed+remainder,count=Math.min(MAX_TICKS_PER_PULSE,Math.floor(total/SIMULATION_TIMESTEP));return{count,remainder:total-count*SIMULATION_TIMESTEP}}
export function runScheduled(world:World,count:number){for(let i=0;i<count;i++)tick(world,SIMULATION_TIMESTEP)}
