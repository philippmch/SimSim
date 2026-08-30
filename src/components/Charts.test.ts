import { describe, expect, it } from 'vitest'
import { buildHistoryTimeline, buildSpeedHistogram, formatTimelineSummary, historyCoordinate, MAX_TIMELINE_ENTRIES, resolveTimelineGeneration, SPEED_HISTOGRAM_DOMAIN, traitColor } from './Charts'
import { speedColor } from './ArenaCanvas'
import type { GenerationLedger, HistoryPoint, WorldEvent } from '../simulation/types'

const ledger=(generation:number,birthsAdmitted=generation%3):GenerationLedger=>({generation,birthsAdmitted,outcomes:{survived:4,hunted:0,energy:0,unfed:0,late:0,aged:0}} as GenerationLedger)
const point=(generation:number,population:number,avgEnergy:number|null=10,avgAge:number|null=2):HistoryPoint=>({generation,population,avgSpeed:1,avgSize:1,avgSense:.2,avgAggression:.4,avgCaution:.5,avgExploration:.6,sdSpeed:0,sdSize:0,sdSense:0,sdAggression:0,sdCaution:0,sdExploration:0,avgEnergy,avgAge})

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
    expect(formatTimelineSummary(withEvents)).toContain('1 retained event')
    expect(formatTimelineSummary({...withEvents,nextMeanEnergy:8.125,outcomes:{...withEvents.outcomes,unfed:1}})).toContain('mean energy 8.13')
    expect(formatTimelineSummary({...withEvents,nextMeanEnergy:8.125,outcomes:{...withEvents.outcomes,unfed:1}})).toContain('1 returned unfed')
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
