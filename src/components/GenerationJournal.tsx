import { useEffect, useMemo, useRef, useState } from 'react'
import { getSelectionTakeaway, MAX_WORLD_EVENTS } from '../simulation/engine'
import type { EndCause, GenerationLedger, WorldEvent } from '../simulation/types'

export const MAX_JOURNAL_ENTRIES = 40

const OUTCOME_LABELS:Record<EndCause,string>={
  survived:'Survived',
  hunted:'Hunted',
  energy:'Energy depleted',
  unfed:'Returned without enough food',
  late:'Missed return deadline',
  aged:'Old age',
}

export const JOURNAL_OUTCOME_KEYS:readonly EndCause[]=['survived','hunted','energy','unfed','late','aged']

export interface GenerationReview {
  generation:number
  evaluatedPopulation:number
  outcomes:{cause:EndCause;label:string;count:number}[]
  survivors:number
  resource:{start:number;produced:number;removed:number;consumed:number;remaining:number;expected:number;reconciled:boolean}
  attacks:{attempts:number;wins:number;failures:number;preyConsumed:number}
  births:{eligible:number;admitted:number;capped:number}
  takeaway:string
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

/** Convert a ledger into the plain-language review shown by the journal. */
export function deriveGenerationReview(ledger:GenerationLedger|undefined):GenerationReview|null{
  if(!ledger)return null
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
    outcomes:JOURNAL_OUTCOME_KEYS.map(cause=>({cause,label:OUTCOME_LABELS[cause],count:ledger.outcomes[cause]??0})),
    survivors:ledger.outcomes.survived,
    resource:{...resource,reconciled:resource.expected===resource.remaining},
    attacks:{attempts:ledger.attackAttempts,wins:ledger.attackSuccesses,failures:ledger.attackFailures,preyConsumed:ledger.preyConsumed},
    births:{eligible:ledger.birthsEligible,admitted:ledger.birthsAdmitted,capped:ledger.birthsCapped},
    takeaway:getSelectionTakeaway(ledger),
  }
}

export const getJournalReview=deriveGenerationReview

export interface GenerationJournalProps {
  ledgers:readonly GenerationLedger[]
  events:readonly WorldEvent[]
  /** Increment this when a run is restarted so a stale pin cannot leak into the new run. */
  resetKey?:number|string
}

const formatNumber=(value:number)=>Number.isInteger(value)?String(value):value.toFixed(2)

export function GenerationJournal({ledgers,events,resetKey}:GenerationJournalProps){
  const [requestedGeneration,setRequestedGeneration]=useState<number|null>(null)
  const previousLatestGeneration=useRef<number|null>(null)
  const selection=useMemo(()=>resolveJournalSelection(ledgers,requestedGeneration),[ledgers,requestedGeneration])
  const selectedLedger=selection.entries.find(ledger=>ledger.generation===selection.selectedGeneration)
  const review=deriveGenerationReview(selectedLedger)
  const eventReview=deriveJournalEvents(events,selection.selectedGeneration)
  const latestGeneration=selection.entries.at(-1)?.generation??null

  useEffect(()=>{setRequestedGeneration(null)},[resetKey])
  useEffect(()=>{
    const previous=previousLatestGeneration.current
    previousLatestGeneration.current=latestGeneration
    if(previous!==null&&latestGeneration!==null&&latestGeneration<previous)setRequestedGeneration(null)
  },[latestGeneration])
  useEffect(()=>{
    if(requestedGeneration!==null&&selection.selectedGeneration!==requestedGeneration)setRequestedGeneration(selection.selectedGeneration)
    else if(!selection.entries.length&&requestedGeneration!==null)setRequestedGeneration(null)
  },[requestedGeneration,selection.entries.length,selection.selectedGeneration])

  const chooseGeneration=(value:string)=>setRequestedGeneration(value===''?null:Number(value))
  const pinCurrent=()=>setRequestedGeneration(pinCurrentGeneration(ledgers,requestedGeneration))
  const followLatest=()=>setRequestedGeneration(null)

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
        <div><h3>Population outcomes</h3><p className="journal-kicker">Evaluated cohort: <strong>{review.evaluatedPopulation}</strong> creatures at settlement · each has one result</p><div className="utility-breakdown"><table><tbody>{review.outcomes.map(outcome=><tr key={outcome.cause}><th scope="row">{outcome.label}</th><td>{outcome.count}</td></tr>)}</tbody></table></div></div>
        <div><h3>Resource balance</h3><p className="journal-equation"><strong>{formatNumber(review.resource.start)}</strong> start + <strong>{formatNumber(review.resource.produced)}</strong> produced − <strong>{formatNumber(review.resource.removed)}</strong> drought removed − <strong>{formatNumber(review.resource.consumed)}</strong> consumed = <strong>{formatNumber(review.resource.remaining)}</strong> remaining</p><p className={review.resource.reconciled?'journal-check':'journal-warning'} role="status">{review.resource.reconciled?'✓ Resource count reconciles.':`Check resource count: expected ${formatNumber(review.resource.expected)}.`}</p><p className="journal-kicker">Survivors: <strong>{review.survivors}</strong></p></div>
        <div><h3>Attacks &amp; births</h3><div className="utility-breakdown"><table><tbody><tr><th scope="row">Attack attempts</th><td>{review.attacks.attempts}</td></tr><tr><th scope="row">Wins / failures</th><td>{review.attacks.wins} / {review.attacks.failures}</td></tr><tr><th scope="row">Prey consumed</th><td>{review.attacks.preyConsumed}</td></tr><tr><th scope="row">Eligible parents → admitted births</th><td>{review.births.eligible} → {review.births.admitted}</td></tr><tr><th scope="row">Births capped</th><td>{review.births.capped}</td></tr><tr><th scope="row">Parents of newborns</th><td>{review.births.admitted}</td></tr></tbody></table></div></div>
      </div>
      <div className="journal-takeaway"><strong>Selection takeaway</strong><span>{review.takeaway}</span></div>
      <div className="event-story journal-events"><h3>Ecosystem events · generation {review.generation}</h3>{eventReview.events.length?<>{eventReview.status==='partial'&&<p className="journal-kicker">Showing retained events; earlier events from this generation may no longer be available.</p>}<ul>{eventReview.events.map((event,index)=><li key={`${event.generation}-${event.day}-${event.kind}-${index}`}><span>Day {event.day.toFixed(2)}</span><strong>{event.summary}</strong></li>)}</ul></>:<p className="journal-kicker">{eventReview.status==='unknown'?'No shocks retained for this generation.':'No shocks occurred in this generation.'}</p>}</div>
    </>}
  </section>
}

export default GenerationJournal
