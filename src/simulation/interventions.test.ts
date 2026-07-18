import{describe,expect,it}from'vitest'
import{applyIntervention,createWorld,finishGeneration,getLineageAnalytics,setInspectedIndividual,SIMULATION_TIMESTEP,tick}from'./engine'
import{defaultConfig,MAX_FOOD,MAX_POPULATION}from'./config'
import type{GenerationLedger,SelectionSummary}from'./types'

const summary=(mean:number):SelectionSummary=>Object.fromEntries(['speed','size','sense','aggression','caution','exploration'].map(trait=>[trait,{mean,variance:0,sd:0}]))as SelectionSummary
const ledger=(start:number,survivor:number,reproducer:number):GenerationLedger=>({generation:3,startPopulation:3,outcomes:{survived:3,hunted:0,energy:0,unfed:0,late:0,aged:0},foodAtStart:10,foodProduced:0,foodRemoved:0,foodConsumed:0,foodRemaining:10,preyConsumed:0,attackAttempts:0,attackSuccesses:0,attackFailures:0,birthsEligible:2,birthsAdmitted:2,birthsCapped:0,selection:{start:summary(start),survivor:summary(survivor),reproducer:summary(reproducer)}})

describe('live interventions',()=>{
  it('replays the same command sequence deterministically',()=>{
    const a=createWorld({...defaultConfig,seed:919}),b=createWorld({...defaultConfig,seed:919})
    for(const kind of ['resource-bloom','drought','founder-migration','resource-bloom']as const){applyIntervention(a,kind);applyIntervention(b,kind)}
    expect(a).toEqual(b)
  })

  it('maintains food stock, capacity, population, and bounded events',()=>{
    const world=createWorld({...defaultConfig,seed:44,initialPopulation:MAX_POPULATION-2,patchCapacity:12})
    expect(applyIntervention(world,'founder-migration')).toBe(2)
    expect(world.creatures.filter(creature=>creature.alive)).toHaveLength(MAX_POPULATION)
    expect(applyIntervention(world,'founder-migration')).toBe(0)
    for(let i=0;i<12;i++)applyIntervention(world,'resource-bloom')
    expect(world.food.length).toBeLessThanOrEqual(MAX_FOOD)
    expect(world.environment.patches.every(patch=>patch.stock<=world.config.patchCapacity)).toBe(true)
    applyIntervention(world,'drought')
    for(const patch of world.environment.patches)expect(patch.stock).toBe(world.food.filter(food=>food.patchId===patch.id).length)
    for(let i=0;i<70;i++)applyIntervention(world,'drought')
    expect(world.events).toHaveLength(60)
    expect(world.events.at(-1)).toMatchObject({kind:'drought',generation:1,count:0})
  })

  it('clears inspection when the selected creature dies',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1,foodPerDay:0})
    const selected=world.creatures[0]
    setInspectedIndividual(world,selected.individualId)
    selected.energy=0
    tick(world,SIMULATION_TIMESTEP)
    expect(selected.alive).toBe(false)
    expect(world.inspectedIndividualId).toBeNull()
  })

  it('records drought removals in the generation resource balance',()=>{
    const world=createWorld({...defaultConfig,seed:52,initialPopulation:1,foodPerDay:20})
    applyIntervention(world,'drought')
    finishGeneration(world)
    const result=world.ledger[0]
    expect(result.foodRemoved).toBeGreaterThan(0)
    expect(result.foodAtStart+result.foodProduced).toBe(result.foodConsumed+result.foodRemoved+result.foodRemaining)
  })
})

describe('lineage analytics',()=>{
  it('computes inverse-Simpson diversity, ordered shares, and ledger shifts',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:3,founderPhysicalVariation:0,founderBehaviorVariation:0})
    world.creatures[0].lineageId=7;world.creatures[1].lineageId=7;world.creatures[2].lineageId=9
    world.ledger=[ledger(1,1.1,.9)]
    const result=getLineageAnalytics(world)
    expect(result.livingLineages).toBe(2)
    expect(result.effectiveDiversity).toBeCloseTo(1.8)
    expect(result.topLineages).toEqual([{lineageId:7,count:2,share:2/3},{lineageId:9,count:1,share:1/3}])
    expect(result.latestGeneration).toBe(3)
    expect(result.selectionShifts[0].trait).toBe('speed')
    expect(result.selectionShifts[0].survivor).toBeCloseTo(.1)
    expect(result.selectionShifts[0].reproducer).toBeCloseTo(-.1)
  })
})
