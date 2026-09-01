import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BEHAVIOR_HISTORY_CONTEXT, buildGenerationDelta, buildHistoryTimeline, buildObservedNonnegativeDomain, buildRetainedShockNavigator, buildSpeedHistogram, formatGenerationDelta, formatRetainedShockNavigatorNotice, formatTimelineSummary, HistoryChart, historyCoordinate, MAX_TIMELINE_ENTRIES, RETAINED_SHOCK_ARIA_LABEL_LIMIT, RETAINED_SHOCK_CONTEXT, RETAINED_SHOCK_ORDER_NOTE, resolveTimelineGeneration, safeNonnegativeHistoryValue, SPEED_HISTOGRAM_DOMAIN, traitColor } from './Charts'
import { speedColor } from './ArenaCanvas'
import type { GenerationLedger, HistoryPoint, World, WorldEvent } from '../simulation/types'

const ledger=(generation:number,birthsAdmitted=generation%3):GenerationLedger=>({generation,birthsAdmitted,outcomes:{survived:4,hunted:0,energy:0,unfed:0,late:0,aged:0}} as GenerationLedger)
const point=(generation:number,population:number,avgEnergy:number|null=10,avgAge:number|null=2):HistoryPoint=>({generation,population,avgSpeed:1,avgSize:1,avgSense:.2,avgAggression:.4,avgCaution:.5,avgExploration:.6,sdSpeed:0,sdSize:0,sdSense:0,sdAggression:0,sdCaution:0,sdExploration:0,avgEnergy,avgAge})
const shock=(generation:number,day:number,kind:WorldEvent['kind']='drought',summary=`${kind} recorded`,count=1):WorldEvent=>({generation,day,kind,summary,count})
const chartWorld=(events:readonly WorldEvent[],generations=[1,2]):World=>({ledger:generations.map(generation=>ledger(generation)),history:generations.map(generation=>point(generation,generation*10)),events:[...events]} as unknown as World)

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

describe('energy and age history facets',()=>{
  it('keeps observed domains finite, nonnegative, data-driven, and readable for small values',()=>{
    expect(buildObservedNonnegativeDomain([null,undefined,Number.NaN,Number.POSITIVE_INFINITY,-4,0,.4])).toEqual({min:0,max:1})
    expect(buildObservedNonnegativeDomain([null,-4,1.25,3.5])).toEqual({min:0,max:3.5})
    expect(safeNonnegativeHistoryValue(null)).toBeNull()
    expect(safeNonnegativeHistoryValue(Number.NaN)).toBeNull()
    expect(safeNonnegativeHistoryValue(-1)).toBeNull()
    expect(safeNonnegativeHistoryValue(0)).toBe(0)
    expect(safeNonnegativeHistoryValue(2.5)).toBe(2.5)
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
    expect(markup).toContain('aria-label="Next population, selected generation 2, 20 creatures, scale 0 to 20."')
    expect(markup).toContain('Energy and age are observed means in each next population; descriptive, not causal.</p>')
    expect(markup).toContain('Gen 2 · 2.25 mean</span>')
    expect(markup).toContain('Gen 2 · 3.75 mean</span>')
    expect(markup).toContain('Mean energy history, selected generation 2, observed mean 2.25 in the next population; descriptive, not causal, scale 0.00 to 4.50.')
    expect(markup).toContain('Mean age history, selected generation 2, observed mean 3.75 in the next population; descriptive, not causal, scale 0.00 to 3.75.')
    expect(markup).toContain('0.00–4.50')
    expect(markup).toContain('0.00–3.75')
    expect(markup).not.toContain('Population mean')
    expect(markup).not.toContain('<strong>Population mean</strong>')
  })

  it('renders unavailable malformed values without leaking nonfinite text or path coordinates',()=>{
    const history=[point(1,10,-2,Number.NaN),point(2,20,Number.POSITIVE_INFINITY,-3)]
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:{...chartWorld([], [1,2]),history},requestedGeneration:1,onSelectGeneration:()=>{}}))
    expect(markup).toContain('<strong>Mean energy</strong><span>Gen 1 · Unavailable</span>')
    expect(markup).toContain('<strong>Mean age</strong><span>Gen 1 · Unavailable</span>')
    expect(markup).toContain('Mean energy history, selected generation 1, observed mean unavailable in the next population; descriptive, not causal, scale 0.00 to 1.00.')
    expect(markup).toContain('Mean age history, selected generation 1, observed mean unavailable in the next population; descriptive, not causal, scale 0.00 to 1.00.')
    expect(markup).not.toMatch(/NaN|Infinity/)
    expect(markup).not.toMatch(/d="[^"]*(?:NaN|Infinity)/)
  })

  it('keeps a single observed point finite and gives it a minimum one-unit domain',()=>{
    const markup=renderToStaticMarkup(createElement(HistoryChart,{world:{...chartWorld([], [7]),history:[point(7,10,0,.5)]},requestedGeneration:null,onSelectGeneration:()=>{}}))
    expect(markup).toContain('Mean energy history, selected generation 7, observed mean 0.00 in the next population; descriptive, not causal, scale 0.00 to 1.00.')
    expect(markup).toContain('Mean age history, selected generation 7, observed mean 0.50 in the next population; descriptive, not causal, scale 0.00 to 1.00.')
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
