import { useEffect, useMemo, useRef } from 'react'
import { getSelectionTakeaway, MAX_WORLD_EVENTS } from '../simulation/engine'
import { END_CAUSES } from '../simulation/types'
import type { BiologicalTrait, EndCause, GenerationLedger, InheritanceTraitSummary, SelectionSummary, WorldEvent } from '../simulation/types'

export const MAX_JOURNAL_ENTRIES = 40

const OUTCOME_LABELS:Record<EndCause,string>={
  survived:'Survived',
  hunted:'Hunted',
  energy:'Energy depleted',
  unfed:'Returned without enough food',
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

export interface GenerationReview {
  generation:number
  evaluatedPopulation:number
  nextPopulation:number
  populationChange:number
  outcomes:{cause:EndCause;label:string;count:number}[]
  survivors:number
  resource:{start:number;produced:number;removed:number;consumed:number;remaining:number;expected:number;reconciled:boolean}
  attacks:{attempts:number;wins:number;failures:number;preyConsumed:number}
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

/** Events are world-level, so keep only shocks that happened during the reviewed generation. */
export function filterJournalEvents(events:readonly WorldEvent[],generation:number|null){
  if(generation===null)return []
  return events.filter(event=>event.generation===generation).sort((a,b)=>a.day-b.day||a.kind.localeCompare(b.kind))
}

export type JournalEventStatus='events'|'partial'|'none'|'unknown'

export interface JournalEventReview {
  events:WorldEvent[]
  status:JournalEventStatus
}

/** Distinguish a known empty generation from an older generation beyond the event buffer. */
export function getJournalEventStatus(events:readonly WorldEvent[],generation:number|null,retentionLimit=MAX_WORLD_EVENTS):JournalEventStatus{
  if(generation===null)return'unknown'
  const matches=filterJournalEvents(events,generation)
  const limit=Math.max(1,Math.floor(retentionLimit))
  const bufferFull=events.length>=limit
  const oldestGeneration=events.length?Math.min(...events.map(event=>event.generation)):null
  if(matches.length)return bufferFull&&generation===oldestGeneration?'partial':'events'
  if(events.length<limit)return'none'
  return oldestGeneration!==null&&generation>oldestGeneration?'none':'unknown'
}

export function deriveJournalEvents(events:readonly WorldEvent[],generation:number|null,retentionLimit=MAX_WORLD_EVENTS):JournalEventReview{
  return{events:filterJournalEvents(events,generation),status:getJournalEventStatus(events,generation,retentionLimit)}
}

const finiteNumber=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
const unavailableFingerprint=(cause:EndCause,label:string,count:number):PressureFingerprint=>({cause,label,count,comparison:null,status:'unavailable',interpretation:'Pattern unavailable from this runtime data.'})

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
    const status:PressureFingerprintStatus=count<3?'too-few':!standardized.length?'baseline-unavailable':Math.abs(strongest.standardizedDelta??0)>=.5?'pattern':'no-standout'
    const interpretation=status==='pattern'?`Possible pattern — descriptive, not causal: this group was ${strongest.direction} on average (${formatSignedEffect(strongest.standardizedDelta??0)} baseline SD).`:status==='too-few'?'Too few observations to read a pattern.':status==='baseline-unavailable'?'Baseline spread unavailable, so this comparison cannot be standardized.':'No trait stood out (standardized difference < 0.5).'
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
    attacks:{attempts:ledger.attackAttempts,wins:ledger.attackSuccesses,failures:ledger.attackFailures,preyConsumed:ledger.preyConsumed},
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

const formatSignedEffect=(value:number)=>`${value>=0?'+':''}${value.toFixed(1)}`

export function GenerationJournal({ledgers,events,requestedGeneration,onRequestedGenerationChange}:GenerationJournalProps){
  const previousLatestGeneration=useRef<number|null>(null)
  const selection=useMemo(()=>resolveJournalSelection(ledgers,requestedGeneration),[ledgers,requestedGeneration])
  const selectedLedger=selection.entries.find(ledger=>ledger.generation===selection.selectedGeneration)
  const review=deriveGenerationReview(selectedLedger)
  const inheritance=deriveInheritanceAudit(selectedLedger)
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

  const chooseGeneration=(value:string)=>onRequestedGenerationChange(value===''?null:Number(value))
  const pinCurrent=()=>onRequestedGenerationChange(pinCurrentGeneration(ledgers,requestedGeneration))
  const followLatest=()=>onRequestedGenerationChange(null)

  return <section className="evolution-story generation-journal" aria-labelledby="generation-journal-title">
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
        <div><h3>Attacks &amp; births</h3><div className="utility-breakdown"><table><tbody><tr><th scope="row">Attack attempts</th><td>{review.attacks.attempts}</td></tr><tr><th scope="row">Wins / failures</th><td>{review.attacks.wins} / {review.attacks.failures}</td></tr><tr><th scope="row">Prey consumed</th><td>{review.attacks.preyConsumed}</td></tr><tr><th scope="row">Eligible parents → admitted births</th><td>{review.births.eligible} → {review.births.admitted}</td></tr><tr><th scope="row">Births capped</th><td>{review.births.capped}</td></tr><tr><th scope="row">Parents of newborns</th><td>{review.births.admitted}</td></tr></tbody></table></div></div>
      </div>
      <div className="journal-takeaway"><strong>Recorded outcome summary</strong><span>{deriveGenerationInterpretation(review)}</span></div>
      <div className="event-story journal-events pressure-patterns"><h3>How offspring inherited traits</h3><p className="journal-kicker">One admitted parent produces one same-lineage offspring. Newborns copy all six traits, then enabled traits may mutate independently.{inheritance.status==='available'?' Rows show parent mean → newborn mean.':''}</p>{inheritance.status==='available'?<><p className="journal-equation"><strong>Generation {review.generation} → {review.generation+1}</strong> · {inheritance.offspringCount} newborns · <strong>{inheritance.changedTraitValues}</strong> final trait values changed out of {inheritance.offspringCount*JOURNAL_TRAITS.length}</p><ul className="story-grid">{JOURNAL_TRAITS.map(trait=>{const summary=inheritance.traits[trait],means=formatAdaptivePair(summary.parentMean!,summary.offspringMean!);return <li key={trait}><span>{TRAIT_LABELS[trait][0].toUpperCase()+TRAIT_LABELS[trait].slice(1)}</span><strong>{means[0]} → {means[1]} · {summary.changedCount} of {inheritance.offspringCount} changed</strong></li>})}</ul></>:inheritance.status==='no-births'?<p className="journal-kicker">Generation {review.generation} → {review.generation+1}: no parent→offspring comparison; no admitted parent produced a newborn.</p>:<p className="journal-kicker">Generation {review.generation} → {review.generation+1}: this retained record has {review.births.admitted} births, but its parent→offspring trait comparison is unavailable.</p>}{inheritance.status==='available'&&<p className="journal-kicker">Changed means the final clamped value differed from the matched parent; this is not a mutation-attempt count. A zero here does not imply mutation was disabled.</p>}</div>
      <div className="journal-takeaway"><strong>Selection takeaway</strong><span>{review.takeaway}</span></div>
      {pressureFingerprints.length>0&&<div className="event-story journal-events pressure-patterns"><h3>Outcome trait patterns</h3><p className="journal-kicker">Compared with the evaluated cohort; associations are descriptive, not proof of cause.</p><ul>{pressureFingerprints.map(fingerprint=>{const comparison=fingerprint.comparison,means=comparison?formatAdaptivePair(comparison.outcomeMean,comparison.baselineMean):null;return <li key={fingerprint.cause}><span>{fingerprint.label} · n={fingerprint.count}</span>{comparison&&means?<strong>{comparison.traitLabel}: {means[0]} vs cohort {means[1]} ({comparison.direction})</strong>:<strong>Trait comparison unavailable.</strong>}<span>{fingerprint.interpretation}</span></li>})}</ul></div>}
      <div className="event-story journal-events"><h3>Ecosystem events · generation {review.generation}</h3>{eventReview.events.length?<>{eventReview.status==='partial'&&<p className="journal-kicker">Showing retained events; earlier events from this generation may no longer be available.</p>}<ul>{eventReview.events.map((event,index)=><li key={`${event.generation}-${event.day}-${event.kind}-${index}`}><span>Day {event.day.toFixed(2)}</span><strong>{event.summary}</strong></li>)}</ul></>:<p className="journal-kicker">{eventReview.status==='unknown'?'Event history is unavailable for this generation.':'No shocks occurred in this generation.'}</p>}</div>
    </>}
  </section>
}

export default GenerationJournal
