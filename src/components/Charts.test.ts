import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BEHAVIOR_HISTORY_CONTEXT, BehaviorHistory, buildGenerationDelta, buildGenerationRuler, buildHistoryTimeline, buildObservedNonnegativeDomain, buildOutcomeFlowTimeline, buildRetainedShockNavigator, buildSelectionShiftTimeline, buildSpeedHistogram, completePendingGenerationJournalFocus, contrastRatio, formatGenerationDelta, formatOutcomeFlowSummary, formatRetainedShockNavigatorNotice, formatSelectionShiftValue, formatTimelineSummary, generationRulerOffset, GENERATION_JOURNAL_PENDING_FOCUS_ATTRIBUTE, GENERATION_JOURNAL_SCROLL_OPTIONS, HistoryChart, historyCoordinate, MAX_TIMELINE_ENTRIES, openGenerationJournalReview, OUTCOME_FLOW_CARD_SURFACES, OUTCOME_FLOW_LEGEND, OUTCOME_FLOW_MISSING_TEXT, OUTCOME_FLOW_MATURITY_INVALID_TEXT, OUTCOME_FLOW_MATURITY_MISSING_TEXT, RETAINED_SHOCK_ARIA_LABEL_LIMIT, RETAINED_SHOCK_CONTEXT, RETAINED_SHOCK_ORDER_NOTE, resolveOutcomeFlowGeneration, resolveTimelineGeneration, safeFiniteHistoryValue, safeNonnegativeHistoryValue, SPEED_HISTOGRAM_DOMAIN, traitColor, outcomeFlowScrollLeft, outcomeFlowSlotCenter } from './Charts'
import { speedColor } from './ArenaCanvasModel'
import type { EndCause, GenerationLedger, HistoryPoint, World, WorldEvent } from '../simulation/types'

const ledger=(generation:number,birthsAdmitted=generation%3):GenerationLedger=>({generation,birthsAdmitted,outcomes:{survived:4,hunted:0,energy:0,unfed:0,late:0,aged:0}} as GenerationLedger)
const point=(generation:number,population:number,avgEnergy:number|null=10,avgAge:number|null=2):HistoryPoint=>({generation,population,avgSpeed:1,avgSize:1,avgSense:.2,avgAggression:.4,avgCaution:.5,avgExploration:.6,sdSpeed:0,sdSize:0,sdSense:0,sdAggression:0,sdCaution:0,sdExploration:0,avgEnergy,avgAge})
const shock=(generation:number,day:number,kind:WorldEvent['kind']='drought',summary=`${kind} recorded`,count=1):WorldEvent=>({generation,day,kind,summary,count})
const chartWorld=(events:readonly WorldEvent[],generations=[1,2]):World=>({ledger:generations.map(generation=>ledger(generation)),history:generations.map(generation=>point(generation,generation*10)),events:[...events]} as unknown as World)
const flowOutcomes=(overrides:Partial<Record<EndCause,number>>={}):Record<EndCause,number>=>({survived:0,hunted:0,energy:0,unfed:0,late:0,aged:0,...overrides})
const flowLedger=(generation:number,startPopulation:number,outcomes:Record<EndCause,number>,birthsEligible=outcomes.survived,birthsAdmitted=birthsEligible,birthsCapped=birthsEligible-birthsAdmitted):GenerationLedger=>({generation,startPopulation,outcomes,birthsEligible,birthsAdmitted,birthsCapped} as unknown as GenerationLedger)
const flowWorld=(ledgers:readonly GenerationLedger[]):World=>({...chartWorld([],ledgers.map(item=>item.generation)),ledger:[...ledgers]} as World)
const selectionMoment=(mean:number|null)=>({mean,variance:mean===null?null:.01,sd:mean===null?null:.1})
const selectionSummary=(speed:number|null,aggression:number|null=.5)=>({speed:selectionMoment(speed),size:selectionMoment(1),sense:selectionMoment(.2),aggression:selectionMoment(aggression),caution:selectionMoment(.5),exploration:selectionMoment(.6)})
const selectionLedger=(generation:number,evaluated=1,survivor=1.25,reproducer=.75,counts={start:4,survivors:3,births:2}):GenerationLedger=>({
  ...flowLedger(generation,counts.start,flowOutcomes({survived:counts.survivors}),counts.survivors,counts.births,0),
  selection:{start:selectionSummary(evaluated,.5),survivor:selectionSummary(survivor,.6),reproducer:selectionSummary(reproducer,.4)},
  inheritance:{offspringCount:counts.births,changedTraitValues:0,traits:{speed:{parentMean:99,offspringMean:99,changedCount:0}}} as never,
} as GenerationLedger)
type JournalTargetSpy={disabled?:boolean;attributes:Set<string>;scrollCalls:ScrollIntoViewOptions[];focusCalls:FocusOptions[];scrollIntoView:(options?:ScrollIntoViewOptions)=>void;focus:(options?:FocusOptions)=>void;setAttribute:(name:string,value:string)=>void;removeAttribute:(name:string)=>void;hasAttribute:(name:string)=>boolean}
const journalTarget=(disabled=false):JournalTargetSpy=>({disabled,attributes:new Set(),scrollCalls:[],focusCalls:[],scrollIntoView(options){this.scrollCalls.push(options??{})},focus(options){this.focusCalls.push(options??{})},setAttribute(name){this.attributes.add(name)},removeAttribute(name){this.attributes.delete(name)},hasAttribute(name){return this.attributes.has(name)}})

describe('speed histogram',()=>{
  it('includes the full valid speed domain with accurate final-bin bounds',()=>{
    const bins=buildSpeedHistogram([.3,2.2,2.8])
    expect(SPEED_HISTOGRAM_DOMAIN).toEqual({min:.3,max:2.8})
    expect(bins[0].count).toBe(1)
    expect(bins.at(-1)).toMatchObject({count:1,upper:2.8})
    expect(bins.reduce((sum,bin)=>sum+bin.count,0)).toBe(3)
  })
})

describe('trait histogram colors',()=>{
  const domains={speed:[.3,2.8],size:[.3,2.8],sense:[.035,.6],aggression:[0,1],caution:[0,1],exploration:[0,1]} as const
  const traits=Object.keys(domains) as (keyof typeof domains)[]

  it('keeps speed colors compatible while giving every trait distinct endpoint colors',()=>{
    expect(traitColor('speed',.55)).toBe(speedColor(.55))
    const endpointColors=traits.flatMap(trait=>domains[trait].map(value=>traitColor(trait,value)))
    expect(new Set(endpointColors).size).toBe(traits.length*2)
    for(const trait of traits)expect(traitColor(trait,domains[trait][0])).not.toBe(traitColor(trait,domains[trait][1]))
  })

  it('clamps colors at each trait domain boundary',()=>{
    for(const trait of traits){
      const [min,max]=domains[trait]
      expect(traitColor(trait,min-100)).toBe(traitColor(trait,min))
      expect(traitColor(trait,max+100)).toBe(traitColor(trait,max))
    }
  })

  it('keeps the aggression ramp on the short red path through zero degrees',()=>{
    expect(traitColor('aggression',.5)).toBe('hsl(1 58% 47%)')
  })
})

describe('generation history timeline',()=>{
  it('states that behavior history combines survivors and newborns',()=>{
    expect(BEHAVIOR_HISTORY_CONTEXT).toBe('Mean behavior traits in each next population; survivors and newborns combined.')
    expect(BEHAVIOR_HISTORY_CONTEXT).not.toContain('Inherited')
  })

  it('opens the selected journal review by scrolling immediately and scheduling focus on the enabled select',()=>{
    const review=journalTarget(),journal=journalTarget(),documentRef={getElementById:(id:string)=>id==='generation-review'?review:id==='generation-journal'?journal:null}
    const scheduled:(()=>void)[]=[]
    expect(openGenerationJournalReview({document:documentRef,scheduleFocus:callback=>{scheduled.push(callback)}})).toBe(true)
    expect(review.scrollCalls).toEqual([GENERATION_JOURNAL_SCROLL_OPTIONS])
    expect(journal.scrollCalls).toEqual([])
    expect(review.focusCalls).toEqual([])
    expect(scheduled).toHaveLength(1)
    scheduled[0]()
    expect(review.focusCalls).toEqual([{preventScroll:true}])
  })

  it('uses the stable journal target when the review select is disabled or missing',()=>{
    for(const review of [journalTarget(true),null]){
      const journal=journalTarget(),documentRef={activeElement:null as JournalTargetSpy|null,getElementById:(id:string)=>id==='generation-review'?review:id==='generation-journal'?journal:null}
      const scheduled:(()=>void)[]=[]
      expect(openGenerationJournalReview({document:documentRef,scheduleFocus:callback=>{scheduled.push(callback)}})).toBe(true)
      expect(journal.scrollCalls).toEqual([GENERATION_JOURNAL_SCROLL_OPTIONS])
      expect(journal.focusCalls).toEqual([{preventScroll:true}])
      expect(journal.hasAttribute(GENERATION_JOURNAL_PENDING_FOCUS_ATTRIBUTE)).toBe(true)
      documentRef.activeElement=journal
      expect(scheduled).toHaveLength(1)
      scheduled[0]()
      expect(journal.focusCalls).toHaveLength(1)
      expect(journal.hasAttribute(GENERATION_JOURNAL_PENDING_FOCUS_ATTRIBUTE)).toBe(true)
    }
  })

  it('transfers pending focus to the review select when it mounts and clears the marker',()=>{
    const journal=journalTarget(),reviewTarget={current:null as JournalTargetSpy|null},documentRef={activeElement:null as JournalTargetSpy|null,getElementById:(id:string)=>id==='generation-review'?reviewTarget.current:id==='generation-journal'?journal:null},scheduled:(()=>void)[]=[]
    expect(openGenerationJournalReview({document:documentRef,scheduleFocus:callback=>{scheduled.push(callback)}})).toBe(true)
    documentRef.activeElement=journal
    const review=journalTarget()
    reviewTarget.current=review
    scheduled[0]()
    expect(review.focusCalls).toEqual([{preventScroll:true}])
    expect(journal.hasAttribute(GENERATION_JOURNAL_PENDING_FOCUS_ATTRIBUTE)).toBe(false)
    expect(completePendingGenerationJournalFocus({document:documentRef})).toBe(false)
  })

  it('clears a pending marker without stealing focus after the user moves away',()=>{
    const journal=journalTarget(),reviewTarget={current:null as JournalTargetSpy|null},other=journalTarget(),documentRef={activeElement:null as JournalTargetSpy|null,getElementById:(id:string)=>id==='generation-review'?reviewTarget.current:id==='generation-journal'?journal:null},scheduled:(()=>void)[]=[]
    expect(openGenerationJournalReview({document:documentRef,scheduleFocus:callback=>{scheduled.push(callback)}})).toBe(true)
    documentRef.activeElement=journal
    const review=journalTarget()
    reviewTarget.current=review
    documentRef.activeElement=other
    expect(completePendingGenerationJournalFocus({document:documentRef})).toBe(false)
    expect(review.focusCalls).toEqual([])
    expect(journal.hasAttribute(GENERATION_JOURNAL_PENDING_FOCUS_ATTRIBUTE)).toBe(false)
    scheduled[0]()
    expect(review.focusCalls).toEqual([])
  })

  it('returns false without scheduling when neither journal target exists',()=>{
    let scheduled=false
    expect(openGenerationJournalReview({document:{getElementById:()=>null},scheduleFocus:()=>{scheduled=true}})).toBe(false)
    expect(scheduled).toBe(false)
  })

  it('excludes generation zero and joins history by generation rather than index',()=>{
    const entries=buildHistoryTimeline([ledger(2,1),ledger(4,2)],[point(0,99),point(4,40),point(2,20)],[])
    expect(entries.map(entry=>entry.generation)).toEqual([2,4])
    expect(entries.map(entry=>entry.nextPopulation)).toEqual([20,40])
  })

  it('caps and aligns every retained entry to the latest forty ledgers',()=>{
    const ledgers=Array.from({length:MAX_TIMELINE_ENTRIES+5},(_,index)=>ledger(index+1,index))
    const history=ledgers.map(item=>point(item.generation,item.generation*10))
    const events:WorldEvent[]=[{generation:6,day:1,kind:'drought',summary:'old retained event',count:1},{generation:45,day:1,kind:'resource-bloom',summary:'latest retained event',count:1}]
    const entries=buildHistoryTimeline(ledgers,history,events)
    expect(entries).toHaveLength(MAX_TIMELINE_ENTRIES)
    expect(entries[0]).toMatchObject({generation:6,nextPopulation:60,births:5,retainedEvents:1})
    expect(entries.at(-1)).toMatchObject({generation:45,nextPopulation:450,retainedEvents:1})
  })

  it('labels unavailable values and only mentions retained events when present',()=>{
    const [withoutEvents]=buildHistoryTimeline([ledger(1)],[point(1,0,null,null)],[])
    expect(formatTimelineSummary(withoutEvents)).toContain('mean energy unavailable')
    expect(formatTimelineSummary(withoutEvents)).toContain('mean age unavailable')
    expect(formatTimelineSummary(withoutEvents)).not.toContain('retained events')
    const [withEvents]=buildHistoryTimeline([ledger(1)],[point(1,4,8,3)],[{generation:1,day:2,kind:'drought',summary:'retained',count:1}])
    const settlementLosses={...withEvents.outcomes,unfed:1,late:1}
    expect(formatTimelineSummary(withEvents)).toContain('1 retained event')
    expect(formatTimelineSummary({...withEvents,nextMeanEnergy:8.125,outcomes:settlementLosses})).toContain('mean energy 8.13')
    expect(formatTimelineSummary({...withEvents,outcomes:settlementLosses})).toContain('1 no food at settlement')
    expect(formatTimelineSummary({...withEvents,outcomes:settlementLosses})).toContain('1 missed return deadline')
  })

  it('follows latest and clamps unavailable generation requests',()=>{
    const entries=buildHistoryTimeline([ledger(2),ledger(4)],[point(2,20),point(4,40)],[])
    expect(resolveTimelineGeneration(entries,null)).toBe(4)
    expect(resolveTimelineGeneration(entries,1)).toBe(2)
    expect(resolveTimelineGeneration(entries,9)).toBe(4)
    expect(resolveTimelineGeneration(entries,3)).toBe(2)
    expect(resolveTimelineGeneration([],3)).toBeNull()
  })

  it('keeps selected coordinates finite for nulls and a single entry',()=>{
    expect(historyCoordinate(null,0,1,0,1)).toBeNull()
    expect(historyCoordinate(Number.NaN,0,1,0,2)).toBeNull()
    const point=historyCoordinate(0,0,1,0,1)
    expect(point).toMatchObject({x:160})
    expect(Object.values(point!).every(value=>Number.isFinite(value))).toBe(true)
  })
})

describe('population outcome flow history',()=>{
  it('keeps the two accounting equations separate and names every nonzero loss cause',()=>{
    const outcomes=flowOutcomes({survived:4,hunted:1,energy:2,unfed:1,late:1,aged:1}),[entry]=buildOutcomeFlowTimeline([flowLedger(7,10,outcomes,3,2,1)])
    expect(entry).toMatchObject({generation:7,startPopulation:10,evaluated:10,cohortFlowAvailable:true,survivors:4,birthsEligible:3,birthsAdmitted:2,birthsCapped:1,birthCapState:'available',exactNextPopulation:6,nextPopulationAvailable:true})
    const summary=formatOutcomeFlowSummary(entry)
    expect(summary).toContain('Evaluated = survivors + losses: 10 = 4 survivors + 1 hunted + 2 energy depleted + 1 no food at settlement + 1 missed return deadline + 1 old age.')
    expect(summary).toContain('Survivors + admitted births = exact next population: 4 + 2 = 6')
    expect(summary).toContain('Birth cap: eligible parents = admitted births + capped births: 3 = 2 + 1')
    expect(summary).toContain('1 capped birth')
    expect(summary).toContain('Descriptive counts only')
    expect(summary).not.toMatch(/because|caused|led to|impact/i)
    expect(formatOutcomeFlowSummary({...entry,cohortFlowAvailable:false,nextPopulationAvailable:false,birthCapState:'unavailable'})).toContain('10 = 4 survivors')
  })

  it('represents zero losses and zero births without inventing missing values',()=>{
    const [entry]=buildOutcomeFlowTimeline([flowLedger(1,4,flowOutcomes({survived:4}),0,0,0)])
    expect(entry).toMatchObject({evaluated:4,exactNextPopulation:4,birthCapState:'available'})
    expect(formatOutcomeFlowSummary(entry)).toContain('4 survivors + no recorded losses')
    expect(formatOutcomeFlowSummary(entry)).toContain('4 + 0 = 4')
    expect(formatOutcomeFlowSummary(entry)).toContain('0 eligible parents')
    expect(formatOutcomeFlowSummary(entry)).toContain('0 capped births')
  })

  it('retains the latest forty mappable ledgers in source order and supports one row',()=>{
    const ledgers=Array.from({length:45},(_,index)=>flowLedger(index+1,1,flowOutcomes({survived:1}))),entries=buildOutcomeFlowTimeline(ledgers)
    expect(entries).toHaveLength(MAX_TIMELINE_ENTRIES)
    expect(entries[0].generation).toBe(6)
    expect(entries.at(-1)!.generation).toBe(45)
    expect(buildOutcomeFlowTimeline([ledgers[0],ledgers[1],{generation:0},ledgers[3]],2).map(entry=>entry.generation)).toEqual([4])
    expect(buildOutcomeFlowTimeline([...ledgers,{generation:0}],2).map(entry=>entry.generation)).toEqual([45])
    expect(buildOutcomeFlowTimeline([ledgers[0]])).toHaveLength(1)
    expect(buildOutcomeFlowTimeline(null)).toEqual([])
    expect(buildOutcomeFlowTimeline(ledgers,0)).toEqual([])
  })

  it('keeps known fields in malformed or mismatched records but withholds irreconcilable stacks',()=>{
    const malformed={generation:3,startPopulation:5,outcomes:{survived:2,hunted:1},birthsAdmitted:4,birthsEligible:4,birthsCapped:0},mismatched=flowLedger(4,5,flowOutcomes({survived:4,hunted:0}),1,1,0),[partial,wrong]=buildOutcomeFlowTimeline([malformed,mismatched])
    expect(partial).toMatchObject({generation:3,startPopulation:5,cohortFlowAvailable:false,evaluated:null,survivors:2,birthsEligible:4,birthsAdmitted:4,birthsCapped:0,birthCapState:'unavailable',exactNextPopulation:null,nextPopulationAvailable:false})
    expect(partial.outcomes).toMatchObject({survived:2,hunted:1,energy:null,unfed:null,late:null,aged:null})
    expect(wrong).toMatchObject({generation:4,cohortFlowAvailable:false,evaluated:null,survivors:4,exactNextPopulation:5,nextPopulationAvailable:true,birthCapState:'available'})
    expect(formatOutcomeFlowSummary(partial)).toContain(OUTCOME_FLOW_MISSING_TEXT)
    expect(formatOutcomeFlowSummary(partial)).toContain('Known outcomes: 2 survived, 1 hunted.')
  })

  it('rejects invalid cap identities and protects max-safe arithmetic',()=>{
    const capMismatch=flowLedger(5,6,flowOutcomes({survived:6}),5,3,1),[capEntry]=buildOutcomeFlowTimeline([capMismatch])
    expect(capEntry).toMatchObject({nextPopulationAvailable:true,exactNextPopulation:9,birthCapState:'unavailable',birthsEligible:5,birthsAdmitted:3,birthsCapped:1})
    const overEligible=flowLedger(6,6,flowOutcomes({survived:6}),1,2,0),[overEntry]=buildOutcomeFlowTimeline([overEligible])
    expect(overEntry).toMatchObject({nextPopulationAvailable:false,exactNextPopulation:null,birthCapState:'unavailable'})
    const max=Number.MAX_SAFE_INTEGER,maxEntry=flowLedger(max,max,flowOutcomes({survived:max}),max,1,max-1),[safeEntry]=buildOutcomeFlowTimeline([maxEntry])
    expect(safeEntry).toMatchObject({generation:max,startPopulation:max,evaluated:max,cohortFlowAvailable:true,nextPopulationAvailable:false,exactNextPopulation:null})
    expect(formatOutcomeFlowSummary(safeEntry)).not.toMatch(/NaN|Infinity/)
  })

  it('retains the advanced survivor maturity partition, including zero immature survivors',()=>{
    const advanced={...flowLedger(7,8,flowOutcomes({survived:8}),3,2,1),birthsImmature:2},[entry]=buildOutcomeFlowTimeline([advanced])
    expect(entry).toMatchObject({maturityState:'available',maturity:{matureEligible:3,energyReadyImmature:2,atOrBelowEnergyCost:3}})
    expect(formatOutcomeFlowSummary(entry)).toContain('Reproduction funnel: 3 mature + energy-eligible · 2 waiting for maturity · 3 at or below energy cost.')
    const zero={...flowLedger(8,4,flowOutcomes({survived:4}),4,2,2),birthsImmature:0},[zeroEntry]=buildOutcomeFlowTimeline([zero])
    expect(zeroEntry).toMatchObject({maturityState:'available',maturity:{matureEligible:4,energyReadyImmature:0,atOrBelowEnergyCost:0}})
    expect(formatOutcomeFlowSummary(zeroEntry)).toContain('Reproduction funnel: 4 mature + energy-eligible · 0 waiting for maturity · 0 at or below energy cost.')
  })

  it('distinguishes absent legacy maturity from explicit and malformed telemetry',()=>{
    const legacy=flowLedger(9,4,flowOutcomes({survived:4}),2,2,0),[legacyEntry]=buildOutcomeFlowTimeline([legacy])
    expect(legacyEntry).toMatchObject({maturityState:'missing',maturity:null})
    expect(formatOutcomeFlowSummary(legacyEntry)).toContain(OUTCOME_FLOW_MATURITY_MISSING_TEXT)
    const malformedValues:unknown[]=[undefined,null,-1,1.5,Number.NaN,Number.POSITIVE_INFINITY,Number.NEGATIVE_INFINITY,'1',true,{}]
    for(const birthsImmature of malformedValues){
      const [entry]=buildOutcomeFlowTimeline([{...legacy,birthsImmature}])
      expect(entry).toMatchObject({maturityState:'invalid',maturity:null})
      expect(formatOutcomeFlowSummary(entry)).toContain(OUTCOME_FLOW_MATURITY_INVALID_TEXT)
    }
  })

  it('reads a changing or throwing maturity getter at most once',()=>{
    let changingReads=0
    const changing=flowLedger(10,6,flowOutcomes({survived:6}),3,2,1) as unknown as Record<string,unknown>
    Object.defineProperty(changing,'birthsImmature',{enumerable:true,get(){changingReads++;return changingReads===1?1:99}})
    const [changingEntry]=buildOutcomeFlowTimeline([changing])
    expect(changingReads).toBe(1)
    expect(changingEntry).toMatchObject({maturityState:'available',maturity:{matureEligible:3,energyReadyImmature:1,atOrBelowEnergyCost:2}})
    let throwingReads=0
    const throwing=flowLedger(11,6,flowOutcomes({survived:6}),3,2,1) as unknown as Record<string,unknown>
    Object.defineProperty(throwing,'birthsImmature',{enumerable:true,get(){throwingReads++;throw new Error('unreadable')}})
    const [throwingEntry]=buildOutcomeFlowTimeline([throwing])
    expect(throwingReads).toBe(1)
    expect(throwingEntry).toMatchObject({maturityState:'invalid',maturity:null})
  })

  it('snapshots formatter accounting fields and uses outcome survivors as canonical',()=>{
    const [base]=buildOutcomeFlowTimeline([{...flowLedger(11,6,flowOutcomes({survived:6}),3,2,1),birthsImmature:1}])
    const snapshot={...base,survivors:99} as unknown as Record<string,unknown>
    let outcomesReads=0,eligibleReads=0,admittedReads=0,cappedReads=0,stateReads=0,maturityReads=0
    Object.defineProperties(snapshot,{
      outcomes:{enumerable:true,get(){outcomesReads++;if(outcomesReads>1)throw new Error('outcomes read twice');return base.outcomes}},
      birthsEligible:{enumerable:true,get(){eligibleReads++;if(eligibleReads>1)throw new Error('eligible read twice');return 3}},
      birthsAdmitted:{enumerable:true,get(){admittedReads++;if(admittedReads>1)throw new Error('admitted read twice');return 2}},
      birthsCapped:{enumerable:true,get(){cappedReads++;if(cappedReads>1)throw new Error('capped read twice');return 1}},
      maturityState:{enumerable:true,get(){stateReads++;if(stateReads>1)throw new Error('state read twice');return 'available'}},
      maturity:{enumerable:true,get(){maturityReads++;if(maturityReads>1)throw new Error('maturity read twice');return base.maturity}},
    })
    const summary=formatOutcomeFlowSummary(snapshot as never)
    expect(summary).toContain('Birth cap: eligible parents = admitted births + capped births: 3 = 2 + 1')
    expect(summary).toContain('Reproduction funnel: 3 mature + energy-eligible · 1 waiting for maturity · 2 at or below energy cost.')
    expect(summary).not.toContain('99')
    expect({outcomesReads,eligibleReads,admittedReads,cappedReads,stateReads,maturityReads}).toEqual({outcomesReads:1,eligibleReads:1,admittedReads:1,cappedReads:1,stateReads:1,maturityReads:1})
  })

  it('withholds maturity partitions when cap or survivor identities contradict',()=>{
    const capContradiction={...flowLedger(12,6,flowOutcomes({survived:6}),3,1,1),birthsImmature:1},partitionContradiction={...flowLedger(13,6,flowOutcomes({survived:6}),3,2,1),birthsImmature:4},[capEntry,partitionEntry]=buildOutcomeFlowTimeline([capContradiction,partitionContradiction])
    expect(capEntry).toMatchObject({maturityState:'invalid',maturity:null,birthCapState:'unavailable'})
    expect(partitionEntry).toMatchObject({maturityState:'invalid',maturity:null,birthCapState:'available'})
  })

  it('renders maturity buckets for available rows and Unavailable for mixed retained rows',()=>{
    const available={...flowLedger(14,8,flowOutcomes({survived:8}),3,2,1),birthsImmature:2},legacy=flowLedger(15,4,flowOutcomes({survived:4}),2,2,0),invalid={...flowLedger(16,6,flowOutcomes({survived:6}),3,2,1),birthsImmature:-1},markup=renderToStaticMarkup(createElement(HistoryChart,{world:flowWorld([available,legacy,invalid]),requestedGeneration:14,onSelectGeneration:()=>{}}))
    expect(markup).toContain('Reproduction funnel: 3 mature + energy-eligible · 2 waiting for maturity · 3 at or below energy cost.')
    expect(markup).toContain('<th scope="col">Mature + energy-eligible</th>')
    expect(markup).toContain('<th scope="col">Waiting for maturity</th>')
    expect(markup).toContain('<th scope="col">At or below energy cost</th>')
    expect(markup).toContain('<th scope="row">14</th>')
    expect(markup).toContain('<th scope="row">15</th>')
    expect(markup).toContain('<th scope="row">16</th>')
    expect(markup).toMatch(/Mature \+ energy-eligible<\/th>[\s\S]*?3<\/td>[\s\S]*?2<\/td>[\s\S]*?3<\/td>/)
    expect(markup).toMatch(/<th scope="row">15<\/th>[\s\S]*?Unavailable[\s\S]*?Unavailable[\s\S]*?Unavailable/)
    expect(markup).toMatch(/<th scope="row">16<\/th>[\s\S]*?Unavailable[\s\S]*?Unavailable[\s\S]*?Unavailable/)
    expect(markup).toContain('style="overflow-x:auto"')
    expect(markup).not.toMatch(/NaN|Infinity/)
  })

  it('keeps outcome colors readable on both card themes and gives each category a pattern cue',()=>{
    expect(OUTCOME_FLOW_LEGEND).toHaveLength(8)
    expect(new Set(OUTCOME_FLOW_LEGEND.map(item=>item.pattern)).size).toBe(OUTCOME_FLOW_LEGEND.length)
    for(const item of OUTCOME_FLOW_LEGEND)for(const surface of OUTCOME_FLOW_CARD_SURFACES)expect(contrastRatio(item.color,surface)??0).toBeGreaterThanOrEqual(3)
    expect(contrastRatio('not-a-color','#fff')).toBeNull()
  })

  it('centers outcome slots rather than placing cursors on endpoints',()=>{
    expect(outcomeFlowSlotCenter(0,1)).toBe(160)
    expect(outcomeFlowSlotCenter(0,2)).toBe(81.5)
    expect(outcomeFlowSlotCenter(1,2)).toBe(238.5)
    expect(outcomeFlowSlotCenter(0,40)).toBeCloseTo(6.925)
    expect(outcomeFlowSlotCenter(39,40)).toBeCloseTo(313.075)
    expect(outcomeFlowSlotCenter(-1,2)).toBeNull()
    expect(outcomeFlowSlotCenter(2,2)).toBeNull()
    expect(outcomeFlowSlotCenter(0,0)).toBeNull()
    expect(outcomeFlowSlotCenter(0,2,Number.NaN)).toBeNull()
    expect(outcomeFlowSlotCenter(0,2,Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('re-centers a selected slot defensively after a responsive layout change',()=>{
    expect(outcomeFlowScrollLeft(1,2,320,118,0)).toBeCloseTo(179.5)
    expect(outcomeFlowScrollLeft(0,40,320,118,0)).toBe(0)
    expect(outcomeFlowScrollLeft(39,40,320,118,0)).toBeCloseTo(202)
    expect(outcomeFlowScrollLeft(1,2,320,118,Number.NaN)).toBeNull()
    expect(outcomeFlowScrollLeft(1,2,320,0,0)).toBeNull()
  })

  it('keeps selected generation resolution and visible chart semantics synchronized',()=>{
    const first=flowLedger(1,4,flowOutcomes({survived:3,hunted:1}),2,1,1),second=flowLedger(2,4,flowOutcomes({survived:2,energy:2}),1,1,0),entries=buildOutcomeFlowTimeline([first,second])
    expect(resolveOutcomeFlowGeneration(entries,2)).toBe(2)
    expect(resolveOutcomeFlowGeneration(entries,99)).toBe(2)
    expect(resolveOutcomeFlowGeneration(entries,null)).toBe(2)
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:flowWorld([first,second]),requestedGeneration:2,onSelectGeneration:()=>{}}))
    expect(markup).toContain('Cohort fates')
    expect(markup).toContain('Next population')
    expect(markup).toContain('<span>Evaluated = survivors + losses: 4 = 2 survivors + 2 energy depleted.</span>')
    expect(markup).toContain('aria-label="Outcome flow legend"')
    expect(markup).toContain('Hunted')
    expect(markup).toContain('Admitted births')
    expect(markup).toContain('data-outcome-flow-scroll="true"')
    expect(markup).toContain('style="overflow-x:auto;width:100%"')
    expect(markup).toContain('data-outcome-flow-plot="true"')
    expect(markup).toContain('style="min-width:320px;width:100%"')
    expect(markup.match(/data-outcome-flow-scroll="true"/g)).toHaveLength(2)
    expect(markup).toContain('id="outcome-flow-cohort-hunted"')
    expect(markup).toContain('id="outcome-flow-next-births"')
    expect(markup).toContain('fill:url(#outcome-flow-cohort-hunted)')
    expect(markup).toContain('stroke="var(--paper)"')
    expect(markup).toContain('<details')
    expect(markup).toContain('Exact outcome table · 2 retained rows')
    expect(markup).toContain('style="display:flex;align-items:center;min-height:44px;padding:8px 10px;cursor:pointer;gap:6px"')
    expect(markup).toContain('class="journal-events utility-breakdown"')
    expect(markup).toContain('<th scope="col">Recorded start</th>')
    expect(markup).toContain('<th scope="col">Reconciled evaluated</th>')
    expect(markup).toContain('<th scope="col">Eligible parents</th>')
    expect(markup).toContain('<th scope="col">Birth-cap status</th>')
    expect(markup).toContain('<th scope="col">Energy depleted</th>')
    expect(markup).toContain('<th scope="row">2</th>')
    expect(markup).toContain('Exact next population')
    const legend=markup.slice(markup.indexOf('aria-label="Outcome flow legend"'),markup.indexOf('<details'))
    expect(legend).not.toContain('Capped births')
    expect(markup).not.toContain('aria-live="polite"')
    expect(markup).not.toMatch(/NaN|Infinity/)
  })

  it('renders an explicit empty state when no generation is mappable',()=>{
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:{...chartWorld([],[]),ledger:[{generation:0}]} as World,requestedGeneration:null,onSelectGeneration:()=>{}}))
    expect(markup).toContain('Outcome flow unavailable: no valid retained generation records.')
    expect(markup).not.toContain('Outcome flow legend')
  })
})

describe('energy and age history facets',()=>{
  it('keeps observed domains finite, nonnegative, data-driven, and readable for small values',()=>{
    expect(buildObservedNonnegativeDomain([null,undefined,Number.NaN,Number.POSITIVE_INFINITY,-4,0,.4])).toEqual({min:0,max:1})
    expect(buildObservedNonnegativeDomain([null,-4,1.25,3.5])).toEqual({min:0,max:3.5})
    expect(safeNonnegativeHistoryValue(null)).toBeNull()
    expect(safeNonnegativeHistoryValue(Number.NaN)).toBeNull()
    expect(safeNonnegativeHistoryValue(-1)).toBeNull()
    expect(safeNonnegativeHistoryValue(0)).toBe(0)
    expect(safeNonnegativeHistoryValue(2.5)).toBe(2.5)
    expect(safeFiniteHistoryValue(Number.NaN)).toBeNull()
    expect(safeFiniteHistoryValue(Number.POSITIVE_INFINITY)).toBeNull()
    expect(safeFiniteHistoryValue(-1)).toBe(-1)
  })

  it('renders next-population means with separate observed domains and precise wording',()=>{
    const history=[point(1,10,4.5,.25),point(2,20,2.25,3.75)]
    const firstMarkup=renderToStaticMarkup(createElement(HistoryChart,{world:{...chartWorld([], [1,2]),history},requestedGeneration:1,onSelectGeneration:()=>{}}))
    expect(firstMarkup).toContain('Gen 1 · 4.50 mean</span>')
    expect(firstMarkup).toContain('Gen 1 · 0.25 mean</span>')
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:{...chartWorld([], [1,2]),history},requestedGeneration:2,onSelectGeneration:()=>{}}))
    expect(markup).toContain('<strong>Next population</strong>')
    expect(markup).toContain('<strong>Mean energy</strong>')
    expect(markup).toContain('<strong>Mean age</strong>')
    expect(markup).toContain('<title id="history-next-population-title">Next population history</title>')
    expect(markup).toContain('Energy and age are observed means in each next population; descriptive, not causal.</p>')
    expect(markup).toContain('Gen 2 · 2.25 mean</span>')
    expect(markup).toContain('Gen 2 · 3.75 mean</span>')
    expect(markup).toContain('<desc id="history-mean-energy-description">Mean energy values across retained generations 1 through 2')
    expect(markup).toContain('<desc id="history-mean-age-description">Mean age values across retained generations 1 through 2')
    expect(markup).toContain('0.00–4.50')
    expect(markup).toContain('0.00–3.75')
    expect(markup).not.toContain('Population mean')
    expect(markup).not.toContain('<strong>Population mean</strong>')
  })

  it('renders a named journal-review button only when timeline entries exist',()=>{
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:chartWorld([]),requestedGeneration:2,onSelectGeneration:()=>{}}))
    expect(markup).toContain('>Open journal review</button>')
    expect(markup).toContain('aria-label="Open journal review for generation 2"')
    const emptyMarkup=renderToStaticMarkup(createElement(HistoryChart,{world:chartWorld([],[]),requestedGeneration:null,onSelectGeneration:()=>{}}))
    expect(emptyMarkup).not.toContain('Open journal review')
  })

  it('renders unavailable malformed values without leaking nonfinite text or path coordinates',()=>{
    const history=[point(1,10,-2,Number.NaN),point(2,20,Number.POSITIVE_INFINITY,-3)]
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:{...chartWorld([], [1,2]),history},requestedGeneration:1,onSelectGeneration:()=>{}}))
    expect(markup).toContain('<strong>Mean energy</strong><span>Gen 1 · Unavailable</span>')
    expect(markup).toContain('<strong>Mean age</strong><span>Gen 1 · Unavailable</span>')
    expect(markup).toContain('<desc id="history-mean-energy-description">Mean energy values across retained generations 1 through 2')
    expect(markup).toContain('<desc id="history-mean-age-description">Mean age values across retained generations 1 through 2')
    expect(markup).not.toMatch(/NaN|Infinity/)
    expect(markup).not.toMatch(/d="[^"]*(?:NaN|Infinity)/)
  })

  it('keeps a single observed point finite and gives it a minimum one-unit domain',()=>{
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:{...chartWorld([], [7]),history:[point(7,10,0,.5)]},requestedGeneration:null,onSelectGeneration:()=>{}}))
    expect(markup).toContain('<desc id="history-mean-energy-description">Mean energy values across retained generations 7 through 7')
    expect(markup).toContain('<desc id="history-mean-age-description">Mean age values across retained generations 7 through 7')
    expect(markup).not.toMatch(/NaN|Infinity/)
  })
})

describe('retained shock navigator',()=>{
  it('groups visible events, keeps count-zero records, and orders by day then kind',()=>{
    const entries=buildHistoryTimeline([ledger(1),ledger(2)],[point(1,10),point(2,20)],[])
    const result=buildRetainedShockNavigator(entries,[shock(2,2,'resource-bloom','late'),shock(2,1,'founder-migration','same day'),shock(2,1,'drought','zero impact',0),shock(2,1,'drought','first')])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({generation:2,label:'Gen 2 · 4 shocks',partial:false})
    expect(result.groups[0].events.map(event=>`${event.day}:${event.kind}:${event.summary}`)).toEqual(['1:drought:zero impact','1:drought:first','1:founder-migration:same day','2:resource-bloom:late'])
    expect(result.groups[0].events.some(event=>event.count===0)).toBe(true)
    expect(result.groups[0].ariaLabel.length).toBeLessThanOrEqual(RETAINED_SHOCK_ARIA_LABEL_LIMIT)
    expect(result.groups[0].ariaLabel).toContain('Drought: zero impact')
    expect(formatRetainedShockNavigatorNotice(result)).toContain(RETAINED_SHOCK_CONTEXT)
    expect(formatRetainedShockNavigatorNotice(result)).toContain(RETAINED_SHOCK_ORDER_NOTE)
  })

  it('limits groups to the latest forty visible completed generations',()=>{
    const ledgers=Array.from({length:MAX_TIMELINE_ENTRIES+5},(_,index)=>ledger(index+1)),history=ledgers.map(item=>point(item.generation,item.generation)),entries=buildHistoryTimeline(ledgers,history,[]),result=buildRetainedShockNavigator(entries,[shock(5,0,'drought','too old'),shock(6,0,'drought','first visible'),shock(45,0,'resource-bloom','latest')])
    expect(entries[0].generation).toBe(6)
    expect(result.groups.map(group=>group.generation)).toEqual([6,45])
  })

  it('skips malformed records that cannot support truthful copy',()=>{
    const entries=buildHistoryTimeline([ledger(2)],[point(2,20)],[]),valid=shock(2,1,'drought','valid'),malformed:WorldEvent[]=[valid,shock(0,0,'drought','initial state, not a completed generation'),shock(2,-1,'drought','negative day'),shock(2,Number.NaN,'drought','unknown day'),shock(2,0,'drought','   \t'),{...shock(2,0,'resource-bloom','unknown kind'),kind:'unknown' as WorldEvent['kind']},{...shock(2,0,'resource-bloom','unknown generation'),generation:Number.POSITIVE_INFINITY},{...shock(2,0,'resource-bloom','not visible'),generation:3}]
    const result=buildRetainedShockNavigator(entries,malformed)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].events).toEqual([valid])
  })

  it('warns about a full 60-event buffer and marks the oldest visible generation partial',()=>{
    const entries=buildHistoryTimeline([ledger(1),ledger(2)],[point(1,10),point(2,20)],[]),events=[shock(1,0,'drought','oldest'),...Array.from({length:59},(_,index)=>shock(2,index/10,'resource-bloom',`newer ${index}`))],result=buildRetainedShockNavigator(entries,events),notice=formatRetainedShockNavigatorNotice(result)
    expect(result.bufferFull).toBe(true)
    expect(result.partialOldestGeneration).toBe(1)
    expect(result.groups[0].partial).toBe(true)
    expect(notice).toContain('60-event buffer is full')
    expect(notice).toContain('earlier shocks may be missing')
    expect(notice).toContain('Generation 1 is the oldest marked generation')
    expect(notice).toContain('may be partial')
  })

  it('warns about a full buffer without falsely marking a visible group partial when older records are outside it',()=>{
    const entries=buildHistoryTimeline([ledger(2),ledger(3)],[point(2,20),point(3,30)],[]),result=buildRetainedShockNavigator(entries,[shock(1,0,'drought','outside visible history'),shock(1,1,'drought','outside visible history two'),shock(2,0,'resource-bloom','visible')],3),notice=formatRetainedShockNavigatorNotice(result)
    expect(result.groups.map(group=>group.generation)).toEqual([2])
    expect(result.partialOldestGeneration).toBeNull()
    expect(notice).toContain('3-event buffer is full')
    expect(notice).not.toContain('may be partial')
  })

  it('warns when a full event buffer has no valid shock group in the visible window',()=>{
    const entries=buildHistoryTimeline([ledger(2),ledger(3)],[point(2,20),point(3,30)],[]),result=buildRetainedShockNavigator(entries,Array.from({length:60},(_,index)=>shock(1,index,'drought',`outside ${index}`))),notice=formatRetainedShockNavigatorNotice(result)
    expect(result.groups).toEqual([])
    expect(notice).toContain('60-event buffer is full')
    expect(notice).toContain('no retained shocks overlap the visible completed-generation window')
    expect(notice).toContain('Earlier shocks may be missing')
  })

  it('renders no navigator markup for a normal no-event timeline',()=>{
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:chartWorld([]),requestedGeneration:null,onSelectGeneration:()=>{}}))
    expect(markup).not.toContain(RETAINED_SHOCK_CONTEXT)
    expect(markup).not.toContain('Retained shocks by generation')
  })

  it('renders selected generation buttons with accessible pressed/current state',()=>{
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:chartWorld([shock(1,0,'drought','first'),shock(2,0,'resource-bloom','second')]),requestedGeneration:1,onSelectGeneration:()=>{}}))
    expect(markup).toContain('aria-label="Retained shocks by generation"')
    expect(markup).toContain('aria-current="true" aria-pressed="true"')
    expect(markup).toContain('aria-pressed="false"')
    expect(markup).toContain('class="settings-toggle journal-latest"')
    expect(markup).toContain('>Gen 1 · 1 shock</button>')
    expect(markup).toContain('>Gen 2 · 1 shock</button>')
    expect(markup).toContain('Drought: first')
    expect(markup).toContain('observational context, not proof of cause')
  })

  it('renders only a noninteractive full-buffer warning when no retained shock overlaps the chart',()=>{
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:chartWorld(Array.from({length:60},(_,index)=>shock(1,index,'drought',`outside ${index}`)),[2,3]),requestedGeneration:null,onSelectGeneration:()=>{}}))
    expect(markup).toContain('class="journal-warning"')
    expect(markup).toContain('no retained shocks overlap the visible completed-generation window')
    expect(markup).toContain('Earlier shocks may be missing')
    expect(markup).not.toContain('Retained shocks by generation')
    expect(markup).not.toContain('settings-toggle journal-latest')
  })
})

describe('observed generation deltas',()=>{
  it('compares generation one with the retained generation zero baseline',()=>{
    const result=buildGenerationDelta([point(1,14,9,3),point(0,10,8,2)],1)
    expect(result).toMatchObject({status:'available',generation:1,previousGeneration:0,population:4,meanEnergy:1,meanAge:1})
    expect(result.traits.speed).toBe(0)
  })

  it('compares a pinned generation with its exact predecessor, not the latest point',()=>{
    const result=buildGenerationDelta([point(0,10,8,2),point(1,14,9,3),point(2,20,12,4)],1)
    expect(result).toMatchObject({generation:1,previousGeneration:0,population:4,meanEnergy:1,meanAge:1})
  })

  it('formats positive, negative, zero, and six-trait movement explicitly',()=>{
    const result=buildGenerationDelta([point(0,10,8,2),{...point(1,8,7.125,2),avgSpeed:1.2,avgSize:.8,avgSense:.2,avgAggression:.4,avgCaution:.7,avgExploration:.5}],1)
    const text=formatGenerationDelta(result)
    expect(text).toContain('population -2')
    expect(text).toContain('mean energy -0.88')
    expect(text).toContain('mean age 0')
    expect(text).toContain('speed +0.20')
    expect(text).toContain('size -0.20')
    expect(text).toContain('sense 0')
    expect(text).toContain('caution +0.20')
    expect(text).not.toMatch(/because|caused|led to|impact/i)
  })

  it('marks missing selections, predecessors, and nonfinite metrics as unavailable',()=>{
    expect(formatGenerationDelta(buildGenerationDelta([point(0,10)],null))).toContain('no retained generation is selected')
    expect(formatGenerationDelta(buildGenerationDelta([point(0,10)],1))).toContain('generation is not retained')
    expect(formatGenerationDelta(buildGenerationDelta([point(2,12)],2))).toContain('generation 1 is not retained')
    const result=buildGenerationDelta([point(0,10,8,2),{...point(1,12,Number.NaN,null),avgSpeed:null}],1)
    expect(formatGenerationDelta(result)).toContain('mean energy unavailable')
    expect(formatGenerationDelta(result)).toContain('mean age unavailable')
    expect(formatGenerationDelta(result)).toContain('speed unavailable')
  })
})

describe('generation ruler and chart semantics',()=>{
  it('keeps unique first, middle, and last retained generations for gaps and short histories',()=>{
    const entries=[{generation:2},{generation:4},{generation:9},{generation:15}]
    expect(buildGenerationRuler(entries,9)).toEqual([
      {generation:2,index:0,position:'first',selected:false},
      {generation:9,index:2,position:'middle',selected:true},
      {generation:15,index:3,position:'last',selected:false},
    ])
    expect(buildGenerationRuler([{generation:7}],7)).toEqual([{generation:7,index:0,position:'first',selected:true}])
    expect(buildGenerationRuler([{generation:2},{generation:9}],2).map(mark=>mark.generation)).toEqual([2,9])
    expect(buildGenerationRuler([{generation:2},{generation:Number.NaN},{generation:4},{generation:4},{generation:9},{generation:Number.POSITIVE_INFINITY}] as {generation:number}[],4).map(mark=>mark.generation)).toEqual([2,4,9])
    expect(buildGenerationRuler([{generation:2}],Number.NaN)).toEqual([{generation:2,index:0,position:'first',selected:false}])
  })

  it('adds a selected interior generation without losing exact chart positions',()=>{
    const entries=[{generation:2},{generation:4},{generation:9},{generation:15},{generation:20},{generation:27}]
    expect(buildGenerationRuler(entries,4).map(mark=>({generation:mark.generation,index:mark.index,position:mark.position,selected:mark.selected}))).toEqual([
      {generation:2,index:0,position:'first',selected:false},
      {generation:4,index:1,position:'selected',selected:true},
      {generation:15,index:3,position:'middle',selected:false},
      {generation:27,index:5,position:'last',selected:false},
    ])
    expect(generationRulerOffset(0,1)).toBe(50)
    expect(generationRulerOffset(0,2)).toBeCloseTo(3/320*100)
    expect(generationRulerOffset(1,2)).toBeCloseTo(317/320*100)
    expect(generationRulerOffset(0,4)).toBeCloseTo(3/320*100)
    expect(generationRulerOffset(2,4)).toBeCloseTo((3+2/3*314)/320*100)
    expect(generationRulerOffset(0,6)).toBeCloseTo(3/320*100)
    expect(generationRulerOffset(3,6)).toBeCloseTo((3+3/5*314)/320*100)
    expect(generationRulerOffset(5,6)).toBeCloseTo(317/320*100)
    expect(generationRulerOffset(-1,6)).toBeNull()
    expect(generationRulerOffset(0,0)).toBeNull()
    expect(generationRulerOffset(0,6,Number.NaN)).toBeNull()
  })

  it('keeps the ruler selection aligned with the history slider and gives every history SVG unique semantics',()=>{
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:chartWorld([],[2,4,9,15]),requestedGeneration:9,onSelectGeneration:()=>{}}))
    expect(markup).toContain('class="generation-ruler"')
    expect(markup).toContain('Earlier generations → later generations')
    expect(markup).toContain('Inspecting Gen 9')
    expect(markup).toContain('aria-current="true" aria-label="Generation 9 selected"')
    expect(markup).toContain('width:64px')
    expect(markup).toContain('white-space:nowrap')
    expect(markup).toContain('id="history-next-population-title"')
    expect(markup).toContain('id="history-next-population-description"')
    expect(markup).toContain('aria-labelledby="history-next-population-title" aria-describedby="history-next-population-description"')
    expect(markup).toContain('preserveAspectRatio="none"')
    expect(markup).toContain('id="history-speed-title"')
    expect(markup).not.toContain('aria-label="Next population history')
    expect(markup).toContain('value="2"')
    expect(markup).toContain('<th scope="col">Generation</th>')
    expect(markup).toContain('<th scope="row">2</th>')
    expect(markup).not.toMatch(/NaN|Infinity/)
    const semanticIds=Array.from(markup.matchAll(/<(?:title|desc) id="([^"]+)"/g),match=>match[1])
    expect(semanticIds.length).toBeGreaterThan(0)
    expect(new Set(semanticIds).size).toBe(semanticIds.length)
  })

  it('gives behavior history the same selected ruler and scoped accessible table',()=>{
    const markup=renderToStaticMarkup(createElement(BehaviorHistory,{world:chartWorld([],[2,4,9,15]),requestedGeneration:9}))
    expect(markup).toContain('Generation ruler from Gen 2 to Gen 15')
    expect(markup).toContain('Inspecting Gen 9')
    expect(markup).toContain('width:56px')
    expect(markup).toContain('id="behavior-aggression-line-title"')
    expect(markup).toContain('aria-labelledby="behavior-aggression-line-title" aria-describedby="behavior-aggression-line-description"')
    expect(markup).not.toContain('aria-label="Aggression, selected generation')
    expect(markup).toContain('<th scope="col">Aggression mean</th>')
    expect(markup).toContain('<th scope="col">Exploration SD</th>')
    expect(markup).toContain('<th scope="row">2</th>')
    const row=markup.match(/<tr><th scope="row">2<\/th>(.*?)<\/tr>/)?.[1]??''
    expect(row.match(/<td>/g)).toHaveLength(6)
    expect(markup).not.toMatch(/NaN|Infinity/)
  })
})

describe('selection shifts across generations',()=>{
  it('computes survivor and reproducer deltas from selection summaries',()=>{
    const [row]=buildSelectionShiftTimeline([selectionLedger(1,1,1.25,.75)])
    expect(row).toMatchObject({generation:1,evaluatedCount:4,survivorCount:3,reproducerCount:2,evaluatedMean:1,survivorMean:1.25,reproducerMean:.75,survivorDelta:.25,reproducerDelta:-.25,selectionAvailable:true})
  })

  it('keeps finite zero as zero and does not read inheritance parentMean',()=>{
    const [row]=buildSelectionShiftTimeline([selectionLedger(1,0,0,0)])
    expect(row).toMatchObject({evaluatedMean:0,survivorMean:0,reproducerMean:0})
    expect(row.survivorDelta).toBe(0)
    expect(row.reproducerDelta).toBe(0)
    const [mismatch]=buildSelectionShiftTimeline([selectionLedger(2,1,1.2,.8)])
    expect(mismatch.survivorDelta).toBeCloseTo(.2)
    expect(mismatch.reproducerDelta).toBeCloseTo(-.2)
  })

  it('marks empty, malformed, and legacy records unavailable without false zero',()=>{
    const [empty]=buildSelectionShiftTimeline([selectionLedger(1,0,0,0,{start:0,survivors:0,births:0})])
    expect(empty).toMatchObject({evaluatedCount:0,survivorCount:0,reproducerCount:0,evaluatedMean:0,survivorMean:0,reproducerMean:0,survivorDelta:null,reproducerDelta:null})
    const malformed={generation:2,startPopulation:'4',outcomes:{survived:3},birthsAdmitted:Number.POSITIVE_INFINITY,selection:{start:{speed:{mean:Number.NaN}},survivor:{speed:{mean:Number.POSITIVE_INFINITY}},reproducer:{speed:{mean:0}}}}
    const [bad]=buildSelectionShiftTimeline([malformed])
    expect(bad).toMatchObject({evaluatedCount:null,survivorCount:3,reproducerCount:null,evaluatedMean:null,survivorMean:null,reproducerMean:0,survivorDelta:null,reproducerDelta:null,selectionAvailable:true})
    const [legacy]=buildSelectionShiftTimeline([{generation:3,startPopulation:4,outcomes:{survived:3},birthsAdmitted:2}])
    expect(legacy).toMatchObject({evaluatedCount:4,survivorCount:3,reproducerCount:2,evaluatedMean:null,survivorMean:null,reproducerMean:null,survivorDelta:null,reproducerDelta:null,selectionAvailable:false})
    expect(JSON.stringify([empty,bad,legacy])).not.toMatch(/NaN|Infinity/)
  })

  it('rejects impossible nested cohort counts instead of plotting authoritative shifts',()=>{
    const [tooManySurvivors]=buildSelectionShiftTimeline([selectionLedger(1,1,1.2,.8,{start:2,survivors:3,births:1})])
    expect(tooManySurvivors).toMatchObject({survivorDelta:null,reproducerDelta:null})
    const [tooManyParents]=buildSelectionShiftTimeline([selectionLedger(2,1,1.2,.8,{start:3,survivors:1,births:2})])
    expect(tooManyParents.survivorDelta).toBeCloseTo(.2)
    expect(tooManyParents.reproducerDelta).toBeNull()
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:{...chartWorld([],[1]),ledger:[selectionLedger(1,1,1.2,.8,{start:2,survivors:3,births:1})]} as World,requestedGeneration:1,onSelectGeneration:()=>{}}))
    expect(markup).toContain('Unavailable (inconsistent cohort counts)')
  })

  it('renders one compact zero-centered facet with shared generation semantics and one native trait selector',()=>{
    const ledgers=[selectionLedger(1,1,1.25,.75),selectionLedger(2,1,1,.9)]
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:{...chartWorld([],[1,2]),ledger:ledgers} as World,requestedGeneration:2,onSelectGeneration:()=>{}}))
    expect(markup.match(/<select/g)).toHaveLength(1)
    expect(markup).toContain('data-selection-shift="true"')
    expect(markup).toContain('Selection shifts across generations')
    expect(markup).toContain('Shift = cohort mean − evaluated mean')
    expect(markup).toContain('Descriptive association, not proof of cause.')
    expect(markup).toContain('Solid:</strong> survivors − evaluated')
    expect(markup).toContain('Dashed:</strong> parents of newborns − evaluated')
    expect(markup).toContain('<strong>Positive:</strong> above evaluated')
    expect(markup).toContain('<strong>Negative:</strong> below')
    expect(markup).toContain('<strong>Zero:</strong> same mean')
    expect(markup).toContain('zero line shown')
    expect(markup).toContain('Inspecting Gen 2')
    expect(markup).toContain('data-selection-shift-table="true"')
    expect(markup).toContain('<circle class="history-point" data-selection-shift-marker="survivors"')
    expect(markup).toContain('<rect class="history-point" data-selection-shift-marker="parents"')
    expect(markup).toContain('<th scope="col">Evaluated count</th>')
    expect(markup).toContain('<th scope="col">Parents of newborns delta</th>')
    expect(markup.match(/data-selected-generation="true"/g)).toHaveLength(1)
    expect(markup).not.toMatch(/NaN|Infinity/)
  })

  it('states one-generation, no-birth, and legacy limitations plainly',()=>{
    const oneGeneration=renderToStaticMarkup(createElement(HistoryChart,{world:{...chartWorld([],[7]),ledger:[selectionLedger(7,1,1.1,1,{start:4,survivors:3,births:0})]} as World,requestedGeneration:7,onSelectGeneration:()=>{}}))
    expect(oneGeneration).toContain('One retained generation: no across-generation trend yet')
    expect(oneGeneration).toContain('Parents of newborns unavailable: no admitted births were recorded.')
    const legacy=renderToStaticMarkup(createElement(HistoryChart,{world:{...chartWorld([],[7]),ledger:[{generation:7,startPopulation:4,outcomes:{survived:3},birthsAdmitted:2}]} as unknown as World,requestedGeneration:7,onSelectGeneration:()=>{}}))
    expect(legacy).toContain('Selection shifts unavailable: retained ledgers have no selection summaries.')
    expect(legacy).toContain('Unavailable')
    expect(legacy).not.toMatch(/NaN|Infinity/)
  })

  it('formats positive, negative, zero, and unavailable labels explicitly',()=>{
    expect(formatSelectionShiftValue(.25)).toBe('+0.25')
    expect(formatSelectionShiftValue(-.25)).toBe('-0.25')
    expect(formatSelectionShiftValue(0)).toBe('0')
    expect(formatSelectionShiftValue(null)).toBe('Unavailable')
  })
})
