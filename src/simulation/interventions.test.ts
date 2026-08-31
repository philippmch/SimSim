import{describe,expect,it}from'vitest'
import{applyIntervention,createWorld,finishGeneration,formatLatestWorldEvent,getLineageAnalytics,getSelectionTakeaway,setInspectedIndividual,SIMULATION_TIMESTEP,tick}from'./engine'
import{defaultConfig,MAX_FOOD,MAX_POPULATION}from'./config'
import type{GenerationLedger,SelectionSummary}from'./types'

const summary=(mean:number|null):SelectionSummary=>Object.fromEntries(['speed','size','sense','aggression','caution','exploration'].map(trait=>[trait,{mean,variance:mean===null?null:0,sd:mean===null?null:0}]))as SelectionSummary
const ledger=(start:number,survivor:number,reproducer:number):GenerationLedger=>({generation:3,startPopulation:3,outcomes:{survived:3,hunted:0,energy:0,unfed:0,late:0,aged:0},foodAtStart:10,foodProduced:0,foodRemoved:0,foodConsumed:0,foodRemaining:10,preyConsumed:0,attackAttempts:0,attackSuccesses:0,attackFailures:0,birthsEligible:2,birthsAdmitted:2,birthsCapped:0,selection:{start:summary(start),survivor:summary(survivor),reproducer:summary(reproducer)},selectionByOutcome:{survived:summary(start),hunted:summary(null),energy:summary(null),unfed:summary(null),late:summary(null),aged:summary(null)}})

describe('live interventions',()=>{
  it('explains the latest shock provenance and keeps a reset run empty',()=>{
    const world=createWorld({...defaultConfig,seed:919,foodPerDay:0})
    expect(formatLatestWorldEvent(world.events.at(-1),world.generation)).toBe('No shocks recorded in this run yet.')
    applyIntervention(world,'drought')
    const event=world.events.at(-1)!
    expect(formatLatestWorldEvent(event,world.generation)).toBe(`Current generation · Generation 1 · day 0.00 · ${event.summary}`)
    const reset=createWorld({...defaultConfig,seed:919,foodPerDay:0})
    expect(formatLatestWorldEvent(reset.events.at(-1),reset.generation)).toBe('No shocks recorded in this run yet.')
  })

  it('marks a retained shock as earlier after the generation advances',()=>{
    const world=createWorld({...defaultConfig,seed:919,foodPerDay:0})
    applyIntervention(world,'drought')
    const event=world.events.at(-1)!
    finishGeneration(world)
    expect(formatLatestWorldEvent(event,world.generation)).toBe(`Earlier generation · Generation 1 · day 0.00 · ${event.summary}`)
  })

  it('keeps no-op and future or corrupt event records truthful',()=>{
    const world=createWorld({...defaultConfig,seed:919,foodPerDay:0})
    applyIntervention(world,'drought')
    const event=world.events.at(-1)!
    expect(event.summary).toBe('Drought found no food to remove.')
    expect(formatLatestWorldEvent(event,world.generation)).toContain(event.summary)
    expect(formatLatestWorldEvent({...event,generation:world.generation+1},world.generation)).toContain('Later generation · Generation 2 · day 0.00')
    expect(formatLatestWorldEvent({...event,generation:Number.NaN,day:Number.NaN},world.generation)).toContain('Generation provenance unavailable · Generation unavailable · day unavailable')
    expect(formatLatestWorldEvent({...event,generation:-1},world.generation)).toContain('Generation provenance unavailable · Generation unavailable')
    expect(formatLatestWorldEvent({...event,generation:1.5},world.generation)).toContain('Generation provenance unavailable · Generation unavailable')
    expect(formatLatestWorldEvent(event,1.5)).toContain('Generation provenance unavailable · Generation 1')
  })

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

describe('selection takeaway',()=>{
  const selectionLedger=(survivorSpeed:number|null,reproducerSpeed:number|null,births=1,survived=2)=>{
    const result=ledger(1,survivorSpeed??1,reproducerSpeed??1)
    result.outcomes.survived=survived
    result.birthsAdmitted=births
    result.selection.start.speed={mean:1,variance:.01,sd:.1}
    result.selection.survivor.speed=survivorSpeed===null?{mean:null,variance:null,sd:null}:{mean:survivorSpeed,variance:.01,sd:.1}
    result.selection.reproducer.speed=reproducerSpeed===null?{mean:null,variance:null,sd:null}:{mean:reproducerSpeed,variance:.01,sd:.1}
    return result
  }

  it('combines the same survivor and newborn-parent signal',()=>{
    expect(getSelectionTakeaway(selectionLedger(1.08,1.07))).toBe('Generation 3: Faster creatures stood out among both survivors and parents of newborns.')
  })

  it('reports only the stronger cohort when signals conflict',()=>{
    expect(getSelectionTakeaway(selectionLedger(1.03,.92))).toBe('Generation 3: parents of newborns were noticeably slower on average than the evaluated cohort.')
  })

  it('avoids overclaiming weak shifts and explains missing cohorts',()=>{
    expect(getSelectionTakeaway(selectionLedger(1.01,1.01,0))).toBe('Generation 3: trait averages stayed close to the evaluated cohort; no single trait stood out. No offspring were born.')
    expect(getSelectionTakeaway(selectionLedger(1.08,null,0))).toBe('Generation 3: survivors were noticeably faster on average than the evaluated cohort. No offspring were born.')
    expect(getSelectionTakeaway(selectionLedger(null,null,0,0))).toBe('Generation 3 ended with no survivors, so there is no trait shift to compare.')
    expect(getSelectionTakeaway(undefined)).toBe('Finish a generation to see which traits stood out.')
  })
})
