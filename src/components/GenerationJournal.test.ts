import { describe, expect, it } from 'vitest'
import type { GenerationLedger, WorldEvent } from '../simulation/types'
import { clampJournalGeneration, deriveGenerationReview, deriveJournalEvents, filterJournalEvents, getJournalEventStatus, getRecentGenerationLedgers, MAX_JOURNAL_ENTRIES, pinCurrentGeneration, resolveJournalSelection } from './GenerationJournal'

const moments=(mean:number|null)=>({mean,variance:mean===null?null:0,sd:mean===null?null:0})
const selection=(mean:number|null)=>({speed:moments(mean),size:moments(mean),sense:moments(mean),aggression:moments(mean),caution:moments(mean),exploration:moments(mean)})
const makeLedger=(generation:number,overrides:Partial<GenerationLedger>={}):GenerationLedger=>({
  generation,startPopulation:5,
  outcomes:{survived:3,hunted:1,energy:0,unfed:1,late:0,aged:0},
  foodAtStart:12,foodProduced:5,foodRemoved:3,foodConsumed:4,foodRemaining:10,
  preyConsumed:2,attackAttempts:4,attackSuccesses:2,attackFailures:2,
  birthsEligible:2,birthsAdmitted:1,birthsCapped:1,
  selection:{start:selection(1),survivor:selection(1.1),reproducer:selection(1.2)},
  ...overrides,
})

describe('generation journal helpers',()=>{
  it('handles an empty run without inventing a selected generation',()=>{
    expect(getRecentGenerationLedgers([])).toEqual([])
    expect(clampJournalGeneration([],null)).toBeNull()
    expect(resolveJournalSelection([],null)).toMatchObject({entries:[],selectedGeneration:null,followsLatest:true})
    expect(deriveGenerationReview(undefined)).toBeNull()
    expect(filterJournalEvents([],null)).toEqual([])
  })

  it('bounds the selector to the latest forty retained ledgers',()=>{
    const ledgers=Array.from({length:MAX_JOURNAL_ENTRIES+5},(_,index)=>makeLedger(index+1))
    const recent=getRecentGenerationLedgers(ledgers)
    expect(recent).toHaveLength(MAX_JOURNAL_ENTRIES)
    expect(recent[0].generation).toBe(6)
    expect(recent.at(-1)?.generation).toBe(45)
    expect(resolveJournalSelection(ledgers,null)).toMatchObject({selectedGeneration:45,followsLatest:true})
  })

  it('keeps pins, follows latest on request, and clamps a removed pin',()=>{
    const ledgers=Array.from({length:45},(_,index)=>makeLedger(index+1))
    expect(resolveJournalSelection(ledgers,12)).toMatchObject({selectedGeneration:12,followsLatest:false})
    expect(clampJournalGeneration(ledgers,2)).toBe(6)
    expect(clampJournalGeneration(ledgers,999)).toBe(45)
    expect(resolveJournalSelection(ledgers,null).followsLatest).toBe(true)
  })

  it('pins the current generation distinctly, even before a second ledger exists',()=>{
    const first=[makeLedger(1)],pinned=pinCurrentGeneration(first,null)
    expect(pinned).toBe(1)
    expect(resolveJournalSelection(first,pinned)).toMatchObject({selectedGeneration:1,followsLatest:false})
    expect(resolveJournalSelection([...first,makeLedger(2)],pinned)).toMatchObject({selectedGeneration:1,followsLatest:false})
  })

  it('filters shocks to the selected generation and orders them by day',()=>{
    const events:WorldEvent[]=[
      {generation:2,day:4,kind:'drought',summary:'later',count:1},
      {generation:1,day:2,kind:'resource-bloom',summary:'other generation',count:2},
      {generation:2,day:1,kind:'resource-bloom',summary:'first',count:3},
      {generation:2,day:3,kind:'founder-migration',summary:'2 new founders migrated into the population.',count:2},
    ]
    expect(filterJournalEvents(events,2).map(event=>event.summary)).toEqual(['first','2 new founders migrated into the population.','later'])
    expect(filterJournalEvents(events,1)).toHaveLength(1)
    expect(filterJournalEvents(events,null)).toEqual([])
    expect(deriveJournalEvents(events,2).status).toBe('events')
    const migrationReview=deriveGenerationReview(makeLedger(2,{startPopulation:7,outcomes:{survived:5,hunted:1,energy:0,unfed:1,late:0,aged:0}}))!
    expect(migrationReview.evaluatedPopulation).toBe(7)
    expect(filterJournalEvents(events,2).some(event=>event.kind==='founder-migration'&&event.count===2)).toBe(true)
  })

  it('labels an old review conservatively once the independent event buffer is full',()=>{
    const events:Array<WorldEvent>=Array.from({length:60},(_,index)=>({generation:5,day:index,kind:'drought',summary:'retained shock',count:1}))
    expect(getJournalEventStatus(events,4)).toBe('unknown')
    expect(deriveJournalEvents(events,4)).toMatchObject({events:[],status:'unknown'})
    expect(getJournalEventStatus(events,6)).toBe('none')
  })

  it('warns when only the tail of a generation may remain in a full event buffer',()=>{
    const events:Array<WorldEvent>=[
      ...Array.from({length:5},(_,index)=>({generation:4,day:index+5,kind:'drought' as const,summary:'retained old shock',count:1})),
      ...Array.from({length:55},(_,index)=>({generation:5,day:index,kind:'resource-bloom' as const,summary:'newer shock',count:1})),
    ]
    const partial=deriveJournalEvents(events,4)
    expect(partial.status).toBe('partial')
    expect(partial.events).toHaveLength(5)
    expect(partial.events[0]).toMatchObject({generation:4,day:5})
    expect(getJournalEventStatus(events,5)).toBe('events')
  })

  it('derives reconciled outcomes, resources, attacks, births, and selection text',()=>{
    const review=deriveGenerationReview(makeLedger(7))!
    expect(review.evaluatedPopulation).toBe(5)
    expect(review.outcomes.map(outcome=>outcome.label)).toEqual(['Survived','Hunted','Energy depleted','Returned without enough food','Missed return deadline','Old age'])
    expect(review.outcomes.reduce((sum,outcome)=>sum+outcome.count,0)).toBe(review.evaluatedPopulation)
    expect(review.resource).toMatchObject({start:12,produced:5,removed:3,consumed:4,remaining:10,expected:10,reconciled:true})
    expect(review.attacks).toEqual({attempts:4,wins:2,failures:2,preyConsumed:2})
    expect(review.births).toEqual({eligible:2,admitted:1,capped:1})
    expect(review.takeaway).toContain('Generation 7')
  })

  it('makes extinction and no-birth reviews explicit',()=>{
    const review=deriveGenerationReview(makeLedger(8,{outcomes:{survived:0,hunted:1,energy:2,unfed:1,late:0,aged:1},birthsEligible:0,birthsAdmitted:0,birthsCapped:0,foodAtStart:0,foodProduced:0,foodRemoved:0,foodConsumed:0,foodRemaining:0}))!
    expect(review.survivors).toBe(0)
    expect(review.births).toEqual({eligible:0,admitted:0,capped:0})
    expect(review.takeaway).toContain('no survivors')
    expect(review.resource.reconciled).toBe(true)
  })
})
