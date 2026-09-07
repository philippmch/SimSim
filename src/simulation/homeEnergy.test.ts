import {describe,expect,it} from 'vitest'
import {createWorld,defaultConfig,tick,SIMULATION_TIMESTEP,setInspectedIndividual} from './engine'
import {homeReturnBudget,movementScale,restingEnergyRate} from './energyPolicy'
import {advanceToNextAction,nextActionMaxTicks} from './scheduler'
import {encodeRun,decodeRun} from './checkpoint'
import {decide} from './behavior'
import {proposeMotion} from './motion'

const sheltered=()=>{
  const world=createWorld({...defaultConfig,initialPopulation:1,foodPerDay:0,foodRegrowthRate:0,obstacleCount:0})
  Object.assign(world.creatures[0],{home:true,returning:true,mode:'returning',energy:200})
  return world
}

describe('ecological shelter energy',()=>{
  it('charges stationary resting creatures the active non-movement baseline',()=>{
    const world=sheltered(),c=world.creatures[0],before={x:c.x,y:c.y,energy:c.energy}
    tick(world,SIMULATION_TIMESTEP)
    expect(c.home).toBe(true)
    expect([c.x,c.y]).toEqual([before.x,before.y])
    expect(c.energy).toBeCloseTo(before.energy-restingEnergyRate(c,world.config)*SIMULATION_TIMESTEP,12)
  })
  it('records an energy death at home once, including the inspected outcome',()=>{
    const world=sheltered(),c=world.creatures[0]
    world.dayTime=17;c.energy=.0001;setInspectedIndividual(world,c.individualId)
    tick(world,SIMULATION_TIMESTEP);tick(world,SIMULATION_TIMESTEP)
    expect(c.alive).toBe(false)
    expect(c.deathCause).toBe('energy')
    expect(world.activity.filter(e=>e.kind==='energy-death')).toHaveLength(1)
    expect(world.lastInspectedOutcome).toEqual({individualId:c.individualId,generation:1,cause:'energy'})
  })
  it('wakes hungry actors with fresh decisions and no immediate return loop',()=>{
    const world=sheltered(),c=world.creatures[0]
    Object.assign(c,{energy:50,reactionWindow:0,targetType:'home',targetX:c.homeX,targetY:c.homeY,commitUntil:10})
    for(let i=0;i<80;i++){
      tick(world,SIMULATION_TIMESTEP)
      expect(c.home).toBe(false)
      expect(c.returning).toBe(false)
      expect(c.targetType).not.toBe('home')
    }
    expect(Math.hypot(c.x-c.homeX,c.y-c.homeY)).toBeGreaterThan(.025)
    expect(c.reactionWindow).toBeGreaterThan(0)
  })
  it('abandons a hungry return while food is available, but honors dusk travel time',()=>{
    const world=sheltered(),c=world.creatures[0]
    Object.assign(c,{home:false,x:.5,y:.5,energy:5})
    const food={id:999,x:.51,y:.5,energy:22,patchId:null}
    expect(decide(c,[c],[food],world.config,0,0).mode).toBe('foraging')
    expect(decide(c,[c],[food],world.config,17,680).mode).toBe('returning')
  })
  it.each([0,SIMULATION_TIMESTEP/2,-SIMULATION_TIMESTEP/2])('keeps slow hungry shelter occupants resting near their return deadline (%s)',offset=>{
    const world=sheltered(),c=world.creatures[0]
    world.config.dayLength=5
    Object.assign(c,{speed:.3,homeX:.03,homeY:.5,x:.054,y:.5,energy:50})
    world.dayTime=world.config.dayLength-homeReturnBudget(c,world.config)+offset
    const before=c.energy
    for(let i=0;i<5;i++){
      tick(world,SIMULATION_TIMESTEP)
      expect(c.home).toBe(true)
      expect([c.x,c.y]).toEqual([.054,.5])
    }
    expect(c.energy).toBeCloseTo(before-restingEnergyRate(c,world.config)*SIMULATION_TIMESTEP*5,12)
    expect(world.activity.filter(e=>e.kind==='reached-home')).toHaveLength(0)
  })
  it('does not repeat home arrivals for a short day and slow creature at day 3.5',()=>{
    const world=sheltered(),c=world.creatures[0]
    world.config.dayLength=5;world.dayTime=3.5
    Object.assign(c,{speed:.3,homeX:.03,homeY:.5,x:.054,y:.5,energy:50})
    for(let i=0;i<5;i++)tick(world,SIMULATION_TIMESTEP)
    expect(c.home).toBe(true)
    expect(world.activity.filter(e=>e.kind==='reached-home')).toHaveLength(0)
  })
  it('keeps late hungry returners home while charging energy until settlement',()=>{
    const world=sheltered(),c=world.creatures[0]
    world.dayTime=world.config.dayLength*.8;c.energy=50
    const before=c.energy
    for(let i=0;i<20;i++)tick(world,SIMULATION_TIMESTEP)
    expect(c.home).toBe(true);expect(c.alive).toBe(true);expect(c.energy).toBeLessThan(before)
    world.dayTime=world.config.dayLength-SIMULATION_TIMESTEP
    expect(advanceToNextAction(world)).toEqual({ticks:1,stop:'generation-boundary'})
  })
  it('retains a well-fed homeward trip below the voluntary-return threshold',()=>{
    const world=sheltered(),c=world.creatures[0]
    Object.assign(c,{home:false,x:.5,y:.5,energy:140})
    const food={id:999,x:.51,y:.5,energy:22,patchId:null}
    expect(decide(c,[c],[food],world.config,0,0).mode).toBe('returning')
    c.returning=false
    expect(decide(c,[c],[food],world.config,0,0).mode).toBe('foraging')
  })
  it('uses the ecological travel scale without increasing the energy cost of a speed trait',()=>{
    const world=sheltered(),c=world.creatures[0]
    Object.assign(c,{home:false,returning:false,x:.5,y:.5,angle:0,vy:0,speed:1,wanderAngle:0})
    const ecological=world.config,classic={...ecological,ecologyMode:'classic' as const}
    const decision={...decide(c,[c],[],ecological,0,0),targetX:.9,targetY:.5,mode:'exploring' as const}
    const eco=proposeMotion({...c,vx:movementScale(ecological)},decision,ecological,[],SIMULATION_TIMESTEP)
    const old=proposeMotion({...c,vx:movementScale(classic)},decision,classic,[],SIMULATION_TIMESTEP)
    expect(eco.vx).toBe(.055);expect(old.vx).toBe(.038)
    expect(eco.energy).toBe(old.energy)
  })
  it('preserves free classic shelter and zero-tick all-home stepping',()=>{
    const world=sheltered();world.config.ecologyMode='classic'
    const c=world.creatures[0];c.energy=.001
    tick(world,SIMULATION_TIMESTEP)
    expect(c.energy).toBe(.001);expect(c.alive).toBe(true);expect(c.home).toBe(true)
    expect(advanceToNextAction(world)).toEqual({ticks:0,stop:'no-active'})
  })
  it('advances resting metabolism in a bounded action and reports waking or dying',()=>{
    const world=sheltered(),c=world.creatures[0],before=c.energy
    const result=advanceToNextAction(world)
    expect(result).toEqual({ticks:nextActionMaxTicks(world.config.reactionTime),stop:'resting'})
    expect(c.energy).toBeLessThan(before)
    c.energy=50
    expect(advanceToNextAction(world)).toEqual({ticks:1,stop:'beat'})
    c.home=true;c.energy=.0001;world.dayTime=17
    expect(advanceToNextAction(world)).toEqual({ticks:1,stop:'no-active'})
  })
  it('resumes a resting checkpoint identically including a later wake',()=>{
    const world=sheltered(),c=world.creatures[0]
    c.energy=world.config.startingEnergy+restingEnergyRate(c,world.config)*SIMULATION_TIMESTEP*2
    const restored=decodeRun(encodeRun(world)).world
    tick(world,SIMULATION_TIMESTEP);tick(restored,SIMULATION_TIMESTEP)
    expect(world.creatures[0].home).toBe(true)
    for(let i=0;i<30;i++){tick(world,SIMULATION_TIMESTEP);tick(restored,SIMULATION_TIMESTEP)}
    expect(JSON.parse(JSON.stringify(world))).toEqual(JSON.parse(JSON.stringify(restored)))
    expect(world.creatures[0].home).toBe(false)
  })
  it('keeps mixed resting, waking, and dying actors independent of array order',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:3,foodPerDay:0,foodRegrowthRate:0,obstacleCount:0})
    world.creatures.forEach((c,i)=>Object.assign(c,{home:true,returning:true,energy:[200,50,.0001][i]}))
    const reversed=structuredClone(world);reversed.creatures.reverse()
    for(let i=0;i<20;i++){tick(world,SIMULATION_TIMESTEP);tick(reversed,SIMULATION_TIMESTEP)}
    reversed.creatures.sort((a,b)=>a.id-b.id)
    expect(reversed).toEqual(world)
    expect(world.creatures.map(c=>[c.alive,c.home])).toEqual([[true,true],[true,false],[false,false]])
  })
  it.each([3045219,2187,42,12345])('keeps seed %i viable and feeding through ten generations',seed=>{
    const world=createWorld({...defaultConfig,seed})
    let sample:{alive:number;home:number;food:number;consumed:number}|undefined
    while(world.generation<=10){
      if(world.generation===9&&world.dayTime>=8.8&&!sample)sample={alive:world.creatures.filter(c=>c.alive).length,home:world.creatures.filter(c=>c.alive&&c.home).length,food:world.food.length,consumed:world.dayFoodConsumed}
      tick(world,SIMULATION_TIMESTEP)
    }
    expect(world.creatures.length).toBeGreaterThan(5)
    expect(sample!.home).toBeLessThan(sample!.alive/2)
    expect(sample!.consumed).toBeGreaterThan(5)
    expect(sample!.food).toBeLessThan(180)
    expect(world.ledger.slice(5).every(l=>l.foodConsumed>0)).toBe(true)
  })
})
