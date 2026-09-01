import { describe, expect, it } from 'vitest'
import { meetsStandardizedEffectThreshold, SELECTION_PATTERN_THRESHOLD } from '../simulation/engine'
import type { BiologicalTrait, GenerationLedger, InheritanceTraitSummary, SelectionSummary, TraitMoments, WorldEvent } from '../simulation/types'
import { clampJournalGeneration, deriveGenerationInterpretation, deriveGenerationReview, deriveInheritanceAudit, deriveJournalEvents, derivePressureFingerprints, filterJournalEvents, formatAdaptivePair, formatAttackAttemptLabel, formatAttackBasisNote, getJournalEventStatus, getRecentGenerationLedgers, MAX_JOURNAL_ENTRIES, pinCurrentGeneration, resolveJournalSelection } from './GenerationJournal'

const moments=(mean:number|null)=>({mean,variance:mean===null?null:0,sd:mean===null?null:0})
const selection=(mean:number|null)=>({speed:moments(mean),size:moments(mean),sense:moments(mean),aggression:moments(mean),caution:moments(mean),exploration:moments(mean)})
const traitKeys:readonly BiologicalTrait[]=['speed','size','sense','aggression','caution','exploration']
const profile=(overrides:Partial<Record<BiologicalTrait,TraitMoments>>={},fallback=moments(1)):SelectionSummary=>Object.fromEntries(traitKeys.map(trait=>[trait,overrides[trait]??fallback])) as SelectionSummary
const inheritanceProfile=(overrides:Partial<Record<BiologicalTrait,InheritanceTraitSummary>>={}):Record<BiologicalTrait,InheritanceTraitSummary>=>Object.fromEntries(traitKeys.map(trait=>[trait,overrides[trait]??{parentMean:1,offspringMean:1,changedCount:0}])) as Record<BiologicalTrait,InheritanceTraitSummary>
const makeLedger=(generation:number,overrides:Partial<GenerationLedger>={}):GenerationLedger=>({
  generation,startPopulation:5,
  outcomes:{survived:3,hunted:1,energy:0,unfed:1,late:0,aged:0},
  foodAtStart:12,foodProduced:5,foodRemoved:3,foodConsumed:4,foodRemaining:10,
  preyConsumed:1,attackAttempts:2,attackSuccesses:1,attackFailures:0,attackContested:1,attackAttemptBasis:'claims',
  birthsEligible:2,birthsAdmitted:1,birthsCapped:1,
  selection:{start:selection(1),survivor:selection(1.1),reproducer:selection(1.2)},
  selectionByOutcome:{survived:selection(1),hunted:selection(1),energy:selection(null),unfed:selection(1),late:selection(null),aged:selection(null)},
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
    expect(review).toMatchObject({nextPopulation:4,populationChange:-1})
    expect(review.outcomes.map(outcome=>outcome.label)).toEqual(['Survived','Hunted','Energy depleted','No food at settlement','Missed return deadline','Old age'])
    expect(review.outcomes.reduce((sum,outcome)=>sum+outcome.count,0)).toBe(review.evaluatedPopulation)
    expect(review.resource).toMatchObject({start:12,produced:5,removed:3,consumed:4,remaining:10,expected:10,reconciled:true})
    expect(review.attacks).toEqual({attempts:2,attemptBasis:'claims',wins:1,failures:0,contested:1,preyConsumed:1})
    expect(review.births).toEqual({eligible:2,admitted:1,capped:1})
    expect(review.takeaway).toContain('Generation 7')
  })

  it('carries exact contested same-prey claims from a new ledger',()=>{
    const review=deriveGenerationReview(makeLedger(26,{attackAttempts:4,attackContested:3}))!
    expect(review.attacks).toMatchObject({attempts:4,attemptBasis:'claims',wins:1,failures:0,contested:3})
    expect(formatAttackAttemptLabel(review.attacks.attemptBasis)).toBe('Attack attempts (total claims)')
    expect(formatAttackBasisNote(review.attacks.attemptBasis)).toContain('including contested same-prey claims')
  })

  it('labels admitted contest attempts separately from excluded claims',()=>{
    const review=deriveGenerationReview(makeLedger(28,{attackAttemptBasis:'admitted',attackAttempts:2,attackSuccesses:1,attackFailures:1,attackContested:1}))!
    expect(review.attacks).toMatchObject({attempts:2,attemptBasis:'admitted',wins:1,failures:1,contested:1})
    expect(formatAttackAttemptLabel(review.attacks.attemptBasis)).toBe('Attack attempts (admitted/resolved)')
    expect(formatAttackBasisNote(review.attacks.attemptBasis)).toContain('excluded')
  })

  it('marks contested same-prey claims unavailable for a legacy ledger',()=>{
    const legacy=makeLedger(27)
    delete (legacy as Partial<GenerationLedger>).attackContested
    delete (legacy as Partial<GenerationLedger>).attackAttemptBasis
    expect(deriveGenerationReview(legacy)?.attacks).toMatchObject({attemptBasis:null,contested:null})
    expect(formatAttackAttemptLabel(null)).toBe('Attack attempts (basis unavailable)')
    expect(formatAttackBasisNote(null)).toContain('basis unavailable for this legacy ledger')
  })

  it('makes extinction and no-birth reviews explicit',()=>{
    const review=deriveGenerationReview(makeLedger(8,{outcomes:{survived:0,hunted:1,energy:2,unfed:1,late:0,aged:1},birthsEligible:0,birthsAdmitted:0,birthsCapped:0,foodAtStart:0,foodProduced:0,foodRemoved:0,foodConsumed:0,foodRemaining:0}))!
    expect(review.survivors).toBe(0)
    expect(review).toMatchObject({nextPopulation:0,populationChange:-5})
    expect(review.births).toEqual({eligible:0,admitted:0,capped:0})
    expect(review.takeaway).toContain('no survivors')
    expect(review.resource.reconciled).toBe(true)
  })

  it('makes growing and unchanged next-population equations exact',()=>{
    expect(deriveGenerationReview(makeLedger(20,{outcomes:{survived:5,hunted:0,energy:0,unfed:0,late:0,aged:0},birthsAdmitted:2}))!).toMatchObject({evaluatedPopulation:5,nextPopulation:7,populationChange:2})
    expect(deriveGenerationReview(makeLedger(21,{outcomes:{survived:4,hunted:1,energy:0,unfed:0,late:0,aged:0},birthsAdmitted:1}))!).toMatchObject({evaluatedPopulation:5,nextPopulation:5,populationChange:0})
  })

  it('describes the largest recorded loss while naming survivors and births',()=>{
    const review=deriveGenerationReview(makeLedger(22,{outcomes:{survived:3,hunted:2,energy:0,unfed:0,late:0,aged:0},birthsAdmitted:1}))!
    const text=deriveGenerationInterpretation(review)
    expect(text).toContain('Hunted was the largest recorded loss (2)')
    expect(text).toContain('survivors: 3')
    expect(text).toContain('admitted births: 1')
    expect(text).toContain('Descriptive only')
    expect(text).not.toMatch(/caused|because|led to/)
  })

  it('calls tied loss outcomes a tie instead of inventing a winner',()=>{
    const review=deriveGenerationReview(makeLedger(23,{outcomes:{survived:1,hunted:2,energy:2,unfed:0,late:0,aged:0},birthsAdmitted:0}))!
    const text=deriveGenerationInterpretation(review)
    expect(text).toContain('Hunted and Energy depleted were tied as the largest recorded losses (2 each)')
    expect(text).toContain('survivors: 1')
    expect(text).toContain('admitted births: 0')
  })

  it('recognizes an all-survived generation',()=>{
    const review=deriveGenerationReview(makeLedger(24,{outcomes:{survived:5,hunted:0,energy:0,unfed:0,late:0,aged:0},birthsAdmitted:2}))!
    const text=deriveGenerationInterpretation(review)
    expect(text).toContain('all 5 creatures survived')
    expect(text).toContain('admitted births: 2')
    expect(text).toContain('next population: 7')
  })

  it('makes extinction and zero births explicit without claiming a cause',()=>{
    const review=deriveGenerationReview(makeLedger(25,{outcomes:{survived:0,hunted:3,energy:1,unfed:0,late:0,aged:0},birthsEligible:0,birthsAdmitted:0,birthsCapped:0,foodAtStart:0,foodProduced:0,foodRemoved:0,foodConsumed:0,foodRemaining:0}))!
    const text=deriveGenerationInterpretation(review)
    expect(text).toContain('no next population remained')
    expect(text).toContain('survivors: 0')
    expect(text).toContain('admitted births: 0')
    expect(text).toContain('Hunted was the largest recorded loss (3)')
    expect(text).not.toMatch(/caused|because|led to/)
  })

  it('finds one strong, descriptive outcome pattern against the evaluated cohort',()=>{
    const baseline=profile({speed:{mean:1,variance:.04,sd:.2}})
    const ledger=makeLedger(9,{outcomes:{survived:3,hunted:0,energy:0,unfed:0,late:0,aged:0},selection:{start:baseline,survivor:selection(1),reproducer:selection(1)},selectionByOutcome:{survived:profile({speed:{mean:1.2,variance:.04,sd:.2}}),hunted:selection(null),energy:selection(null),unfed:selection(null),late:selection(null),aged:selection(null)}})
    const [fingerprint]=derivePressureFingerprints(ledger)
    expect(fingerprint).toMatchObject({cause:'survived',label:'Survived',count:3,status:'pattern'})
    expect(fingerprint.comparison).toMatchObject({trait:'speed',outcomeMean:1.2,baselineMean:1,direction:'faster'})
    expect(fingerprint.comparison?.standardizedDelta).toBeCloseTo(1)
    expect(fingerprint.interpretation).toContain('Possible pattern')
    expect(fingerprint.interpretation).toContain('descriptive, not causal')
    expect(fingerprint.interpretation).toContain('+1.0 baseline SD')
  })

  it('keeps close but distinct means legible beyond the default two decimals',()=>{
    expect(formatAdaptivePair(1.004,1.001)).toEqual(['1.004','1.001'])
    expect(formatAdaptivePair(.49,.51)).toEqual(['0.49','0.51'])
    expect(formatAdaptivePair(1.2,1.2)).toEqual(['1.20','1.20'])
  })

  it('derives available, no-birth, and older-runtime inheritance statuses conservatively',()=>{
    const available=makeLedger(15,{birthsAdmitted:2,inheritance:{offspringCount:2,changedTraitValues:1,traits:inheritanceProfile({speed:{parentMean:1.004,offspringMean:1.001,changedCount:1}})}})
    expect(deriveInheritanceAudit(available)).toMatchObject({status:'available',offspringCount:2,changedTraitValues:1})
    expect(deriveInheritanceAudit(available).traits.speed).toMatchObject({parentMean:1.004,offspringMean:1.001,changedCount:1})

    const noBirths=makeLedger(16,{birthsEligible:0,birthsAdmitted:0,birthsCapped:0})
    expect(deriveInheritanceAudit(noBirths)).toMatchObject({status:'no-births',offspringCount:0,changedTraitValues:0})

    const legacy=makeLedger(17,{birthsAdmitted:2})
    expect(deriveInheritanceAudit(legacy)).toMatchObject({status:'legacy-unavailable',offspringCount:0,changedTraitValues:0})
    expect(deriveInheritanceAudit(undefined).status).toBe('legacy-unavailable')

    const malformed=makeLedger(18,{birthsAdmitted:2,inheritance:{offspringCount:2,changedTraitValues:2,traits:inheritanceProfile({speed:{parentMean:1,offspringMean:1,changedCount:1}})}})
    expect(deriveInheritanceAudit(malformed).status).toBe('legacy-unavailable')
    const contradictory=makeLedger(19,{birthsAdmitted:1,inheritance:{offspringCount:1,changedTraitValues:0,traits:inheritanceProfile({speed:{parentMean:1,offspringMean:2,changedCount:0}})}})
    expect(deriveInheritanceAudit(contradictory).status).toBe('legacy-unavailable')
  })

  it('distinguishes a weak signal, too few observations, and unavailable spread',()=>{
    const baseline=profile({speed:{mean:1,variance:.04,sd:.2}})
    const weak=makeLedger(10,{outcomes:{survived:3,hunted:0,energy:0,unfed:0,late:0,aged:0},selection:{start:baseline,survivor:selection(1),reproducer:selection(1)},selectionByOutcome:{survived:profile({speed:{mean:1.05,variance:.04,sd:.2}}),hunted:selection(null),energy:selection(null),unfed:selection(null),late:selection(null),aged:selection(null)}})
    expect(derivePressureFingerprints(weak)[0]).toMatchObject({status:'no-standout'})
    expect(derivePressureFingerprints(weak)[0].comparison?.standardizedDelta).toBeCloseTo(.25)
    expect(derivePressureFingerprints(weak)[0].interpretation).toContain(`No outcome pattern reached the ${SELECTION_PATTERN_THRESHOLD} baseline-SD threshold.`)
    expect(derivePressureFingerprints(weak)[0].interpretation).toContain('+0.25 baseline SD')

    const few=makeLedger(11,{outcomes:{survived:2,hunted:0,energy:0,unfed:0,late:0,aged:0},selection:{start:baseline,survivor:selection(1),reproducer:selection(1)},selectionByOutcome:{survived:profile({speed:{mean:1.5,variance:.04,sd:.2}}),hunted:selection(null),energy:selection(null),unfed:selection(null),late:selection(null),aged:selection(null)}})
    expect(derivePressureFingerprints(few)[0].status).toBe('too-few')

    const noSpread=makeLedger(12,{outcomes:{survived:3,hunted:0,energy:0,unfed:0,late:0,aged:0},selection:{start:profile({speed:{mean:1,variance:0,sd:0}}),survivor:selection(1),reproducer:selection(1)},selectionByOutcome:{survived:profile({speed:{mean:1.5,variance:.04,sd:.2}}),hunted:selection(null),energy:selection(null),unfed:selection(null),late:selection(null),aged:selection(null)}})
    expect(derivePressureFingerprints(noSpread)[0]).toMatchObject({status:'baseline-unavailable',comparison:{outcomeMean:1.5,baselineMean:1,standardizedDelta:null}})
    const missingSpread=makeLedger(12,{outcomes:{survived:3,hunted:0,energy:0,unfed:0,late:0,aged:0},selection:{start:profile({speed:{mean:1,variance:null,sd:null}}),survivor:selection(1),reproducer:selection(1)},selectionByOutcome:{survived:profile({speed:{mean:1.5,variance:.04,sd:.2}}),hunted:selection(null),energy:selection(null),unfed:selection(null),late:selection(null),aged:selection(null)}})
    expect(derivePressureFingerprints(missingSpread)[0].status).toBe('baseline-unavailable')
  })

  it('keeps the outcome pattern boundary at the shared 0.5 baseline-SD constant',()=>{
    const outcomeLedger=(generation:number,effect:number,startMean=1,startSd=.2)=>{
      const baseline=profile({speed:{mean:startMean,variance:startSd**2,sd:startSd}})
      return makeLedger(generation,{outcomes:{survived:3,hunted:0,energy:0,unfed:0,late:0,aged:0},selection:{start:baseline,survivor:selection(1),reproducer:selection(1)},selectionByOutcome:{survived:profile({speed:{mean:startMean+effect*startSd,variance:startSd**2,sd:startSd}}),hunted:selection(null),energy:selection(null),unfed:selection(null),late:selection(null),aged:selection(null)}})
    }
    const justBelow=derivePressureFingerprints(outcomeLedger(30,.49))[0]
    expect(justBelow.status).toBe('no-standout')
    expect(justBelow.interpretation).toContain('+0.49 baseline SD')
    expect(justBelow.interpretation).toContain(`No outcome pattern reached the ${SELECTION_PATTERN_THRESHOLD} baseline-SD threshold.`)
    const atThreshold=derivePressureFingerprints(outcomeLedger(31,.5))[0]
    expect(atThreshold.status).toBe('pattern')
    expect(atThreshold.interpretation).toContain('Possible pattern — descriptive, not causal')
    expect(atThreshold.interpretation).toContain('+0.5 baseline SD')
    const exactPatternPositive=.7-.2,exactPatternNegative=-(.7-.2)
    expect(exactPatternPositive).toBeLessThan(SELECTION_PATTERN_THRESHOLD)
    expect(exactPatternNegative).toBeGreaterThan(-SELECTION_PATTERN_THRESHOLD)
    expect(meetsStandardizedEffectThreshold(exactPatternPositive,SELECTION_PATTERN_THRESHOLD)).toBe(true)
    expect(meetsStandardizedEffectThreshold(exactPatternNegative,SELECTION_PATTERN_THRESHOLD)).toBe(true)
    const positive=derivePressureFingerprints(outcomeLedger(32,exactPatternPositive,.4,1))[0]
    const negative=derivePressureFingerprints(outcomeLedger(33,exactPatternNegative,.4,1))[0]
    expect(positive.status).toBe('pattern')
    expect(negative.status).toBe('pattern')
    expect(positive.interpretation).toContain('Possible pattern — descriptive, not causal')
    expect(negative.interpretation).toContain('Possible pattern — descriptive, not causal')
    const nearBoundary=derivePressureFingerprints(outcomeLedger(34,SELECTION_PATTERN_THRESHOLD-.0001))[0]
    expect(nearBoundary.status).toBe('no-standout')
    expect(nearBoundary.interpretation).toContain('+0.4999 baseline SD')
  })

  it('omits empty outcomes and stays honest when old runtime data lacks profiles',()=>{
    const empty=makeLedger(13,{outcomes:{survived:0,hunted:0,energy:0,unfed:0,late:0,aged:0}})
    expect(derivePressureFingerprints(empty)).toEqual([])
    const old=makeLedger(14)
    const oldRuntime=old as unknown as {selectionByOutcome?:GenerationLedger['selectionByOutcome']}
    delete oldRuntime.selectionByOutcome
    expect(derivePressureFingerprints(old)[0]).toMatchObject({cause:'survived',status:'unavailable',comparison:null})
    expect(derivePressureFingerprints(old)[0].interpretation).toContain('unavailable')
  })
})
