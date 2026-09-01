import{describe,expect,it}from'vitest'
import{applyIntervention,createWorld,finishGeneration,formatLatestWorldEvent,getLineageAnalytics,getSelectionTakeaway,meetsStandardizedEffectThreshold,SELECTION_PATTERN_MIN_COUNT,SELECTION_PATTERN_THRESHOLD,SELECTION_SIGNAL_THRESHOLD,setInspectedIndividual,SIMULATION_TIMESTEP,tick}from'./engine'
import{defaultConfig,MAX_FOOD,MAX_POPULATION}from'./config'
import type{BiologicalTrait,GenerationLedger,SelectionSummary}from'./types'

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
  const selectionLedger=(survivorSpeed:number|null,reproducerSpeed:number|null,births=3,survived=3)=>{
    const result=ledger(1,survivorSpeed??1,reproducerSpeed??1)
    result.outcomes.survived=survived
    result.birthsAdmitted=births
    result.selection.start.speed={mean:1,variance:.01,sd:.1}
    result.selection.survivor.speed=survivorSpeed===null?{mean:null,variance:null,sd:null}:{mean:survivorSpeed,variance:.01,sd:.1}
    result.selection.reproducer.speed=reproducerSpeed===null?{mean:null,variance:null,sd:null}:{mean:reproducerSpeed,variance:.01,sd:.1}
    return result
  }
  const traitSelectionLedger=(trait:BiologicalTrait,effect:number,births=0,startMean=1,startSd=.1,survived=3)=>{
    const result=ledger(1,startMean+effect*startSd,startMean+effect*startSd)
    result.outcomes.survived=survived
    result.birthsAdmitted=births
    result.selection.start[trait]={mean:startMean,variance:startSd**2,sd:startSd}
    result.selection.survivor[trait]={mean:startMean+effect*startSd,variance:startSd**2,sd:startSd}
    result.selection.reproducer[trait]={mean:startMean+effect*startSd,variance:startSd**2,sd:startSd}
    return result
  }

  it('combines the same survivor and newborn-parent signal',()=>{
    expect(getSelectionTakeaway(selectionLedger(1.08,1.07))).toBe('Generation 3: Possible shared pattern — descriptive, not causal: both cohorts had faster speed on average than the evaluated cohort (survivors n=3, +0.80 baseline SD; parents of newborns n=3, +0.70 baseline SD).')
  })

  it('reports only the stronger cohort when signals conflict',()=>{
    expect(getSelectionTakeaway(selectionLedger(1.03,.92))).toBe('Generation 3: Possible pattern — descriptive, not causal: parents of newborns (n=3) had slower speed on average than the evaluated cohort (-0.80 baseline SD).')
  })

  it('avoids overclaiming weak shifts and explains missing cohorts',()=>{
    expect(getSelectionTakeaway(selectionLedger(1.01,1.01,0))).toBe('Generation 3: no clear signal passed the display thresholds (0.2 baseline-SD minimum plus baseline-spread and absolute-change floors). No offspring were born.')
    expect(getSelectionTakeaway(selectionLedger(1.08,null,0))).toBe('Generation 3: Possible pattern — descriptive, not causal: survivors (n=3) had faster speed on average than the evaluated cohort (+0.80 baseline SD). No offspring were born.')
    expect(getSelectionTakeaway(selectionLedger(null,null,0,0))).toBe('Generation 3 ended with no survivors, so there is no trait shift to compare.')
    expect(getSelectionTakeaway(undefined)).toBe('Finish a generation to see whether trait shifts emerge.')
  })

  it('uses the signal threshold at 0.2 SD and keeps sub-pattern effects precise',()=>{
    expect(SELECTION_SIGNAL_THRESHOLD).toBe(.2)
    expect(SELECTION_PATTERN_THRESHOLD).toBe(.5)
    expect(SELECTION_PATTERN_MIN_COUNT).toBe(3)
    const value=(effect:number)=>1+effect*.1
    expect(getSelectionTakeaway(selectionLedger(value(.19),null,0))).toContain('no clear signal passed the display thresholds')
    expect(getSelectionTakeaway(selectionLedger(value(.2),null,0))).toContain('Slight signal — not a pattern')
    expect(getSelectionTakeaway(selectionLedger(value(.25),null,0))).toContain('Slight signal — not a pattern')
    expect(getSelectionTakeaway(selectionLedger(value(.49),null,0))).toContain('Slight signal — not a pattern')
    expect(getSelectionTakeaway(selectionLedger(value(.49),null,0))).toContain('+0.49 baseline SD')
    expect(getSelectionTakeaway(selectionLedger(value(.5),null,0))).toContain('Possible pattern — descriptive, not causal')
  })

  it('keeps a valid pattern when one shared cohort is only a slight signal',()=>{
    const value=(effect:number)=>1+effect*.1
    const patternWithWeakSurvivors=getSelectionTakeaway(selectionLedger(value(.49),value(.5)))
    expect(patternWithWeakSurvivors).toContain('Possible pattern — descriptive, not causal')
    expect(patternWithWeakSurvivors).not.toContain('Possible shared pattern')
    expect(patternWithWeakSurvivors).toContain('parents of newborns (n=3) had faster speed')
    expect(patternWithWeakSurvivors).toContain('survivors (n=3) had a supporting slight same-direction signal')
    expect(patternWithWeakSurvivors).toContain('faster speed (+0.49 baseline SD)')
    expect(patternWithWeakSurvivors).toContain('parents of newborns (n=3) had faster speed on average than the evaluated cohort (+0.50 baseline SD)')
    const patternWithWeakParents=getSelectionTakeaway(selectionLedger(value(.5),value(.49)))
    expect(patternWithWeakParents).toContain('survivors (n=3) had faster speed')
    expect(patternWithWeakParents).toContain('parents of newborns (n=3) had a supporting slight same-direction signal')
    const slightShared=getSelectionTakeaway(selectionLedger(value(.25),value(.49)))
    expect(slightShared).toContain('Slight shared signal — not a pattern')
    expect(slightShared).toContain('At least one cohort is below the 0.5 baseline-SD pattern threshold')
    expect(slightShared).not.toContain('Possible shared pattern')
  })

  it('requires three observations for single and shared possible patterns',()=>{
    const value=(effect:number)=>1+effect*.1
    const single=(survived:number)=>getSelectionTakeaway(traitSelectionLedger('speed',.8,0,1,.1,survived))
    expect(single(1)).toContain('Too few observations to call a pattern: survivors (n=1)')
    expect(single(2)).toContain('Too few observations to call a pattern: survivors (n=2)')
    expect(single(3)).toContain('Possible pattern — descriptive, not causal: survivors (n=3)')

    const shared=(survived:number,births:number)=>getSelectionTakeaway(selectionLedger(value(.8),value(.7),births,survived))
    expect(shared(1,1)).toContain('Too few observations to call a shared pattern')
    expect(shared(2,2)).toContain('Too few observations to call a shared pattern')
    expect(shared(3,3)).toContain('Possible shared pattern — descriptive, not causal')

    const strongerSmallCohort=getSelectionTakeaway(selectionLedger(value(.6),value(.9),2,3))
    expect(strongerSmallCohort).toContain('Possible pattern — descriptive, not causal: survivors (n=3)')
    expect(strongerSmallCohort).toContain('survivors (n=3) had faster speed on average than the evaluated cohort (+0.60 baseline SD)')
    expect(strongerSmallCohort).toContain('parents of newborns (n=2) had a supporting too-few same-direction signal')
    expect(strongerSmallCohort).not.toContain('Possible shared pattern')
  })

  it('accepts mathematically exact signed thresholds despite floating-point drift',()=>{
    const signalPositive=.3-.1,signalNegative=-(.3-.1),patternPositive=.7-.2,patternNegative=-(.7-.2)
    expect(signalPositive).toBeLessThan(SELECTION_SIGNAL_THRESHOLD)
    expect(signalNegative).toBeGreaterThan(-SELECTION_SIGNAL_THRESHOLD)
    expect(patternPositive).toBeLessThan(SELECTION_PATTERN_THRESHOLD)
    expect(patternNegative).toBeGreaterThan(-SELECTION_PATTERN_THRESHOLD)
    expect(meetsStandardizedEffectThreshold(signalPositive,SELECTION_SIGNAL_THRESHOLD)).toBe(true)
    expect(meetsStandardizedEffectThreshold(signalNegative,SELECTION_SIGNAL_THRESHOLD)).toBe(true)
    expect(meetsStandardizedEffectThreshold(patternPositive,SELECTION_PATTERN_THRESHOLD)).toBe(true)
    expect(meetsStandardizedEffectThreshold(patternNegative,SELECTION_PATTERN_THRESHOLD)).toBe(true)
    expect(meetsStandardizedEffectThreshold(.19,SELECTION_SIGNAL_THRESHOLD)).toBe(false)
    expect(meetsStandardizedEffectThreshold(-.19,SELECTION_SIGNAL_THRESHOLD)).toBe(false)
    expect(meetsStandardizedEffectThreshold(.49,SELECTION_PATTERN_THRESHOLD)).toBe(false)
    expect(meetsStandardizedEffectThreshold(-.49,SELECTION_PATTERN_THRESHOLD)).toBe(false)
    const positiveSignal=getSelectionTakeaway(traitSelectionLedger('speed',signalPositive,0,.4,1))
    const negativeSignal=getSelectionTakeaway(traitSelectionLedger('speed',signalNegative,0,.4,1))
    const positivePattern=getSelectionTakeaway(traitSelectionLedger('speed',patternPositive,0,.4,1))
    const negativePattern=getSelectionTakeaway(traitSelectionLedger('speed',patternNegative,0,.4,1))
    expect(positiveSignal).toContain('Slight signal — not a pattern')
    expect(negativeSignal).toContain('Slight signal — not a pattern')
    expect(positivePattern).toContain('Possible pattern — descriptive, not causal')
    expect(negativePattern).toContain('Possible pattern — descriptive, not causal')
    expect(positiveSignal).toContain('+0.20 baseline SD')
    expect(negativeSignal).toContain('-0.20 baseline SD')
    expect(positivePattern).toContain('+0.50 baseline SD')
    expect(negativePattern).toContain('-0.50 baseline SD')
  })

  it('describes both directions for every trait as explicit trait values',()=>{
    const cases:[BiologicalTrait,number,string][]=[
      ['speed',.8,'faster speed'],['speed',-.8,'slower speed'],
      ['size',.8,'larger size'],['size',-.8,'smaller size'],
      ['sense',.8,'broader sensing'],['sense',-.8,'narrower sensing'],
      ['aggression',.8,'higher aggression'],['aggression',-.8,'lower aggression'],
      ['caution',.8,'higher caution'],['caution',-.8,'lower caution'],
      ['exploration',.8,'higher exploration tendency'],['exploration',-.8,'lower exploration tendency'],
    ]
    for(const [trait,effect,description] of cases)expect(getSelectionTakeaway(traitSelectionLedger(trait,effect))).toContain(description)
  })

  it('keeps an absolute-change filter honest when standardized effect is large',()=>{
    const filtered=traitSelectionLedger('speed',.5,0,.4,.0125)
    const text=getSelectionTakeaway(filtered)
    expect(text).toContain('no clear signal passed the display thresholds')
    expect(text).not.toContain('below 0.2')
    expect(text).not.toContain('0.2 baseline SD signal threshold')
  })
})
