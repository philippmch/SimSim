import { describe, expect, it } from 'vitest'
import { buildInheritanceSummary, createWorld, defaultConfig, finishGeneration, getStats, runGeneration, scheduleDecision, setInspectedIndividual, SIMULATION_TIMESTEP, tick } from './engine'
import {CLASSIC_MODES, MAX_POPULATION} from './config'
import type { BiologicalTrait } from './types'

const traitValues=(speed:number,size:number,sense:number,aggression:number,caution:number,exploration:number):Record<BiologicalTrait,number>=>({speed,size,sense,aggression,caution,exploration})

describe('selection simulation', () => {
  it('starts every run, including a reset-created run, without an inspected outcome',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1})
    expect(world.lastInspectedOutcome).toBeNull()
    finishGeneration(world)
    const reset=createWorld(world.config)
    expect(reset.lastInspectedOutcome).toBeNull()
  })

  it('records an inspected energy death during the day before clearing inspection',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1,foodPerDay:0,obstacleCount:0})
    const inspected=world.creatures[0]
    inspected.energy=0
    setInspectedIndividual(world,inspected.individualId)
    tick(world,SIMULATION_TIMESTEP)

    expect(inspected).toMatchObject({alive:false,deathCause:'energy'})
    expect(world.inspectedIndividualId).toBeNull()
    expect(world.lastInspectedOutcome).toEqual({individualId:inspected.individualId,generation:1,cause:'energy'})
    tick(world,SIMULATION_TIMESTEP)
    expect(world.lastInspectedOutcome).toEqual({individualId:inspected.individualId,generation:1,cause:'energy'})
  })

  it('records an inspected hunted death during the day before clearing inspection',()=>{
    const world=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:3,foodPerDay:0,predatorRatio:1.2,obstacleCount:0})
    const [hunter,inspected]=world.creatures
    for(const creature of world.creatures){creature.x=.5;creature.y=.5;creature.sense=.5;creature.angle=0}
    hunter.size=2
    inspected.size=1
    setInspectedIndividual(world,inspected.individualId)
    tick(world,SIMULATION_TIMESTEP)

    expect(inspected).toMatchObject({alive:false,deathCause:'hunted'})
    expect(world.inspectedIndividualId).toBeNull()
    expect(world.lastInspectedOutcome).toEqual({individualId:inspected.individualId,generation:1,cause:'hunted'})
  })

  it('records each terminal generation cause for the inspected individual',()=>{
    const terminal=(cause:'hunted'|'energy'|'unfed'|'late'|'aged')=>{
      const world=createWorld({...defaultConfig,...(cause==='aged'?{}:CLASSIC_MODES),initialPopulation:1,foodPerDay:0,maxAge:1})
      const inspected=world.creatures[0]
      setInspectedIndividual(world,inspected.individualId)
      if(cause==='hunted'||cause==='energy'){inspected.alive=false;inspected.deathCause=cause}
      else if(cause==='unfed'){inspected.food=0;inspected.home=false}
      else if(cause==='late'){inspected.food=1;inspected.home=false}
      else{inspected.age=world.config.maxAge;inspected.home=true}
      finishGeneration(world)
      expect(world.inspectedIndividualId).toBeNull()
      expect(world.lastInspectedOutcome).toEqual({individualId:inspected.individualId,generation:1,cause})
    }

    for(const cause of ['hunted','energy','unfed','late','aged'] as const)terminal(cause)
  })

  it('keeps a survivor inspected and leaves the terminal outcome empty',()=>{
    const world=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPerDay:0})
    const inspected=world.creatures[0]
    inspected.home=true
    inspected.food=1
    setInspectedIndividual(world,inspected.individualId)
    finishGeneration(world)

    expect(world.inspectedIndividualId).toBe(inspected.individualId)
    expect(world.lastInspectedOutcome).toBeNull()
  })

  it('clears a stale outcome whenever inspection is explicitly changed or cleared',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0})
    const [first,second]=world.creatures
    world.lastInspectedOutcome={individualId:first.individualId,generation:1,cause:'energy'}

    setInspectedIndividual(world,second.individualId)
    expect(world.lastInspectedOutcome).toBeNull()
    world.lastInspectedOutcome={individualId:second.individualId,generation:1,cause:'hunted'}
    setInspectedIndividual(world,null)
    expect(world.lastInspectedOutcome).toBeNull()
  })

  it('schedules perception and decisions for every reaction branch',()=>{
    expect(scheduleDecision('perfect',4,4,false,false)).toEqual({perceive:true,decide:true})
    expect(scheduleDecision('realistic',3,3,false,false)).toEqual({perceive:false,decide:false})
    expect(scheduleDecision('realistic',3,4,false,false)).toEqual({perceive:true,decide:true})
    expect(scheduleDecision('realistic',3,3,true,true)).toEqual({perceive:true,decide:false})
    expect(scheduleDecision('realistic',3,3,true,false)).toEqual({perceive:true,decide:true})
    expect(scheduleDecision('realistic',3,4,true,true)).toEqual({perceive:true,decide:true})
  })

  it('captures a newly inspected decision and refreshes its held-window diagnostics',()=>{
    const w=createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0,ecologyMode:'classic',perceptionMode:'realistic',reactionTime:1,fieldOfView:360,detectionFalloff:0,obstacleCount:0})
    const [selected]=w.creatures
    Object.assign(selected,{x:.5,y:.5,homeX:.05,homeY:.05,angle:0,sense:.4})
    w.food=[{id:900,x:.7,y:.5,patchId:null,energy:22}]
    tick(w,SIMULATION_TIMESTEP)
    expect(selected.reactionWindow).toBe(0)
    expect(selected.decisionSummary).toBeUndefined()
    setInspectedIndividual(w,selected.individualId)
    tick(w,SIMULATION_TIMESTEP)
    const summary=selected.decisionSummary,firstDiagnostics=selected.perceptionDiagnostics
    expect(summary).toBeDefined()
    expect(summary).toMatchObject({selectionBasis:'best-utility',decidedAt:{generation:1,dayTime:SIMULATION_TIMESTEP,reactionWindow:0}})
    expect(summary).toHaveProperty('chosenTargetId')
    expect(summary?.chosen).not.toBe('home')
    expect(firstDiagnostics).toMatchObject({mode:'realistic',reactionWindow:0,food:{total:1,detected:1}})
    w.food=[]
    tick(w,SIMULATION_TIMESTEP)
    expect(selected.reactionWindow).toBe(0)
    expect(selected.decisionSummary).toBe(summary)
    expect(selected.perceptionDiagnostics).toMatchObject({mode:'realistic',reactionWindow:0,food:{total:0,detected:0}})
    expect(selected.perceptionDiagnostics).not.toBe(firstDiagnostics)
    selected.food=2
    w.dayTime=1
    tick(w,SIMULATION_TIMESTEP)
    expect(selected.reactionWindow).toBe(1)
    expect(selected.decisionSummary).not.toBe(summary)
    expect(selected.decisionSummary?.decidedAt).toEqual({generation:1,dayTime:1,reactionWindow:1})
    expect(selected.decisionSummary?.chosen).toBe('home')
  })

  it('holds an uninspected decision until the reaction window changes',()=>{
    const w=createWorld({...defaultConfig,initialPopulation:1,foodPerDay:0,perceptionMode:'realistic',reactionTime:1,obstacleCount:0})
    const [creature]=w.creatures
    creature.targetType='explore';creature.targetId=null;creature.mode='exploring'
    tick(w,SIMULATION_TIMESTEP)
    const held={targetType:creature.targetType,targetId:creature.targetId,targetX:creature.targetX,targetY:creature.targetY,mode:creature.mode}
    w.food=[{id:901,x:.9,y:.9,patchId:null,energy:22}]
    tick(w,SIMULATION_TIMESTEP)
    expect(creature.reactionWindow).toBe(0)
    expect({targetType:creature.targetType,targetId:creature.targetId,targetX:creature.targetX,targetY:creature.targetY,mode:creature.mode}).toEqual(held)
  })

  it('is deterministic for a seed and configuration', () => {
    const config={...defaultConfig,seed:99,initialPopulation:16,foodPerDay:14}
    const a=createWorld(config), b=createWorld(config)
    for(let i=0;i<4;i++){runGeneration(a);runGeneration(b)}
    expect(a).toEqual(b)
  })

  it('only fed creatures at home survive and two foods yield one child', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:3,foodPerDay:0,mutationRate:0})
    w.creatures[0].food=2; w.creatures[0].home=true
    w.creatures[1].food=1; w.creatures[1].home=true
    w.creatures[2].food=2; w.creatures[2].home=false
    finishGeneration(w)
    expect(w.creatures).toHaveLength(3)
    expect(w.lastReport).toMatchObject({survived:2,born:1})
  })

  it('keeps traits unchanged when mutations are disabled', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPerDay:0,mutateSpeed:false,mutateSize:false,mutateSense:false,mutateAggression:false,mutateCaution:false,mutateExploration:false,mutationRate:1})
    const original=w.creatures[0]
    original.food=2; original.home=true
    finishGeneration(w)
    expect(w.creatures.every(c=>c.speed===original.speed && c.size===original.size && c.sense===original.sense)).toBe(true)
    expect(w.ledger.at(-1)?.inheritance).toMatchObject({offspringCount:1,changedTraitValues:0})
    expect(w.ledger.at(-1)?.inheritance?.traits.speed).toMatchObject({parentMean:original.speed,offspringMean:original.speed,changedCount:0})
  })

  it('computes newborn-only means and matched final value changes', () => {
    const audit=buildInheritanceSummary([
      {parent:traitValues(1,2,.1,.2,.3,.4),offspring:traitValues(1.5,2,.1,.8,.3,.4)},
      {parent:traitValues(2,2,.3,.4,.5,.6),offspring:traitValues(1.7,2,.3,.4,.5,.9)},
    ])
    expect(audit).toMatchObject({offspringCount:2,changedTraitValues:4})
    expect(audit.traits.speed).toMatchObject({parentMean:1.5,offspringMean:1.6,changedCount:2})
    expect(audit.traits.size).toMatchObject({parentMean:2,offspringMean:2,changedCount:0})
    expect(audit.traits.aggression).toMatchObject({changedCount:1})
    expect(audit.traits.aggression.parentMean).toBeCloseTo(.3)
    expect(audit.traits.aggression.offspringMean).toBeCloseTo(.6)
    expect(audit.traits.exploration).toMatchObject({changedCount:1})
    expect(audit.traits.exploration.parentMean).toBeCloseTo(.5)
    expect(audit.traits.exploration.offspringMean).toBeCloseTo(.65)
  })

  it('records the actual parent-to-newborn differences produced at settlement', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,seed:73,initialPopulation:1,foodPerDay:0,founderPhysicalVariation:0,founderBehaviorVariation:0,mutationRate:1,mutationStrength:.2})
    const parent=w.creatures[0],before=traitValues(parent.speed,parent.size,parent.sense,parent.aggression,parent.caution,parent.exploration)
    parent.food=2;parent.home=true
    finishGeneration(w)
    const newborn=w.creatures.find(creature=>creature.parentIndividualId===parent.individualId)!,audit=w.ledger.at(-1)!.inheritance!
    expect(audit.offspringCount).toBe(1)
    for(const trait of ['speed','size','sense','aggression','caution','exploration'] as const){
      expect(audit.traits[trait].parentMean).toBe(before[trait])
      expect(audit.traits[trait].offspringMean).toBe(newborn[trait])
      expect(audit.traits[trait].changedCount).toBe(Number(before[trait]!==newborn[trait]))
    }
    expect(audit.changedTraitValues).toBe(Object.values(audit.traits).reduce((sum,trait)=>sum+trait.changedCount,0))
  })

  it('records null means and no changes when no births are admitted', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPerDay:0})
    finishGeneration(w)
    const audit=w.ledger.at(-1)?.inheritance
    expect(audit).toMatchObject({offspringCount:0,changedTraitValues:0})
    for(const trait of ['speed','size','sense','aggression','caution','exploration'] as const)expect(audit?.traits[trait]).toMatchObject({parentMean:null,offspringMean:null,changedCount:0})
  })

  it('does not count birth-cap rejections in the inheritance audit', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:MAX_POPULATION,foodPerDay:0,mutationRate:1,mutationStrength:0})
    for(const creature of w.creatures){creature.home=true;creature.food=2}
    for(const creature of w.creatures.slice(-3)){creature.home=false;creature.food=0}
    finishGeneration(w)
    expect(w.lastReport).toMatchObject({born:3,capped:MAX_POPULATION-6})
    expect(w.ledger.at(-1)?.inheritance).toMatchObject({offspringCount:3,changedTraitValues:0})
  })

  it('does not give a predation turn to a creature killed earlier in the tick', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:3,foodPerDay:0,predatorRatio:1.2})
    const [largest,middle,smallest]=w.creatures
    for(const c of w.creatures){c.x=.5;c.y=.5;c.sense=.5;c.angle=0}
    largest.size=2; middle.size=1.5; smallest.size=1
    tick(w,SIMULATION_TIMESTEP)
    expect(middle.alive).toBe(false)
    expect(smallest.alive).toBe(true)
  })

  it('retires fed creatures safely at home for the rest of the day', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:2,foodPerDay:0,predatorRatio:1.2})
    const [safe,predator]=w.creatures
    safe.food=1;safe.returning=true;safe.energy=47;safe.x=safe.homeX;safe.y=safe.homeY
    predator.x=.5;predator.y=.5
    tick(w,SIMULATION_TIMESTEP)
    expect(safe).toMatchObject({alive:true,home:true,energy:47,food:1})
    const restingPosition={x:safe.x,y:safe.y}
    predator.size=2;predator.x=safe.x;predator.y=safe.y;predator.sense=.5
    tick(w,SIMULATION_TIMESTEP)
    expect(safe).toMatchObject({alive:true,home:true,energy:47,food:1,...restingPosition})
  })

  it('reports live statistics without creatures killed during the day', () => {
    const w=createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0})
    w.creatures[0].speed=.8;w.creatures[0].size=.9;w.creatures[0].sense=.12
    w.creatures[1].speed=2.8;w.creatures[1].size=2.8;w.creatures[1].sense=.6;w.creatures[1].alive=false
    expect(getStats(w)).toMatchObject({population:1,avgSpeed:.8,avgSize:.9,avgSense:.12})
  })

  it('records missing trait averages for extinction while live metrics stay numeric', () => {
    const w=createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0})
    finishGeneration(w)
    expect(w.history.at(-1)).toMatchObject({population:0,avgSpeed:null,avgSize:null,avgSense:null,avgAggression:null,avgCaution:null,avgExploration:null})
    expect(getStats(w)).toMatchObject({population:0,avgSpeed:0,avgSize:0,avgSense:0,avgAggression:0,avgCaution:0,avgExploration:0})
  })

  it('uses the same fixed timestep for stepped and animated generations', () => {
    const config={...defaultConfig,seed:612,initialPopulation:12,foodPerDay:14}
    const stepped=createWorld(config), animated=createWorld(config)
    runGeneration(stepped)
    const generation=animated.generation
    while(animated.generation===generation)tick(animated,SIMULATION_TIMESTEP)
    expect(stepped).toEqual(animated)
  })

  it('returns with one food when home travel exceeds the time or energy budget', () => {
    const early=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPerDay:0})
    const late=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPerDay:0})
    const lowEnergy=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPerDay:0})
    for(const w of [early,late,lowEnergy]){
      const c=w.creatures[0]
      c.x=.5;c.y=.5;c.food=1;c.energy=defaultConfig.startingEnergy
    }
    late.dayTime=defaultConfig.dayLength-3
    lowEnergy.creatures[0].energy=3
    tick(early,SIMULATION_TIMESTEP)
    tick(late,SIMULATION_TIMESTEP)
    tick(lowEnergy,SIMULATION_TIMESTEP)
    expect(early.creatures[0].returning).toBe(false)
    expect(late.creatures[0].returning).toBe(true)
    expect(lowEnergy.creatures[0].returning).toBe(true)
  })

  it('pursues the nearer food when sensed prey is farther away', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:2,foodPerDay:0,predatorRatio:1.2})
    const [hunter,prey]=w.creatures
    hunter.x=.5;hunter.y=.5;hunter.angle=Math.PI/2;hunter.size=2;hunter.sense=.3
    prey.x=.6;prey.y=.5;prey.size=1
    w.food=[{id:999,x:.45,y:.5,patchId:null,energy:22}]
    tick(w,SIMULATION_TIMESTEP)
    expect(hunter.x).toBeLessThan(.5)
    expect(prey.alive).toBe(true)
  })

  it('keeps decision telemetry only on the inspected individual', () => {
    const w=createWorld({...defaultConfig,initialPopulation:3,foodPerDay:0})
    const [active,home,dead]=w.creatures
    home.home=true
    dead.alive=false
    for(const creature of w.creatures)creature.decisionSummary={chosen:'explore',reason:'stale',candidates:[]}
    setInspectedIndividual(w,active.individualId)
    expect(active.decisionSummary).toBeDefined()
    expect(home.decisionSummary).toBeUndefined()
    expect(dead.decisionSummary).toBeUndefined()
    tick(w,SIMULATION_TIMESTEP)
    expect(active.decisionSummary).toBeDefined()
    expect(w.creatures.filter(creature=>creature.individualId!==active.individualId).every(creature=>creature.decisionSummary===undefined)).toBe(true)
    setInspectedIndividual(w,null)
    expect(w.creatures.every(creature=>creature.decisionSummary===undefined)).toBe(true)
  })
})
