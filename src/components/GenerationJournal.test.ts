import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { meetsStandardizedEffectThreshold, SELECTION_PATTERN_THRESHOLD } from '../simulation/engine'
import type { BiologicalTrait, GenerationLedger, InheritanceTraitSummary, SelectionSummary, TraitMoments, WorldEvent } from '../simulation/types'
import GenerationJournal, { clampJournalGeneration, deriveGenerationInterpretation, deriveGenerationReview, deriveInheritanceAudit, deriveJournalEvents, deriveJournalMaturity, derivePressureFingerprints, deriveSurvivorLossComparison, filterJournalEvents, formatAdaptivePair, formatAttackAttemptLabel, formatAttackBasisNote, formatInheritanceEvidenceSummary, formatJournalEventDay, formatJournalEventSummary, formatJournalEventsEvidenceSummary, formatPressureEvidenceSummary, formatSurvivorLossEvidenceSummary, getJournalEventStatus, getRecentGenerationLedgers, isValidJournalEventDay, isValidJournalEventGeneration, isValidJournalEventKind, JOURNAL_EVENT_DAY_UNAVAILABLE, JOURNAL_EVENT_SUMMARY_UNAVAILABLE, MAX_JOURNAL_ENTRIES, pinCurrentGeneration, resolveJournalSelection } from './GenerationJournal'

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

const comparisonMeans={speed:1.8,size:1.2,sense:.8,aggression:1.1,caution:.9,exploration:1} satisfies Record<BiologicalTrait,number>
const comparisonHuntedMeans={speed:.6,size:1.1,sense:.7,aggression:.7,caution:1,exploration:.8} satisfies Record<BiologicalTrait,number>
const comparisonEnergyMeans={speed:1,size:1,sense:.9,aggression:.9,caution:.8,exploration:.9} satisfies Record<BiologicalTrait,number>
const profileFromMeans=(values:Record<BiologicalTrait,number>,sd:number|null=.5):SelectionSummary=>Object.fromEntries(traitKeys.map(trait=>[trait,{mean:values[trait],variance:sd===null?null:sd**2,sd}])) as SelectionSummary
const comparisonLedger=():GenerationLedger=>{
  const baseline=Object.fromEntries(traitKeys.map(trait=>[trait,(4*comparisonMeans[trait]+comparisonHuntedMeans[trait]+3*comparisonEnergyMeans[trait])/8])) as Record<BiologicalTrait,number>
  return makeLedger(40,{startPopulation:8,outcomes:{survived:4,hunted:1,energy:3,unfed:0,late:0,aged:0},selection:{start:profileFromMeans(baseline),survivor:profileFromMeans(comparisonMeans),reproducer:profileFromMeans(comparisonMeans)},selectionByOutcome:{survived:profileFromMeans(comparisonMeans),hunted:profileFromMeans(comparisonHuntedMeans),energy:profileFromMeans(comparisonEnergyMeans),unfed:selection(null),late:selection(null),aged:selection(null)}})
}

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

  it('keeps matching events with malformed fields while sorting and formatting them safely',()=>{
    const events=[
      {generation:2,day:4,kind:'drought',summary:'later',count:1},
      {generation:2,day:Number.NaN,kind:'drought',summary:'unknown day',count:1},
      {generation:2,day:1,kind:'resource-bloom',summary:'first',count:1},
      {generation:2,day:1,kind:'legacy-shock',summary:'unknown kind',count:1},
      {generation:2,day:2,kind:'drought',summary:'   ',count:1},
      {generation:2,day:3,kind:'founder-migration',summary:null,count:1},
      {generation:'2',day:0,kind:'drought',summary:'wrong generation type',count:1},
    ] as unknown as WorldEvent[]
    const filtered=filterJournalEvents(events,2)
    expect(filtered).toHaveLength(6)
    expect(filtered.map(event=>event.summary)).toEqual(['first','unknown kind','   ',null,'later','unknown day'])
    expect(filtered.map(event=>event.day)).toEqual([1,1,2,3,4,Number.NaN])
    expect(isValidJournalEventGeneration(2)).toBe(true)
    expect(isValidJournalEventGeneration(0)).toBe(false)
    expect(isValidJournalEventGeneration(1.5)).toBe(false)
    expect(isValidJournalEventGeneration(Number.NaN)).toBe(false)
    expect(isValidJournalEventDay(0)).toBe(true)
    expect(isValidJournalEventDay(-1)).toBe(false)
    expect(isValidJournalEventDay(Number.NaN)).toBe(false)
    expect(isValidJournalEventKind('drought')).toBe(true)
    expect(isValidJournalEventKind('legacy-shock')).toBe(false)
    expect(formatJournalEventDay(1.234)).toBe('Day 1.23')
    expect(formatJournalEventDay(Number.NaN)).toBe(JOURNAL_EVENT_DAY_UNAVAILABLE)
    expect(formatJournalEventSummary('  Drought removed food.  ')).toBe('Drought removed food.')
    expect(formatJournalEventSummary('   ')).toBe(JOURNAL_EVENT_SUMMARY_UNAVAILABLE)
    expect(formatJournalEventSummary(null)).toBe(JOURNAL_EVENT_SUMMARY_UNAVAILABLE)
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

  it('ignores malformed generations when inferring partial, none, or unknown history',()=>{
    const events=[
      {generation:Number.NaN,day:0,kind:'drought',summary:'malformed generation',count:1},
      ...Array.from({length:59},(_,index)=>({generation:5,day:index+1,kind:'resource-bloom' as const,summary:'retained shock',count:1})),
    ] as unknown as WorldEvent[]
    expect(getJournalEventStatus(events,5)).toBe('partial')
    expect(getJournalEventStatus(events,6)).toBe('none')
    expect(getJournalEventStatus(events,4)).toBe('unknown')
    expect(getJournalEventStatus(events,Number.NaN)).toBe('unknown')

    const onlyMalformed=Array.from({length:60},()=>({generation:-1,day:0,kind:'drought',summary:'malformed generation',count:1})) as unknown as WorldEvent[]
    expect(getJournalEventStatus(onlyMalformed,1)).toBe('unknown')
    expect(getJournalEventStatus(onlyMalformed,999)).toBe('unknown')
  })

  it('renders invalid event day and summary as unavailable without SSR failure',()=>{
    const events=[
      null,
      {generation:2,day:Number.POSITIVE_INFINITY,kind:'drought',summary:'   ',count:1},
      {generation:2,day:1,kind:null,summary:null,count:1},
    ] as unknown as WorldEvent[]
    const markup=renderToStaticMarkup(createElement(GenerationJournal,{ledgers:[makeLedger(2)],events,requestedGeneration:null,onRequestedGenerationChange:()=>{}}))
    expect(markup).not.toContain('id="generation-journal"')
    expect(markup).toContain('<div class="evolution-story generation-journal">')
    expect(markup).not.toContain('aria-labelledby="generation-journal-title"')
    expect(markup).toContain('id="generation-review"')
    expect(markup).toContain(JOURNAL_EVENT_DAY_UNAVAILABLE)
    expect(markup).toContain(JOURNAL_EVENT_SUMMARY_UNAVAILABLE)
    expect(markup.match(/Event summary unavailable\./g)).toHaveLength(2)
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

  it('derives maturity counts only from a complete reconciled telemetry partition',()=>{
    const available=makeLedger(29,{birthsImmature:1})
    expect(deriveJournalMaturity(available)).toEqual({energyReadyImmature:1,belowThreshold:0})
    expect(deriveGenerationReview(available)?.maturity).toEqual({energyReadyImmature:1,belowThreshold:0})

    const zero=makeLedger(30,{birthsImmature:0})
    expect(deriveJournalMaturity(zero)).toEqual({energyReadyImmature:0,belowThreshold:1})

    const legacy=makeLedger(31)
    expect(deriveJournalMaturity(legacy)).toBeNull()
    for(const birthsImmature of [null,-1,1.5,Number.NaN,Number.POSITIVE_INFINITY,'1']) {
      expect(deriveJournalMaturity(makeLedger(32,{birthsImmature:birthsImmature as never}))).toBeNull()
    }
    expect(deriveJournalMaturity(makeLedger(33,{birthsImmature:2}))).toBeNull()
    expect(deriveJournalMaturity(makeLedger(34,{birthsEligible:2,birthsAdmitted:1,birthsCapped:0,birthsImmature:1}))).toBeNull()
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

  it('mentions nonzero energy-ready immature survivors as an observational category',()=>{
    const review=deriveGenerationReview(makeLedger(35,{birthsImmature:1}))!
    const text=deriveGenerationInterpretation(review)
    expect(text).toContain('1 energy-ready but immature survivor was recorded')
    expect(text).toContain('observational only')
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

  describe('survivors versus all recorded losses',()=>{
    it('count-weights unequal loss groups, keeps all six rows, and applies the shared pattern threshold',()=>{
      const comparison=deriveSurvivorLossComparison(comparisonLedger())
      expect(comparison).toMatchObject({status:'available',patternStatus:'pattern',possiblePattern:true,survivorCount:4,lossCount:4,largestTrait:'speed'})
      expect(comparison.traits.map(trait=>trait.trait)).toEqual(traitKeys)
      expect(comparison.traits.every(trait=>typeof trait.survivorMean==='number'&&typeof trait.lossMean==='number'&&typeof trait.difference==='number')).toBe(true)
      expect(comparison.traits.find(trait=>trait.trait==='speed')).toMatchObject({survivorMean:1.8,lossMean:.9,difference:.9,standardizedDifference:1.8})
      expect(comparison.interpretation).toContain('Largest observed separation')
      expect(comparison.interpretation).toContain('Descriptive within this generation')
      expect(comparison.interpretation).toContain('all recorded loss outcomes combined')
      expect(comparison.interpretation).toContain('does not establish that the trait caused survival')
      expect(comparison.interpretation).not.toMatch(/advantage|selected for/i)
    })

    it('keeps deterministic trait order when standardized separations tie',()=>{
      const ledger=comparisonLedger()
      ledger.selection.survivor.speed.mean=2
      ledger.selectionByOutcome.survived.speed.mean=2
      ledger.selectionByOutcome.hunted.speed.mean=.5
      ledger.selectionByOutcome.energy.speed.mean=1.5
      ledger.selection.start.speed.mean=1.625
      ledger.selection.survivor.size.mean=2
      ledger.selectionByOutcome.survived.size.mean=2
      ledger.selectionByOutcome.hunted.size.mean=.5
      ledger.selectionByOutcome.energy.size.mean=1.5
      ledger.selection.start.size.mean=1.625
      const comparison=deriveSurvivorLossComparison(ledger)
      expect(comparison.largestTrait).toBe('speed')
      expect(comparison.traits.find(trait=>trait.trait==='speed')?.standardizedDifference).toBe(1.5)
      expect(comparison.traits.find(trait=>trait.trait==='size')?.standardizedDifference).toBe(1.5)
    })

    it('reports explicit empty cohorts and retains six unavailable rows',()=>{
      const noSurvivors=deriveSurvivorLossComparison(makeLedger(41,{startPopulation:3,outcomes:{survived:0,hunted:3,energy:0,unfed:0,late:0,aged:0}}))
      const noLosses=deriveSurvivorLossComparison(makeLedger(42,{startPopulation:3,outcomes:{survived:3,hunted:0,energy:0,unfed:0,late:0,aged:0}}))
      expect(noSurvivors.status).toBe('no-survivors')
      expect(noSurvivors.traits).toHaveLength(6)
      expect(noSurvivors.interpretation).toContain('No survivors were recorded')
      expect(noLosses.status).toBe('no-losses')
      expect(noLosses.traits).toHaveLength(6)
      expect(noLosses.interpretation).toContain('No losses were recorded')
    })

    it('does not call a pattern when either cohort is below the minimum count',()=>{
      const ledger=comparisonLedger()
      ledger.outcomes={survived:2,hunted:2,energy:4,unfed:0,late:0,aged:0}
      for(const trait of traitKeys)ledger.selection.start[trait].mean=(2*comparisonMeans[trait]+2*comparisonHuntedMeans[trait]+4*comparisonEnergyMeans[trait])/8
      const comparison=deriveSurvivorLossComparison(ledger)
      expect(comparison.status).toBe('available')
      expect(comparison.patternStatus).toBe('too-few')
      expect(comparison.possiblePattern).toBe(false)
      expect(comparison.interpretation).toContain('requires at least 3 survivors and 3 losses')
    })

    it('keeps raw means when evaluated-cohort spread is zero or missing',()=>{
      const ledger=comparisonLedger()
      traitKeys.forEach((trait,index)=>{ledger.selection.start[trait].sd=index%2===0?0:null;ledger.selection.start[trait].variance=index%2===0?0:null})
      const comparison=deriveSurvivorLossComparison(ledger)
      expect(comparison).toMatchObject({status:'available',patternStatus:'spread-unavailable',possiblePattern:false,largestTrait:null,largestDifference:null,largestStandardizedDifference:null})
      expect(comparison.traits.every(trait=>trait.standardizedDifference===null&&typeof trait.difference==='number')).toBe(true)
      expect(comparison.interpretation).toContain('ranking unavailable')
      expect(comparison.interpretation).toContain('raw means remain shown')
    })

    it('ranks only traits with comparable spread and discloses partial screening',()=>{
      const ledger=comparisonLedger()
      for(const trait of ['speed','size','sense','aggression'] as BiologicalTrait[]){ledger.selection.start[trait].sd=null;ledger.selection.start[trait].variance=null}
      const comparison=deriveSurvivorLossComparison(ledger)
      expect(comparison).toMatchObject({status:'available',patternStatus:'no-standout',possiblePattern:false,largestTrait:'exploration'})
      expect(comparison.traits.filter(trait=>trait.standardizedDifference===null).map(trait=>trait.trait)).toEqual(['speed','size','sense','aggression'])
      expect(comparison.interpretation).toContain('among the 2 traits with available evaluated-cohort spread')
      expect(comparison.interpretation).toContain('4 traits were not screened')
    })

    it('rejects missing legacy profiles, partial/nonfinite profiles, and invalid counts',()=>{
      const legacy=comparisonLedger()
      delete (legacy as Partial<GenerationLedger>).selectionByOutcome
      expect(deriveSurvivorLossComparison(legacy).status).toBe('unavailable')

      const partial=comparisonLedger()
      delete (partial.selectionByOutcome.energy as Partial<SelectionSummary>).speed
      expect(deriveSurvivorLossComparison(partial).status).toBe('unavailable')

      const nonfinite=comparisonLedger()
      nonfinite.selectionByOutcome.energy.speed.mean=Number.NaN
      expect(deriveSurvivorLossComparison(nonfinite).status).toBe('unavailable')

      const mismatch=comparisonLedger()
      mismatch.startPopulation=9
      expect(deriveSurvivorLossComparison(mismatch).status).toBe('unavailable')

      for(const invalid of [-1,1.5,Number.NaN,Number.POSITIVE_INFINITY,'1']){
        const invalidCount=comparisonLedger()
        ;(invalidCount.outcomes as unknown as Record<string,unknown>).hunted=invalid
        expect(deriveSurvivorLossComparison(invalidCount).status).toBe('unavailable')
      }
    })

    it('rejects contradictory survivor and weighted-baseline cross-checks',()=>{
      const survivorMismatch=comparisonLedger()
      survivorMismatch.selection.survivor.speed.mean=(survivorMismatch.selection.survivor.speed.mean as number)+.1
      expect(deriveSurvivorLossComparison(survivorMismatch).status).toBe('unavailable')

      const baselineMismatch=comparisonLedger()
      baselineMismatch.selection.start.speed.mean=(baselineMismatch.selection.start.speed.mean as number)+.1
      expect(deriveSurvivorLossComparison(baselineMismatch).status).toBe('unavailable')
    })

    it('renders six responsive trait rows with standardized differences and a non-causal caveat',()=>{
      const markup=renderToStaticMarkup(createElement(GenerationJournal,{ledgers:[comparisonLedger()],events:[],requestedGeneration:null,onRequestedGenerationChange:()=>{}}))
      expect(markup).toContain('Survivors vs recorded losses')
      expect(markup).toContain('all recorded loss outcomes combined')
      expect(markup).toContain('<strong>4</strong> survivors vs <strong>4</strong> recorded losses')
      expect(markup).toContain('Survivors 1.80 · losses 0.90')
      expect(markup).toContain('Survivor mean − loss mean: +1.8 cohort SD')
      for(const label of ['Speed','Size','Sensing','Aggression','Caution','Exploration'])expect(markup).toContain(`<span>${label}</span>`)
      expect(markup).toContain('does not establish that the trait caused survival')
      expect(markup).not.toMatch(/NaN|Infinity|undefined/)
      expect(markup).not.toMatch(/advantage|selected for/i)
    })

    it('does not promise trait rows when a cohort is empty',()=>{
      const ledger=makeLedger(43,{startPopulation:3,outcomes:{survived:0,hunted:3,energy:0,unfed:0,late:0,aged:0}})
      const markup=renderToStaticMarkup(createElement(GenerationJournal,{ledgers:[ledger],events:[],requestedGeneration:null,onRequestedGenerationChange:()=>{}}))
      expect(markup).toContain('No survivors were recorded; trait means cannot be compared')
      expect(markup).not.toContain('All six traits are shown')
      expect(markup).not.toContain('Survivor and combined loss trait means')
    })
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

  describe('progressive-disclosure evidence summaries',()=>{
    it('summarizes inheritance for available, no-birth, and legacy records',()=>{
      const available=deriveInheritanceAudit(makeLedger(51,{birthsAdmitted:2,inheritance:{offspringCount:2,changedTraitValues:1,traits:inheritanceProfile({speed:{parentMean:1.004,offspringMean:1.001,changedCount:1}})}}))
      const noBirths=deriveInheritanceAudit(makeLedger(52,{birthsAdmitted:0,birthsEligible:0,birthsCapped:0}))
      const legacy=deriveInheritanceAudit(makeLedger(53,{birthsAdmitted:2}))
      expect(formatInheritanceEvidenceSummary(available,51)).toBe('Inheritance · Generation 51 → 52 · 2 newborns · 1 of 12 trait values changed')
      expect(formatInheritanceEvidenceSummary(noBirths,52)).toContain('Generation 52 → 53')
      expect(formatInheritanceEvidenceSummary(noBirths,52)).toContain('no admitted newborns')
      expect(formatInheritanceEvidenceSummary(noBirths,52)).toContain('no parent→offspring comparison')
      expect(formatInheritanceEvidenceSummary(legacy,53)).toContain('Generation 53 → 54')
      expect(formatInheritanceEvidenceSummary(legacy,53)).toContain('comparison unavailable')
      for(const [audit,generation] of [[available,51],[noBirths,52],[legacy,53]] as const)expect(formatInheritanceEvidenceSummary(audit,generation)).not.toMatch(/NaN|Infinity|undefined/)
    })

    it('summarizes survivor/loss available and explicit empty or unavailable cohorts',()=>{
      const available=deriveSurvivorLossComparison(comparisonLedger())
      const noSurvivors=deriveSurvivorLossComparison(makeLedger(54,{startPopulation:3,outcomes:{survived:0,hunted:3,energy:0,unfed:0,late:0,aged:0}}))
      const noLosses=deriveSurvivorLossComparison(makeLedger(55,{startPopulation:3,outcomes:{survived:3,hunted:0,energy:0,unfed:0,late:0,aged:0}}))
      const legacy=makeLedger(56)
      delete (legacy as Partial<GenerationLedger>).selectionByOutcome
      const unavailable=deriveSurvivorLossComparison(legacy)
      expect(formatSurvivorLossEvidenceSummary(available)).toContain('4 survivors vs 4 recorded losses')
      expect(formatSurvivorLossEvidenceSummary(available)).toContain('descriptive only')
      expect(formatSurvivorLossEvidenceSummary(noSurvivors)).toContain('no survivors recorded')
      expect(formatSurvivorLossEvidenceSummary(noLosses)).toContain('no recorded losses')
      expect(formatSurvivorLossEvidenceSummary(unavailable)).toContain('comparison unavailable')
      for(const summary of [available,noSurvivors,noLosses,unavailable].map(formatSurvivorLossEvidenceSummary))expect(summary).not.toMatch(/NaN|Infinity|undefined/)
    })

    it('summarizes every outcome-pattern state without implying causation',()=>{
      const outcomeLedger=(generation:number,effect:number,startSd=.2,count=3)=>{
        const baseline=profile({speed:{mean:1,variance:startSd**2,sd:startSd}})
        return makeLedger(generation,{outcomes:{survived:count,hunted:0,energy:0,unfed:0,late:0,aged:0},selection:{start:baseline,survivor:selection(1),reproducer:selection(1)},selectionByOutcome:{survived:profile({speed:{mean:1+effect*startSd,variance:startSd**2,sd:startSd}}),hunted:selection(null),energy:selection(null),unfed:selection(null),late:selection(null),aged:selection(null)}})
      }
      const pattern=derivePressureFingerprints(outcomeLedger(57,.5))[0]
      const noStandout=derivePressureFingerprints(outcomeLedger(58,.05))[0]
      const tooFew=derivePressureFingerprints(outcomeLedger(59,1,.2,2))[0]
      const baselineUnavailable=derivePressureFingerprints(outcomeLedger(60,1,0))[0]
      const unavailableLedger=outcomeLedger(61,.5)
      delete (unavailableLedger as Partial<GenerationLedger>).selectionByOutcome
      const unavailable=derivePressureFingerprints(unavailableLedger)[0]
      expect(formatPressureEvidenceSummary([pattern])).toContain('possible pattern')
      expect(formatPressureEvidenceSummary([noStandout])).toContain('no standout pattern')
      expect(formatPressureEvidenceSummary([tooFew])).toContain('too few observations')
      expect(formatPressureEvidenceSummary([baselineUnavailable])).toContain('baseline spread unavailable')
      expect(formatPressureEvidenceSummary([unavailable])).toContain('comparison unavailable')
      expect(formatPressureEvidenceSummary([pattern])).toContain('descriptive only')
      expect(formatPressureEvidenceSummary([tooFew,{...tooFew,cause:'hunted',label:'Hunted'}])).toContain('2 groups with too few observations')
      expect(formatPressureEvidenceSummary([baselineUnavailable,{...baselineUnavailable,cause:'hunted',label:'Hunted'}])).toContain('2 groups with baseline spread unavailable')
      expect(formatPressureEvidenceSummary([unavailable,{...unavailable,cause:'hunted',label:'Hunted'}])).toContain('2 comparisons unavailable')
      for(const fingerprint of [pattern,noStandout,tooFew,baselineUnavailable,unavailable])expect(formatPressureEvidenceSummary([fingerprint])).not.toMatch(/NaN|Infinity|undefined/)
    })

    it('summarizes events, retention gaps, empty history, and unknown history',()=>{
      const events:Array<WorldEvent>=[{generation:62,day:1,kind:'drought',summary:'Drought removed food.',count:1}]
      const eventReview=deriveJournalEvents(events,62)
      const partialEvents:Array<WorldEvent>=[
        ...Array.from({length:5},(_,index)=>({generation:63,day:index,kind:'drought' as const,summary:'retained shock',count:1})),
        ...Array.from({length:55},(_,index)=>({generation:64,day:index,kind:'resource-bloom' as const,summary:'newer shock',count:1})),
      ]
      const partial=deriveJournalEvents(partialEvents,63)
      const none=deriveJournalEvents([],62)
      const unknown=deriveJournalEvents(Array.from({length:60},(_,index)=>({generation:64,day:index,kind:'drought' as const,summary:'retained shock',count:1})),62)
      expect(formatJournalEventsEvidenceSummary(eventReview)).toContain('1 retained shock')
      expect(formatJournalEventsEvidenceSummary(partial)).toContain('earlier events may be missing')
      expect(formatJournalEventsEvidenceSummary(none)).toMatch(/No shocks recorded/)
      expect(formatJournalEventsEvidenceSummary(unknown)).toMatch(/Event history unavailable/)
      for(const summary of [eventReview,partial,none,unknown].map(formatJournalEventsEvidenceSummary))expect(summary).not.toMatch(/NaN|Infinity|undefined/)
    })

    it('renders four closed evidence details while keeping core answers outside them',()=>{
      const markup=renderToStaticMarkup(createElement(GenerationJournal,{ledgers:[comparisonLedger()],events:[{generation:40,day:1,kind:'drought',summary:'Drought removed food.',count:1}],requestedGeneration:null,onRequestedGenerationChange:()=>{}}))
      const details=[...markup.matchAll(/<details\b[^>]*>/g)]
      expect(details).toHaveLength(4)
      expect(details.map(match=>match[0].match(/data-journal-evidence="([^"]+)"/)?.[1])).toEqual(['inheritance','survivor-loss','outcome-patterns','ecosystem-events'])
      expect(details.every(match=>!/\bopen(?:=|>)/.test(match[0]))).toBe(true)
      for(const heading of ['How offspring inherited traits','Survivors vs recorded losses','Outcome trait patterns','Ecosystem events · generation 40'])expect(markup).toContain(`<h3>${heading}</h3>`)
      const firstDetail=markup.indexOf('<details')
      for(const core of ['Population outcomes','Resource balance','Attacks &amp; births','Recorded outcome summary','Selection takeaway'])expect(markup.indexOf(core)).toBeGreaterThanOrEqual(0)
      expect(markup.indexOf('Recorded outcome summary')).toBeLessThan(firstDetail)
      expect(markup.indexOf('Selection takeaway')).toBeLessThan(firstDetail)
      expect(markup).not.toMatch(/NaN|Infinity|undefined/)
    })

    it('keeps the reproduction funnel explicit and truthful for new and old ledgers',()=>{
      const available=renderToStaticMarkup(createElement(GenerationJournal,{ledgers:[makeLedger(66,{birthsImmature:1})],events:[],requestedGeneration:null,onRequestedGenerationChange:()=>{}}))
      expect(available).toContain('Mature + energy-eligible parents → admitted births')
      expect(available).toContain('Maturity blocked (energy-ready but immature)')
      expect(available).toContain('<td>1</td>')
      expect(available).toContain('Below reproduction threshold')
      expect(available).toContain('Funnel: mature + energy-eligible parents can be admitted')
      expect(available).not.toMatch(/NaN|Infinity|undefined/)

      const unavailable=renderToStaticMarkup(createElement(GenerationJournal,{ledgers:[makeLedger(67)],events:[],requestedGeneration:null,onRequestedGenerationChange:()=>{}}))
      expect(unavailable).toContain('Eligible parents → admitted births')
      expect(unavailable).not.toContain('Reproduction maturity')
      expect(unavailable).not.toContain('Maturity blocked (energy-ready but immature)')
    })

    it('does not render evidence details before the first completed generation or for absent outcome fingerprints',()=>{
      const emptyMarkup=renderToStaticMarkup(createElement(GenerationJournal,{ledgers:[],events:[],requestedGeneration:null,onRequestedGenerationChange:()=>{}}))
      expect(emptyMarkup).not.toContain('<details')
      const noOutcomes=makeLedger(65,{outcomes:{survived:0,hunted:0,energy:0,unfed:0,late:0,aged:0},birthsAdmitted:0,birthsEligible:0,birthsCapped:0})
      const markup=renderToStaticMarkup(createElement(GenerationJournal,{ledgers:[noOutcomes],events:[],requestedGeneration:null,onRequestedGenerationChange:()=>{}}))
      expect(markup).not.toContain('data-journal-evidence="outcome-patterns"')
      expect(markup.match(/<details\b/g)).toHaveLength(3)
    })
  })
})
