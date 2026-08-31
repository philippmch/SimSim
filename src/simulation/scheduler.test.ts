import {describe,expect,it} from 'vitest'
import {applyIntervention,createWorld,defaultConfig,setInspectedIndividual,SIMULATION_TIMESTEP} from './engine'
import {MAX_TICKS_PER_PULSE,advanceToNextAction,captureNextActionContext,nextActionMaxTicks,scheduledTicks} from './scheduler'

describe('bounded scheduler',()=>{
  it('preserves fixed-step remainder and caps a stalled pulse',()=>{
    const normal=scheduledTicks(.05,1)
    expect(normal.count).toBe(2)
    expect(normal.remainder).toBeCloseTo(0)
    const stalled=scheduledTicks(10,4)
    expect(stalled.count).toBe(MAX_TICKS_PER_PULSE)
    expect(stalled.remainder).toBeGreaterThan(SIMULATION_TIMESTEP)
  })

  it('captures an initial realistic reaction window with one tick',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1,foodPerDay:0,reactionTime:.15})
    const creature=world.creatures[0]
    expect(creature.reactionWindow).toBe(-1)
    const result=advanceToNextAction(world)
    expect(result).toEqual({ticks:1,stop:'beat'})
    expect(creature.reactionWindow).toBe(0)
    expect(world.tickIndex).toBe(1)
  })

  it('advances a held realistic decision to the next reaction window',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1,foodPerDay:0,reactionTime:.15})
    const creature=world.creatures[0]
    advanceToNextAction(world)
    const before=world.tickIndex
    const result=advanceToNextAction(world)
    expect(result.stop).toBe('beat')
    expect(result.ticks).toBeGreaterThan(0)
    expect(result.ticks).toBeLessThanOrEqual(nextActionMaxTicks(world.config.reactionTime))
    expect(world.tickIndex-before).toBe(result.ticks)
    expect(creature.reactionWindow).toBe(1)
  })

  it('advances exactly one fixed tick for perfect perception',()=>{
    const world=createWorld({...defaultConfig,perceptionMode:'perfect',initialPopulation:1,foodPerDay:0})
    const result=advanceToNextAction(world)
    expect(result).toEqual({ticks:1,stop:'beat'})
    expect(world.tickIndex).toBe(1)
  })

  it('advances exactly one fixed tick for zero reaction time',()=>{
    const world=createWorld({...defaultConfig,perceptionMode:'realistic',reactionTime:0,initialPopulation:1,foodPerDay:0})
    const result=advanceToNextAction(world)
    expect(result).toEqual({ticks:1,stop:'beat'})
    expect(world.tickIndex).toBe(1)
  })

  it('stops at a generation boundary instead of entering the next window',()=>{
    const world=createWorld({...defaultConfig,perceptionMode:'realistic',reactionTime:.15,initialPopulation:1,foodPerDay:0})
    const creature=world.creatures[0]
    creature.reactionWindow=0
    world.dayTime=world.config.dayLength-SIMULATION_TIMESTEP
    const generation=world.generation
    const result=advanceToNextAction(world)
    expect(result).toEqual({ticks:1,stop:'generation-boundary'})
    expect(world.generation).toBe(generation+1)
    expect(world.dayTime).toBe(0)
  })

  it('honors the strict bound when the requested window cannot be reached',()=>{
    const reactionTime=5
    const world=createWorld({...defaultConfig,perceptionMode:'realistic',reactionTime,initialPopulation:1,foodPerDay:0,dayLength:60})
    world.creatures[0].reactionWindow=10_000
    const result=advanceToNextAction(world)
    expect(result).toEqual({ticks:nextActionMaxTicks(reactionTime),stop:'bounded'})
    expect(result.ticks).toBe(Math.ceil(reactionTime/SIMULATION_TIMESTEP)+2)
  })

  it('returns without looping when there are no active or living creatures',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1,foodPerDay:0})
    world.creatures[0].home=true
    const before=structuredClone(world)
    expect(advanceToNextAction(world)).toEqual({ticks:0,stop:'no-active'})
    expect(world).toEqual(before)
    world.creatures[0].alive=false
    expect(advanceToNextAction(world)).toEqual({ticks:0,stop:'no-active'})
    world.creatures=[]
    expect(advanceToNextAction(world)).toEqual({ticks:0,stop:'no-active'})
  })

  it('captures the inspected individual and active state before a step',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1,foodPerDay:0})
    const creature=world.creatures[0]
    expect(captureNextActionContext(world)).toEqual({selectedIndividualId:null,selectedWasActive:false})
    setInspectedIndividual(world,creature.individualId)
    expect(captureNextActionContext(world)).toEqual({selectedIndividualId:creature.individualId,selectedWasActive:true})
    creature.home=true
    expect(captureNextActionContext(world)).toEqual({selectedIndividualId:creature.individualId,selectedWasActive:false})
  })

  it('refreshes deterministic selected decision and perception telemetry at each beat',()=>{
    const config={...defaultConfig,initialPopulation:2,foodPerDay:1,reactionTime:.15,fieldOfView:360,detectionFalloff:0,obstacleCount:0}
    const first=createWorld(config),second=createWorld(config)
    const selected=first.creatures[0],selectedCopy=second.creatures[0]
    setInspectedIndividual(first,selected.individualId)
    setInspectedIndividual(second,selectedCopy.individualId)
    const firstBeat=advanceToNextAction(first),secondBeat=advanceToNextAction(second)
    expect(firstBeat).toEqual(secondBeat)
    expect(selected.decisionSummary).toBeDefined()
    expect(selected.perceptionDiagnostics).toMatchObject({mode:'realistic',reactionWindow:0})
    const heldDecision=structuredClone(selected.decisionSummary)
    const nextBeat=advanceToNextAction(first)
    advanceToNextAction(second)
    expect(nextBeat.stop).toBe('beat')
    expect(selected.perceptionDiagnostics).toMatchObject({mode:'realistic',reactionWindow:1})
    expect(selected.decisionSummary).toEqual(selectedCopy.decisionSummary)
    expect(selected.perceptionDiagnostics).toEqual(selectedCopy.perceptionDiagnostics)
    expect(selected.decisionSummary).not.toBe(heldDecision)
  })

  it('steps an inspected founder migration on its own first reaction window',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0,reactionTime:.15})
    const established=world.creatures[0]
    established.reactionWindow=4
    expect(applyIntervention(world,'founder-migration')).toBeGreaterThan(0)
    const newcomer=world.creatures.at(-1)!
    setInspectedIndividual(world,newcomer.individualId)
    expect(newcomer.reactionWindow).toBe(-1)

    const result=advanceToNextAction(world)

    expect(result).toEqual({ticks:1,stop:'beat'})
    expect(newcomer.reactionWindow).toBe(0)
  })

  it('targets an inspected established creature instead of unrelated later windows',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:3,foodPerDay:0,reactionTime:.15})
    const [selected,unrelated,later]=world.creatures
    selected.reactionWindow=0
    unrelated.reactionWindow=8
    later.reactionWindow=8
    setInspectedIndividual(world,selected.individualId)

    const result=advanceToNextAction(world)

    expect(result.stop).toBe('beat')
    expect(result.ticks).toBe(7)
    expect(selected.reactionWindow).toBe(1)
  })

  it('reports selected home and death separately while other actors remain active',()=>{
    const homeWorld=createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0})
    const home=homeWorld.creatures[0]
    setInspectedIndividual(homeWorld,home.individualId)
    Object.assign(home,{x:home.homeX,y:home.homeY,returning:true,mode:'returning'})

    expect(advanceToNextAction(homeWorld)).toEqual({ticks:1,stop:'selected-inactive'})
    expect(home.home).toBe(true)
    expect(homeWorld.creatures.some(creature=>creature.alive&&!creature.home)).toBe(true)

    const deathWorld=createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0})
    const doomed=deathWorld.creatures[0]
    setInspectedIndividual(deathWorld,doomed.individualId)
    doomed.energy=0

    expect(advanceToNextAction(deathWorld)).toEqual({ticks:1,stop:'selected-inactive'})
    expect(doomed.alive).toBe(false)
    expect(deathWorld.creatures.some(creature=>creature.alive&&!creature.home)).toBe(true)
  })

  it('returns selected-inactive in perfect and zero-reaction paths',()=>{
    for(const overrides of [{perceptionMode:'perfect' as const,reactionTime:.15},{perceptionMode:'realistic' as const,reactionTime:0}]){
      const world=createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0,...overrides})
      const selected=world.creatures[0]
      setInspectedIndividual(world,selected.individualId)
      Object.assign(selected,{x:selected.homeX,y:selected.homeY,returning:true,mode:'returning'})

      expect(advanceToNextAction(world)).toEqual({ticks:1,stop:'selected-inactive'})
    }
  })

  it('keeps all-active scheduling when an inspected creature is not active',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:3,foodPerDay:0,reactionTime:.15})
    const [home,unrelated,later]=world.creatures
    home.home=true
    setInspectedIndividual(world,home.individualId)
    unrelated.reactionWindow=8
    later.reactionWindow=8

    const result=advanceToNextAction(world)

    expect(result).toEqual({ticks:nextActionMaxTicks(world.config.reactionTime),stop:'bounded'})
  })
})
