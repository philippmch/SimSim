import { useEffect, useMemo, useRef } from 'react'
import { getSelectionTakeaway, MAX_WORLD_EVENTS, meetsStandardizedEffectThreshold, SELECTION_PATTERN_MIN_COUNT, SELECTION_PATTERN_THRESHOLD, snapStandardizedEffect } from '../simulation/engine'
import { END_CAUSES } from '../simulation/types'
import type { AttackAttemptBasis, BiologicalTrait, EndCause, GenerationLedger, InheritanceTraitSummary, SelectionSummary, WorldEvent } from '../simulation/types'
import { completePendingGenerationJournalFocus } from './Charts'

export const MAX_JOURNAL_ENTRIES = 40

const OUTCOME_LABELS:Record<EndCause,string>={
  survived:'Survived',
  hunted:'Hunted',
  energy:'Energy depleted',
  unfed:'No food at settlement',
  late:'Missed return deadline',
  aged:'Old age',
}

export const JOURNAL_OUTCOME_KEYS:readonly EndCause[]=END_CAUSES

const JOURNAL_TRAITS:readonly BiologicalTrait[]=['speed','size','sense','aggression','caution','exploration']
const TRAIT_LABELS:Record<BiologicalTrait,string>={speed:'speed',size:'size',sense:'sensing',aggression:'aggression',caution:'caution',exploration:'exploration'}
const TRAIT_DIRECTIONS:Record<BiologicalTrait,readonly [string,string]>={speed:['slower','faster'],size:['smaller','larger'],sense:['narrower sensing','broader sensing'],aggression:['less aggressive','more aggressive'],caution:['less cautious','more cautious'],exploration:['less exploratory','more exploratory']}

export type PressureFingerprintStatus='pattern'|'too-few'|'baseline-unavailable'|'no-standout'|'unavailable'

export interface PressureTraitComparison {
  trait:BiologicalTrait
  traitLabel:string
  outcomeMean:number
  baselineMean:number
  delta:number
  standardizedDelta:number|null
  direction:string
}

export interface PressureFingerprint {
  cause:EndCause
  label:string
  count:number
  comparison:PressureTraitComparison|null
  status:PressureFingerprintStatus
  interpretation:string
}

export type SurvivorLossComparisonStatus='available'|'no-survivors'|'no-losses'|'unavailable'
export type SurvivorLossPatternStatus='pattern'|'no-standout'|'too-few'|'spread-unavailable'|'unavailable'

export interface SurvivorLossTraitComparison {
  trait:BiologicalTrait
  traitLabel:string
  survivorMean:number|null
  lossMean:number|null
  difference:number|null
  standardizedDifference:number|null
}

export interface SurvivorLossComparison {
  status:SurvivorLossComparisonStatus
  patternStatus:SurvivorLossPatternStatus
  possiblePattern:boolean
  evaluatedPopulation:number|null
  survivorCount:number|null
  lossCount:number|null
  traits:SurvivorLossTraitComparison[]
  largestTrait:BiologicalTrait|null
  largestDifference:number|null
  largestStandardizedDifference:number|null
  interpretation:string
}

export interface GenerationReview {
  generation:number
  evaluatedPopulation:number
  nextPopulation:number
  populationChange:number
  outcomes:{cause:EndCause;label:string;count:number}[]
  survivors:number
  resource:{start:number;produced:number;removed:number;consumed:number;remaining:number;expected:number;reconciled:boolean}
  attacks:{attempts:number;attemptBasis:AttackAttemptBasis|null;wins:number;failures:number;contested:number|null;preyConsumed:number}
  births:{eligible:number;admitted:number;capped:number}
  takeaway:string
}

export type InheritanceAuditStatus='available'|'no-births'|'legacy-unavailable'

export interface InheritanceAuditReview {
  status:InheritanceAuditStatus
  offspringCount:number
  changedTraitValues:number
  traits:Record<BiologicalTrait,InheritanceTraitSummary>
}

export function formatAttackAttemptLabel(basis: AttackAttemptBasis | null): string {
  return basis === 'claims' ? 'Attack attempts (total claims)' : basis === 'admitted' ? 'Attack attempts (admitted/resolved)' : 'Attack attempts (basis unavailable)'
}

export function formatAttackBasisNote(basis: AttackAttemptBasis | null): string {
  return basis === 'claims'
    ? 'Threshold mode counts every claim, including contested same-prey claims.'
    : basis === 'admitted'
      ? 'Contest mode counts admitted/resolved attempts; contested same-prey claims are excluded.'
      : 'Attempt basis unavailable for this legacy ledger; this count cannot be classified as total claims or admitted/resolved attempts.'
}

/** Keep the journal small and ordered exactly as the retained ledger is ordered. */
export function getRecentGenerationLedgers(ledgers:readonly GenerationLedger[],limit=MAX_JOURNAL_ENTRIES){
  const bounded=Math.max(0,Math.floor(limit))
  return bounded?ledgers.slice(-bounded):[]
}

/** Resolve a requested generation to a retained ledger, clamping pins after truncation. */
export function clampJournalGeneration(ledgers:readonly GenerationLedger[],requestedGeneration:number|null){
  const recent=getRecentGenerationLedgers(ledgers)
  if(!recent.length)return null
  if(requestedGeneration===null)return recent[recent.length-1].generation
  if(recent.some(ledger=>ledger.generation===requestedGeneration))return requestedGeneration
  if(requestedGeneration<=recent[0].generation)return recent[0].generation
  if(requestedGeneration>=recent[recent.length-1].generation)return recent[recent.length-1].generation
  return recent.reduce((closest,ledger)=>Math.abs(ledger.generation-requestedGeneration)<Math.abs(closest.generation-requestedGeneration)?ledger:closest).generation
}

export interface JournalSelection {
  entries:GenerationLedger[]
  selectedGeneration:number|null
  followsLatest:boolean
}

/** Bound entries and resolve the visible review in one pure operation. */
export function resolveJournalSelection(ledgers:readonly GenerationLedger[],requestedGeneration:number|null):JournalSelection{
  const entries=getRecentGenerationLedgers(ledgers)
  const selectedGeneration=clampJournalGeneration(entries,requestedGeneration)
  return{entries,selectedGeneration,followsLatest:requestedGeneration===null}
}

/** Turn the implicit latest-follow state into an explicit pin at the current generation. */
export function pinCurrentGeneration(ledgers:readonly GenerationLedger[],requestedGeneration:number|null){
  return resolveJournalSelection(ledgers,requestedGeneration).selectedGeneration
}

export const pinJournalToLatest=pinCurrentGeneration

const JOURNAL_EVENT_KINDS:readonly WorldEvent['kind'][]=['resource-bloom','drought','founder-migration']
const isJournalRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null
const journalEventField=(event:unknown,field:string):unknown=>isJournalRecord(event)?event[field]:undefined

/** Completed generations and event provenance use positive whole-number generations. */
export function isValidJournalEventGeneration(value:unknown):value is number{
  return typeof value==='number'&&Number.isSafeInteger(value)&&value>=1
}

/** Event days are elapsed, finite, non-negative numbers; malformed legacy values stay visible as unavailable. */
export function isValidJournalEventDay(value:unknown):value is number{
  return typeof value==='number'&&Number.isFinite(value)&&value>=0
}

/** Keep event kinds observationally known before using them as sort keys. */
export function isValidJournalEventKind(value:unknown):value is WorldEvent['kind']{
  return typeof value==='string'&&JOURNAL_EVENT_KINDS.includes(value as WorldEvent['kind'])
}

export const JOURNAL_EVENT_DAY_UNAVAILABLE='Day unavailable'
export const JOURNAL_EVENT_SUMMARY_UNAVAILABLE='Event summary unavailable.'

export function formatJournalEventDay(value:unknown):string{
  return isValidJournalEventDay(value)?`Day ${value.toFixed(2)}`:JOURNAL_EVENT_DAY_UNAVAILABLE
}

export function formatJournalEventSummary(value:unknown):string{
  if(typeof value!=='string')return JOURNAL_EVENT_SUMMARY_UNAVAILABLE
  const summary=value.trim()
  return summary?summary:JOURNAL_EVENT_SUMMARY_UNAVAILABLE
}

const journalEventsArray=(events:readonly WorldEvent[]|unknown):readonly unknown[]=>Array.isArray(events)?events:[]
const journalEventSortDay=(event:unknown)=>isValidJournalEventDay(journalEventField(event,'day'))?journalEventField(event,'day') as number:Number.POSITIVE_INFINITY
const journalEventSortKind=(event:unknown)=>isValidJournalEventKind(journalEventField(event,'kind'))?journalEventField(event,'kind') as string:'\uffff'

/** Events are world-level, so keep only shocks that happened during the reviewed generation. */
export function filterJournalEvents(events:readonly WorldEvent[],generation:number|null){
  if(!isValidJournalEventGeneration(generation))return []
  return journalEventsArray(events)
    .map((event,index)=>({event,index}))
    .filter(({event})=>isValidJournalEventGeneration(journalEventField(event,'generation'))&&journalEventField(event,'generation')===generation)
    .sort((a,b)=>{
      const aDay=journalEventSortDay(a.event),bDay=journalEventSortDay(b.event)
      if(aDay!==bDay)return aDay<bDay?-1:1
      const kindOrder=journalEventSortKind(a.event).localeCompare(journalEventSortKind(b.event))
      return kindOrder||a.index-b.index
    })
    .map(({event})=>event as WorldEvent)
}

export type JournalEventStatus='events'|'partial'|'none'|'unknown'

export interface JournalEventReview {
  events:WorldEvent[]
  status:JournalEventStatus
}

/** Distinguish a known empty generation from an older generation beyond the event buffer. */
export function getJournalEventStatus(events:readonly WorldEvent[],generation:number|null,retentionLimit=MAX_WORLD_EVENTS):JournalEventStatus{
  if(!isValidJournalEventGeneration(generation))return'unknown'
  const safeEvents=journalEventsArray(events)
  const matches=filterJournalEvents(safeEvents as WorldEvent[],generation)
  const limit=Number.isFinite(retentionLimit)?Math.max(1,Math.floor(retentionLimit)):MAX_WORLD_EVENTS
  const bufferFull=safeEvents.length>=limit
  const oldestGeneration=safeEvents.reduce<number|null>((oldest,event)=>{
    const candidate=journalEventField(event,'generation')
    if(!isValidJournalEventGeneration(candidate))return oldest
    return oldest===null||candidate<oldest?candidate:oldest
  },null)
  if(matches.length)return bufferFull&&generation===oldestGeneration?'partial':'events'
  if(safeEvents.length<limit)return'none'
  return oldestGeneration!==null&&generation>oldestGeneration?'none':'unknown'
}

export function deriveJournalEvents(events:readonly WorldEvent[],generation:number|null,retentionLimit=MAX_WORLD_EVENTS):JournalEventReview{
  return{events:filterJournalEvents(events,generation),status:getJournalEventStatus(events,generation,retentionLimit)}
}

const finiteNumber=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
const unavailableFingerprint=(cause:EndCause,label:string,count:number):PressureFingerprint=>({cause,label,count,comparison:null,status:'unavailable',interpretation:'Pattern unavailable from this runtime data.'})

/**
 * The baseline reconstruction accepts small floating-point drift from a
 * weighted sum, while still rejecting a contradictory retained record. Keep
 * both tolerances explicit so future format changes do not hide a mismatch.
 */
export const SURVIVOR_LOSS_BASELINE_ABSOLUTE_TOLERANCE=1e-9
export const SURVIVOR_LOSS_BASELINE_RELATIVE_TOLERANCE=1e-9

const survivorLossTraits=():SurvivorLossTraitComparison[]=>JOURNAL_TRAITS.map(trait=>({trait,traitLabel:TRAIT_LABELS[trait],survivorMean:null,lossMean:null,difference:null,standardizedDifference:null}))
const survivorLossField=(source:unknown,field:string):unknown=>{
  if(!isJournalRecord(source))return undefined
  try{return source[field]}catch{return undefined}
}
const safeNonnegativeInteger=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0
const survivorLossMean=(profile:unknown,trait:BiologicalTrait):number|null=>{
  const moment=survivorLossField(profile,trait),mean=survivorLossField(moment,'mean')
  return finiteNumber(mean)?mean:null
}
const survivorLossSd=(profile:unknown,trait:BiologicalTrait):number|null=>{
  const moment=survivorLossField(profile,trait),sd=survivorLossField(moment,'sd')
  return finiteNumber(sd)&&sd>0?sd:null
}
const survivorLossMeansAgree=(first:number,second:number):boolean=>{
  const difference=Math.abs(first-second)
  if(!finiteNumber(difference))return false
  const scale=Math.max(1,Math.abs(first),Math.abs(second))
  return difference<=SURVIVOR_LOSS_BASELINE_ABSOLUTE_TOLERANCE+SURVIVOR_LOSS_BASELINE_RELATIVE_TOLERANCE*scale
}
const survivorLossResult=(status:SurvivorLossComparisonStatus,evaluatedPopulation:number|null,survivorCount:number|null,lossCount:number|null,interpretation:string):SurvivorLossComparison=>({
  status,
  patternStatus:status==='available'?'spread-unavailable':'unavailable',
  possiblePattern:false,
  evaluatedPopulation,
  survivorCount,
  lossCount,
  traits:survivorLossTraits(),
  largestTrait:null,
  largestDifference:null,
  largestStandardizedDifference:null,
  interpretation,
})

/**
 * Compare survivors with all recorded losses for one retained generation.
 * Every positive-count outcome must contribute all six trait means; a partial
 * profile invalidates the complete comparison instead of silently dropping a
 * trait or outcome. The baseline is independently reconstructed from the
 * count-weighted outcome means before any rows are exposed.
 */
export function deriveSurvivorLossComparison(ledger:GenerationLedger|undefined):SurvivorLossComparison{
  if(!ledger)return survivorLossResult('unavailable',null,null,null,'Comparison unavailable: this retained record is missing.')
  const source=ledger as unknown
  const evaluatedPopulation=survivorLossField(source,'startPopulation')
  const outcomes=survivorLossField(source,'outcomes')
  const rawCounts=JOURNAL_OUTCOME_KEYS.map(cause=>survivorLossField(outcomes,cause))
  if(!safeNonnegativeInteger(evaluatedPopulation)||rawCounts.some(count=>!safeNonnegativeInteger(count)))return survivorLossResult('unavailable',null,null,null,'Comparison unavailable: evaluated-cohort counts are incomplete or invalid.')
  const counts=Object.fromEntries(JOURNAL_OUTCOME_KEYS.map((cause,index)=>[cause,rawCounts[index]])) as Record<EndCause,number>
  const total=JOURNAL_OUTCOME_KEYS.reduce((sum,cause)=>sum+counts[cause],0)
  if(!Number.isSafeInteger(total)||total!==evaluatedPopulation)return survivorLossResult('unavailable',evaluatedPopulation,null,null,'Comparison unavailable: outcome counts do not reconcile to the evaluated cohort.')
  const survivorCount=counts.survived
  const lossCount=total-survivorCount
  if(survivorCount===0)return survivorLossResult('no-survivors',evaluatedPopulation,survivorCount,lossCount,'No survivors were recorded, so survivor-versus-loss means are unavailable.')
  if(lossCount===0)return survivorLossResult('no-losses',evaluatedPopulation,survivorCount,lossCount,'No losses were recorded, so survivor-versus-loss means are unavailable.')

  const selection=survivorLossField(source,'selection')
  const baselineProfile=survivorLossField(selection,'start')
  const survivorProfile=survivorLossField(selection,'survivor')
  const outcomeProfiles=survivorLossField(source,'selectionByOutcome')
  const survivedProfile=survivorLossField(outcomeProfiles,'survived')
  if(!isJournalRecord(baselineProfile)||!isJournalRecord(survivorProfile)||!isJournalRecord(outcomeProfiles)||!isJournalRecord(survivedProfile))return survivorLossResult('unavailable',evaluatedPopulation,survivorCount,lossCount,'Comparison unavailable: survivor, baseline, or outcome profiles are missing.')

  const traits:SurvivorLossTraitComparison[]=[]
  for(const trait of JOURNAL_TRAITS){
    const baselineMean=survivorLossMean(baselineProfile,trait)
    const survivorMean=survivorLossMean(survivorProfile,trait)
    const survivedOutcomeMean=survivorLossMean(survivedProfile,trait)
    if(baselineMean===null||survivorMean===null||survivedOutcomeMean===null||!survivorLossMeansAgree(survivorMean,survivedOutcomeMean))return survivorLossResult('unavailable',evaluatedPopulation,survivorCount,lossCount,'Comparison unavailable: survivor profile means disagree with the recorded survived outcome.')
    let weightedTotal=0
    let weightedLossTotal=0
    for(const cause of JOURNAL_OUTCOME_KEYS){
      const count=counts[cause]
      const profile=survivorLossField(outcomeProfiles,cause)
      if(count>0){
        const mean=survivorLossMean(profile,trait)
        if(mean===null)return survivorLossResult('unavailable',evaluatedPopulation,survivorCount,lossCount,'Comparison unavailable: a positive-count outcome has an incomplete trait profile.')
        const contribution=count*mean
        if(!finiteNumber(contribution))return survivorLossResult('unavailable',evaluatedPopulation,survivorCount,lossCount,'Comparison unavailable: weighted trait means overflowed the finite range.')
        weightedTotal+=contribution
        if(cause!=='survived')weightedLossTotal+=contribution
      }
    }
    const reconstructedBaseline=weightedTotal/evaluatedPopulation
    const combinedLossMean=weightedLossTotal/lossCount
    const difference=survivorMean-combinedLossMean
    if(!finiteNumber(reconstructedBaseline)||!survivorLossMeansAgree(reconstructedBaseline,baselineMean)||!finiteNumber(combinedLossMean)||!finiteNumber(difference))return survivorLossResult('unavailable',evaluatedPopulation,survivorCount,lossCount,'Comparison unavailable: outcome means contradict the evaluated-cohort baseline.')
    const sd=survivorLossSd(baselineProfile,trait)
    const standardizedDifference=sd===null||!finiteNumber(difference/sd)?null:difference/sd
    traits.push({trait,traitLabel:TRAIT_LABELS[trait],survivorMean,lossMean:combinedLossMean,difference,standardizedDifference})
  }

  const standardized=traits.filter(trait=>trait.standardizedDifference!==null)
  const strongest=standardized.length?standardized.reduce((best,current)=>Math.abs(current.standardizedDifference as number)>Math.abs(best.standardizedDifference as number)?current:best):null
  const missingSpreadCount=traits.length-standardized.length
  const enough=survivorCount>=SELECTION_PATTERN_MIN_COUNT&&lossCount>=SELECTION_PATTERN_MIN_COUNT
  const patternStatus:SurvivorLossPatternStatus=!enough?'too-few':!strongest?'spread-unavailable':meetsStandardizedEffectThreshold(strongest.standardizedDifference as number,SELECTION_PATTERN_THRESHOLD)?'pattern':'no-standout'
  const pattern=patternStatus==='pattern'
  const ranking=strongest
    ? `Largest observed separation${missingSpreadCount?` among the ${standardized.length} traits with available evaluated-cohort spread`:''}: ${strongest.traitLabel} (${formatSignedEffect(strongest.standardizedDifference as number)} evaluated-cohort SD).`
    : 'Largest observed separation ranking unavailable because evaluated-cohort spread was unavailable for all six traits.'
  const partialCoverage=missingSpreadCount?` ${missingSpreadCount} ${missingSpreadCount===1?'trait was':'traits were'} not screened because evaluated-cohort spread was unavailable.`:''
  const screening=pattern
    ? `Possible pattern threshold reached for ${strongest?.traitLabel} (${formatSignedEffect(strongest?.standardizedDifference as number)} evaluated-cohort SD).${partialCoverage}`
    : patternStatus==='too-few'
      ? `Pattern screening requires at least ${SELECTION_PATTERN_MIN_COUNT} survivors and ${SELECTION_PATTERN_MIN_COUNT} losses.`
      : patternStatus==='spread-unavailable'
        ? 'Pattern screening was unavailable because evaluated-cohort spread was unavailable for all six traits; raw means remain shown.'
        : `No threshold pattern reached the ${SELECTION_PATTERN_THRESHOLD} evaluated-cohort SD threshold among the ${standardized.length} traits with available spread.${partialCoverage}`
  return{
    status:'available',
    patternStatus,
    possiblePattern:pattern,
    evaluatedPopulation,
    survivorCount,
    lossCount,
    traits,
    largestTrait:strongest?.trait??null,
    largestDifference:strongest?.difference??null,
    largestStandardizedDifference:strongest?.standardizedDifference??null,
    interpretation:`${ranking} Descriptive within this generation; survivors (n=${survivorCount}) are compared with all recorded loss outcomes combined (n=${lossCount}). ${screening} This does not establish that the trait caused survival.`,
  }
}

/** Derive one cautious, outcome-specific trait comparison without making causal claims. */
export function derivePressureFingerprints(ledger:GenerationLedger|undefined):PressureFingerprint[]{
  if(!ledger)return[]
  const profiles=(ledger as GenerationLedger & {selectionByOutcome?:Partial<Record<EndCause,SelectionSummary>>}).selectionByOutcome
  return END_CAUSES.flatMap(cause=>{
    const count=ledger.outcomes?.[cause]??0
    if(count<=0)return[]
    const label=OUTCOME_LABELS[cause],profile=profiles?.[cause]
    if(!profile)return[unavailableFingerprint(cause,label,count)]
    const candidates=JOURNAL_TRAITS.flatMap(trait=>{
      const outcome=profile[trait],baseline=ledger.selection?.start?.[trait]
      if(!outcome||!baseline||!finiteNumber(outcome.mean)||!finiteNumber(baseline.mean))return[]
      const delta=outcome.mean-baseline.mean
      const standardizedDelta=finiteNumber(baseline.sd)&&baseline.sd>0?delta/baseline.sd:null
      return[{trait,traitLabel:TRAIT_LABELS[trait],outcomeMean:outcome.mean,baselineMean:baseline.mean,delta,standardizedDelta,direction:delta===0?'about the same':TRAIT_DIRECTIONS[trait][delta<0?0:1]}]
    })
    if(!candidates.length)return[unavailableFingerprint(cause,label,count)]
    const standardized=candidates.filter(candidate=>candidate.standardizedDelta!==null)
    const strongest=(standardized.length?standardized:candidates).reduce((best,candidate)=>{
      const bestMagnitude=Math.abs(best.standardizedDelta??best.delta),candidateMagnitude=Math.abs(candidate.standardizedDelta??candidate.delta)
      return candidateMagnitude>bestMagnitude?candidate:best
    })
    const status:PressureFingerprintStatus=count<SELECTION_PATTERN_MIN_COUNT?'too-few':!standardized.length?'baseline-unavailable':meetsStandardizedEffectThreshold(strongest.standardizedDelta??0,SELECTION_PATTERN_THRESHOLD)?'pattern':'no-standout'
    const interpretation=status==='pattern'?`Possible pattern — descriptive, not causal: this group was ${strongest.direction} on average (${formatSignedEffect(strongest.standardizedDelta??0)} baseline SD).`:status==='too-few'?'Too few observations to read a pattern.':status==='baseline-unavailable'?'Baseline spread unavailable, so this comparison cannot be standardized.':`No outcome pattern reached the ${SELECTION_PATTERN_THRESHOLD} baseline-SD threshold. Strongest observed difference was ${formatSignedEffect(strongest.standardizedDelta??0)} baseline SD.`
    return[{cause,label,count,comparison:strongest,status,interpretation}]
  })
}

/** Convert a ledger into the plain-language review shown by the journal. */
export function deriveGenerationReview(ledger:GenerationLedger|undefined):GenerationReview|null{
  if(!ledger)return null
  const nextPopulation=(ledger.outcomes.survived??0)+(ledger.birthsAdmitted??0)
  const resource={
    start:ledger.foodAtStart,
    produced:ledger.foodProduced,
    removed:ledger.foodRemoved,
    consumed:ledger.foodConsumed,
    remaining:ledger.foodRemaining,
    expected:ledger.foodAtStart+ledger.foodProduced-ledger.foodRemoved-ledger.foodConsumed,
  }
  return{
    generation:ledger.generation,
    evaluatedPopulation:ledger.startPopulation,
    nextPopulation,
    populationChange:nextPopulation-ledger.startPopulation,
    outcomes:JOURNAL_OUTCOME_KEYS.map(cause=>({cause,label:OUTCOME_LABELS[cause],count:ledger.outcomes[cause]??0})),
    survivors:ledger.outcomes.survived,
    resource:{...resource,reconciled:resource.expected===resource.remaining},
    attacks:{attempts:ledger.attackAttempts,attemptBasis:ledger.attackAttemptBasis??null,wins:ledger.attackSuccesses,failures:ledger.attackFailures,contested:ledger.attackContested??null,preyConsumed:ledger.preyConsumed},
    births:{eligible:ledger.birthsEligible,admitted:ledger.birthsAdmitted,capped:ledger.birthsCapped},
    takeaway:getSelectionTakeaway(ledger),
  }
}

export const getJournalReview=deriveGenerationReview

/** Summarize recorded outcomes without implying that an outcome caused another one. */
export function deriveGenerationInterpretation(review:GenerationReview):string{
  const losses=review.outcomes.filter(outcome=>outcome.cause!=='survived'&&outcome.count>0)
  const largestCount=losses.reduce((largest,outcome)=>Math.max(largest,outcome.count),0)
  const largest=losses.filter(outcome=>outcome.count===largestCount)
  const lossText=largest.length===1?`${largest[0].label} was the largest recorded loss (${largestCount})`:`${largest.map(outcome=>outcome.label).join(' and ')} were tied as the largest recorded losses (${largestCount} each)`
  const flow=`survivors: ${review.survivors}; admitted births: ${review.births.admitted}; next population: ${review.nextPopulation}`
  if(review.nextPopulation===0)return`Descriptive only: no next population remained; ${flow}. ${largest.length?`${lossText}.`:'No loss outcome was recorded.'}`
  if(!largest.length&&review.survivors===review.evaluatedPopulation)return`Descriptive only: all ${review.evaluatedPopulation} creatures survived; ${flow}.`
  return`Descriptive only: ${largest.length?lossText:'No recorded loss stood out'}; ${flow}.`
}

const emptyInheritanceTraits=():Record<BiologicalTrait,InheritanceTraitSummary>=>Object.fromEntries(JOURNAL_TRAITS.map(trait=>[trait,{parentMean:null,offspringMean:null,changedCount:0}])) as Record<BiologicalTrait,InheritanceTraitSummary>
const nonNegativeInteger=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=0
const validMean=(value:unknown):value is number|null=>value===null||finiteNumber(value)
const inheritanceRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null

/** Derive a conservative parent-to-newborn audit, keeping old ledgers explicit rather than guessing. */
export function deriveInheritanceAudit(ledger:GenerationLedger|undefined):InheritanceAuditReview{
  const empty=emptyInheritanceTraits()
  if(!ledger||!nonNegativeInteger(ledger.birthsAdmitted))return{status:'legacy-unavailable',offspringCount:0,changedTraitValues:0,traits:empty}
  const raw=(ledger as GenerationLedger & {inheritance?:unknown}).inheritance
  if(ledger.birthsAdmitted===0){
    if(raw===undefined)return{status:'no-births',offspringCount:0,changedTraitValues:0,traits:empty}
    if(!inheritanceRecord(raw)||raw.offspringCount!==0||raw.changedTraitValues!==0)return{status:'legacy-unavailable',offspringCount:0,changedTraitValues:0,traits:empty}
    return{status:'no-births',offspringCount:0,changedTraitValues:0,traits:empty}
  }
  if(!inheritanceRecord(raw)||!nonNegativeInteger(raw.offspringCount)||raw.offspringCount!==ledger.birthsAdmitted||!nonNegativeInteger(raw.changedTraitValues)||raw.changedTraitValues>raw.offspringCount*JOURNAL_TRAITS.length||!inheritanceRecord(raw.traits))return{status:'legacy-unavailable',offspringCount:0,changedTraitValues:0,traits:empty}
  const traits=Object.fromEntries(JOURNAL_TRAITS.map(trait=>{
    const value=raw.traits?.[trait]
    if(!inheritanceRecord(value)||!validMean(value.parentMean)||!validMean(value.offspringMean)||!nonNegativeInteger(value.changedCount)||value.changedCount>raw.offspringCount||value.changedCount===0&&value.parentMean!==value.offspringMean)return[trait,null]
    if(value.parentMean===null||value.offspringMean===null)return[trait,null]
    return[trait,{parentMean:value.parentMean,offspringMean:value.offspringMean,changedCount:value.changedCount}]
  })) as Record<BiologicalTrait,InheritanceTraitSummary|null>
  if(JOURNAL_TRAITS.some(trait=>traits[trait]===null))return{status:'legacy-unavailable',offspringCount:0,changedTraitValues:0,traits:empty}
  const complete=traits as Record<BiologicalTrait,InheritanceTraitSummary>
  if(JOURNAL_TRAITS.reduce((sum,trait)=>sum+complete[trait].changedCount,0)!==raw.changedTraitValues)return{status:'legacy-unavailable',offspringCount:0,changedTraitValues:0,traits:empty}
  return{status:'available',offspringCount:raw.offspringCount,changedTraitValues:raw.changedTraitValues,traits:complete}
}

export interface GenerationJournalProps {
  ledgers:readonly GenerationLedger[]
  events:readonly WorldEvent[]
  /** Null follows the newest completed generation; a number pins a historical review. */
  requestedGeneration:number|null
  onRequestedGenerationChange:(generation:number|null)=>void
}

const formatNumber=(value:number)=>Number.isInteger(value)?String(value):value.toFixed(2)

/** Format two finite means with the least shared decimal precision that keeps them distinct. */
export function formatAdaptivePair(first:number,second:number):[string,string]{
  if(first===second)return[formatNumber(first),formatNumber(second)]
  const twoDecimals=[first.toFixed(2),second.toFixed(2)] as [string,string]
  if(twoDecimals[0]!==twoDecimals[1])return twoDecimals
  for(let decimals=3;decimals<=6;decimals++){
    const format=(value:number)=>value.toFixed(decimals)
    const formattedFirst=format(first),formattedSecond=format(second)
    if(formattedFirst!==formattedSecond)return[formattedFirst,formattedSecond]
  }
  return[first.toFixed(6),second.toFixed(6)]
}

const formatSignedEffect=(value:number)=>{
  const displayEffect=snapStandardizedEffect(value),magnitude=Math.abs(displayEffect)
  let decimals=1
  if(magnitude<SELECTION_PATTERN_THRESHOLD){
    decimals=2
    while(decimals<12&&Number(magnitude.toFixed(decimals))>=SELECTION_PATTERN_THRESHOLD)decimals++
  }
  return`${displayEffect>=0?'+':'-'}${magnitude.toFixed(decimals)}`
}

const formatSurvivorLossDifference=(trait:SurvivorLossTraitComparison)=>{
  if(trait.difference===null||!finiteNumber(trait.difference))return'Unavailable'
  if(trait.standardizedDifference!==null&&finiteNumber(trait.standardizedDifference))return`${formatSignedEffect(trait.standardizedDifference)} cohort SD`
  return`${trait.difference>=0?'+':''}${formatNumber(trait.difference)} raw · cohort spread unavailable`
}

function SurvivorLossComparisonPanel({comparison}:{comparison:SurvivorLossComparison}){
  const statusCopy=comparison.status==='no-survivors'
    ? 'No survivors were recorded; trait means cannot be compared for this generation.'
    : comparison.status==='no-losses'
      ? 'No losses were recorded; trait means cannot be compared for this generation.'
      : comparison.interpretation
  return <div className="event-story journal-events pressure-patterns" data-comparison-status={comparison.status}>
    <h3>Survivors vs recorded losses</h3>
    {comparison.status==='available'&&<><p className="journal-kicker">All six traits are shown. Loss means count-weight all recorded loss outcomes combined; survivor-minus-loss differences use evaluated-cohort spread when available.</p><p className="journal-equation"><strong>{comparison.survivorCount}</strong> survivors vs <strong>{comparison.lossCount}</strong> recorded losses</p><ul className="story-grid" aria-label="Survivor and combined loss trait means for the selected generation">{comparison.traits.map(trait=>{
      const means=trait.survivorMean===null||trait.lossMean===null?null:formatAdaptivePair(trait.survivorMean,trait.lossMean)
      const label=trait.traitLabel[0].toUpperCase()+trait.traitLabel.slice(1)
      return <li key={trait.trait}><span>{label}</span><strong>Survivors {means?.[0]??'Unavailable'} · losses {means?.[1]??'Unavailable'}</strong><span>Survivor mean − loss mean: {formatSurvivorLossDifference(trait)}</span></li>
    })}</ul></>}
    <p className={comparison.status==='available'?'journal-kicker':'journal-warning'} role="note">{statusCopy}</p>
  </div>
}

export function GenerationJournal({ledgers,events,requestedGeneration,onRequestedGenerationChange}:GenerationJournalProps){
  const previousLatestGeneration=useRef<number|null>(null)
  const selection=useMemo(()=>resolveJournalSelection(ledgers,requestedGeneration),[ledgers,requestedGeneration])
  const selectedLedger=selection.entries.find(ledger=>ledger.generation===selection.selectedGeneration)
  const review=deriveGenerationReview(selectedLedger)
  const inheritance=deriveInheritanceAudit(selectedLedger)
  const survivorLossComparison=deriveSurvivorLossComparison(selectedLedger)
  const pressureFingerprints=derivePressureFingerprints(selectedLedger)
  const eventReview=deriveJournalEvents(events,selection.selectedGeneration)
  const latestGeneration=selection.entries.at(-1)?.generation??null

  useEffect(()=>{
    const previous=previousLatestGeneration.current
    previousLatestGeneration.current=latestGeneration
    if(previous!==null&&latestGeneration!==null&&latestGeneration<previous&&requestedGeneration!==null)onRequestedGenerationChange(null)
  },[latestGeneration,onRequestedGenerationChange,requestedGeneration])
  useEffect(()=>{
    if(requestedGeneration!==null&&selection.selectedGeneration!==requestedGeneration)onRequestedGenerationChange(selection.selectedGeneration)
  },[onRequestedGenerationChange,requestedGeneration,selection.entries.length,selection.selectedGeneration])
  useEffect(()=>{completePendingGenerationJournalFocus()},[selection.entries.length,selection.selectedGeneration])

  const chooseGeneration=(value:string)=>onRequestedGenerationChange(value===''?null:Number(value))
  const pinCurrent=()=>onRequestedGenerationChange(pinCurrentGeneration(ledgers,requestedGeneration))
  const followLatest=()=>onRequestedGenerationChange(null)

  return <div className="evolution-story generation-journal">
    <div className="story-head">
      <div><h2 id="generation-journal-title">Generation journal</h2><p>Review one completed generation at a time. Older reviews stay pinned while the run continues.</p></div>
      <div className="journal-controls">
        <label className="metric-select" htmlFor="generation-review">Review generation
          <select id="generation-review" aria-label="Review completed generation" value={selection.selectedGeneration===null?'':String(selection.selectedGeneration)} onChange={event=>chooseGeneration(event.target.value)} disabled={!selection.entries.length}>
            {!selection.entries.length&&<option value="">No completed generations yet</option>}
            {selection.entries.map(ledger=><option key={ledger.generation} value={ledger.generation}>Generation {ledger.generation} · {ledger.outcomes.survived} survived · {ledger.birthsAdmitted} born</option>)}
          </select>
        </label>
        <button type="button" className="settings-toggle journal-latest" onClick={followLatest} aria-pressed={selection.followsLatest} aria-label="Follow the latest completed generation">Latest{selection.followsLatest?' · following':' · follow'}</button>
        <button type="button" className="settings-toggle journal-pin" onClick={pinCurrent} disabled={!selection.followsLatest||selection.selectedGeneration===null} aria-label="Pin the current latest generation">{selection.followsLatest?'Pin current':'Pinned'}</button>
      </div>
    </div>

    {!review?<p className="journal-empty" role="status">Finish a generation to open its review. The selector will retain up to the latest 40 completed generations.</p>:<>
      <div className="journal-context" role="status"><strong>Generation {review.generation}</strong><span>{selection.followsLatest?'Following latest completed generation':'Pinned historical review'}</span></div>
      <div className="story-grid journal-grid">
        <div><h3>Population outcomes</h3><p className="journal-kicker">Evaluated cohort: <strong>{review.evaluatedPopulation}</strong> creatures at settlement · each has one result</p><p className="journal-equation"><strong>{review.evaluatedPopulation}</strong> evaluated → <strong>{review.survivors}</strong> survived + <strong>{review.births.admitted}</strong> newborns = <strong>{review.nextPopulation}</strong> next population ({review.populationChange===0?'no net change':`${review.populationChange>0?'+':''}${review.populationChange}`})</p><div className="utility-breakdown"><table><tbody>{review.outcomes.map(outcome=><tr key={outcome.cause}><th scope="row">{outcome.label}</th><td>{outcome.count}</td></tr>)}</tbody></table></div></div>
        <div><h3>Resource balance</h3><p className="journal-equation"><strong>{formatNumber(review.resource.start)}</strong> start + <strong>{formatNumber(review.resource.produced)}</strong> produced − <strong>{formatNumber(review.resource.removed)}</strong> drought removed − <strong>{formatNumber(review.resource.consumed)}</strong> consumed = <strong>{formatNumber(review.resource.remaining)}</strong> remaining</p><p className={review.resource.reconciled?'journal-check':'journal-warning'} role="status">{review.resource.reconciled?'✓ Resource count reconciles.':`Check resource count: expected ${formatNumber(review.resource.expected)}.`}</p><p className="journal-kicker">Survivors: <strong>{review.survivors}</strong></p></div>
        <div><h3>Attacks &amp; births</h3><p className="journal-kicker">{formatAttackBasisNote(review.attacks.attemptBasis)}</p><div className="utility-breakdown"><table><tbody><tr><th scope="row">{formatAttackAttemptLabel(review.attacks.attemptBasis)}</th><td>{review.attacks.attempts}</td></tr><tr><th scope="row">Wins / failures</th><td>{review.attacks.wins} / {review.attacks.failures}</td></tr><tr><th scope="row">Contested same-prey claims</th><td>{review.attacks.contested===null?'Unavailable':review.attacks.contested}</td></tr><tr><th scope="row">Prey consumed</th><td>{review.attacks.preyConsumed}</td></tr><tr><th scope="row">Eligible parents → admitted births</th><td>{review.births.eligible} → {review.births.admitted}</td></tr><tr><th scope="row">Births capped</th><td>{review.births.capped}</td></tr><tr><th scope="row">Parents of newborns</th><td>{review.births.admitted}</td></tr></tbody></table></div></div>
      </div>
      <div className="journal-takeaway"><strong>Recorded outcome summary</strong><span>{deriveGenerationInterpretation(review)}</span></div>
      <div className="event-story journal-events pressure-patterns"><h3>How offspring inherited traits</h3><p className="journal-kicker">One admitted parent produces one same-lineage offspring. Newborns copy all six traits, then enabled traits may mutate independently.{inheritance.status==='available'?' Rows show parent mean → newborn mean.':''}</p>{inheritance.status==='available'?<><p className="journal-equation"><strong>Generation {review.generation} → {review.generation+1}</strong> · {inheritance.offspringCount} newborns · <strong>{inheritance.changedTraitValues}</strong> final trait values changed out of {inheritance.offspringCount*JOURNAL_TRAITS.length}</p><ul className="story-grid">{JOURNAL_TRAITS.map(trait=>{const summary=inheritance.traits[trait],means=formatAdaptivePair(summary.parentMean!,summary.offspringMean!);return <li key={trait}><span>{TRAIT_LABELS[trait][0].toUpperCase()+TRAIT_LABELS[trait].slice(1)}</span><strong>{means[0]} → {means[1]} · {summary.changedCount} of {inheritance.offspringCount} changed</strong></li>})}</ul></>:inheritance.status==='no-births'?<p className="journal-kicker">Generation {review.generation} → {review.generation+1}: no parent→offspring comparison; no admitted parent produced a newborn.</p>:<p className="journal-kicker">Generation {review.generation} → {review.generation+1}: this retained record has {review.births.admitted} births, but its parent→offspring trait comparison is unavailable.</p>}{inheritance.status==='available'&&<p className="journal-kicker">Changed means the final clamped value differed from the matched parent; this is not a mutation-attempt count. A zero here does not imply mutation was disabled.</p>}</div>
      <div className="journal-takeaway"><strong>Selection takeaway</strong><span>{review.takeaway}</span></div>
      <SurvivorLossComparisonPanel comparison={survivorLossComparison}/>
      {pressureFingerprints.length>0&&<div className="event-story journal-events pressure-patterns"><h3>Outcome trait patterns</h3><p className="journal-kicker">Compared with the evaluated cohort; associations are descriptive, not proof of cause.</p><ul>{pressureFingerprints.map(fingerprint=>{const comparison=fingerprint.comparison,means=comparison?formatAdaptivePair(comparison.outcomeMean,comparison.baselineMean):null;return <li key={fingerprint.cause}><span>{fingerprint.label} · n={fingerprint.count}</span>{comparison&&means?<strong>{comparison.traitLabel}: {means[0]} vs cohort {means[1]} ({comparison.direction})</strong>:<strong>Trait comparison unavailable.</strong>}<span>{fingerprint.interpretation}</span></li>})}</ul></div>}
      <div className="event-story journal-events"><h3>Ecosystem events · generation {review.generation}</h3>{eventReview.events.length?<>{eventReview.status==='partial'&&<p className="journal-kicker">Showing retained events; earlier events from this generation may no longer be available.</p>}<ul>{eventReview.events.map((event,index)=><li key={`${isValidJournalEventGeneration(journalEventField(event,'generation'))?journalEventField(event,'generation'):'unknown'}-${isValidJournalEventDay(journalEventField(event,'day'))?journalEventField(event,'day'):'unavailable'}-${journalEventSortKind(event)}-${index}`}><span>{formatJournalEventDay(journalEventField(event,'day'))}</span><strong>{formatJournalEventSummary(journalEventField(event,'summary'))}</strong></li>)}</ul></>:<p className="journal-kicker">{eventReview.status==='unknown'?'Event history is unavailable for this generation.':'No shocks occurred in this generation.'}</p>}</div>
    </>}
  </div>
}

export default GenerationJournal
