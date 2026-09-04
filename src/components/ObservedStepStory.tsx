import type {NextActionActivityWindow} from '../simulation/scheduler'
import type {WorldActivityEntry,WorldActivityKind} from '../simulation/types'
import type {ArenaPlaybackStatus} from './ArenaCanvasModel'

export interface StepActivityEvidence{activity:readonly WorldActivityEntry[];window:NextActionActivityWindow|undefined}

export interface FirstGenerationGuideProps{
  playbackStatus:ArenaPlaybackStatus
  selection:'none'|'creature'|'patch'
  stepState:'ready'|'pending'|'observed'|'finishing'
}

const labels:Record<WorldActivityKind,string>={'food-collected':'Food collected','attack-success':'Attack success','attack-failure':'Attack failed','energy-death':'Energy loss','reached-home':'Reached home','natural-regrowth':'Natural regrowth',intervention:'Intervention','generation-settlement':'Generation settled'}
const safe=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0
const validKind=(value:unknown):value is WorldActivityKind=>typeof value==='string'&&Object.prototype.hasOwnProperty.call(labels,value)

/** Summarize the immutable records captured with one acknowledged manual step. */
export function formatStepActivitySummary(evidence:StepActivityEvidence|null):string{
  if(evidence===null)return''
  const window=evidence.window
  if(!window||window.sequenceReset||!safe(window.startSequence)||!safe(window.endSequence)||!safe(window.recordedCount)||window.endSequence<window.startSequence||window.recordedCount!==window.endSequence-window.startSequence)return'During this step: Event telemetry was unavailable for this step.'
  if(!window.recordedCount)return'During this step: No key moments were recorded; movement or decisions may still have changed.'
  const entries=(Array.isArray(evidence.activity)?evidence.activity:[]).filter(entry=>safe(entry?.sequence)&&validKind(entry?.kind)&&entry.sequence>window.startSequence&&entry.sequence<=window.endSequence).sort((a,b)=>a.sequence-b.sequence)
  if(entries.length>window.recordedCount||entries.some((entry,index)=>entry.sequence!==window.endSequence-entries.length+index+1))return'During this step: Event telemetry was unavailable for this step.'
  const omitted=window.recordedCount-entries.length
  if(!entries.length)return`During this step: ${window.recordedCount} key ${window.recordedCount===1?'moment was':'moments were'} recorded, but ${window.recordedCount===1?'its detail fell':'their details fell'} outside retained run history.`
  const counts=new Map<WorldActivityKind,number>()
  for(const entry of entries)counts.set(entry.kind,(counts.get(entry.kind)??0)+1)
  const groups=[...counts].map(([kind,count])=>`${labels[kind]}${count>1?` ×${count}`:''}`),shown=groups.slice(0,3),hidden=groups.length-shown.length
  if(hidden)shown.push(`${hidden} more ${hidden===1?'kind':'kinds'}`)
  return`During this step: ${window.recordedCount} key ${window.recordedCount===1?'moment':'moments'} · ${shown.join(' · ')}.${omitted?` ${omitted} earlier ${omitted===1?'moment fell':'moments fell'} outside retained run history.`:''}`
}

/** Keep the first experiment legible as a short causal walkthrough in the arena. */
export function formatFirstGenerationGuide(input:FirstGenerationGuideProps):readonly[string,string]{
  if(input.stepState==='finishing')return['First generation · 3/3 — recording the cohort…','The handoff will show survival, reproduction, and Generation 2.']
  if(input.playbackStatus==='Awaiting settlement')return['First generation · 3/3 — choose Finish generation.','Record survival and reproduction, then change one parameter and restart to compare.']
  if(input.selection==='patch')return['Patch view — read live food, energy, and regrowth below.','Then inspect a creature to reveal one decision beat.']
  if(input.stepState==='pending')return['First generation · 2/3 — advancing one decision beat…','Observed path will explain perception → decision → outcome.']
  if(input.stepState==='observed')return['First generation · 3/3 — read Observed path below.','Then Finish generation; afterward change one parameter and restart to compare.']
  if(input.selection==='creature')return['First generation · 2/3 — choose this creature’s Next action.','One decision beat will reveal what it sensed and chose.']
  if(input.playbackStatus==='Running')return['First generation · 1/3 — pause the run.','Then inspect a creature and choose its Next action.']
  return['First generation · 1/3 — choose a creature in Inspect.','Creatures unlock one-action playback; patches explain resources.']
}

export function FirstGenerationGuide(props:FirstGenerationGuideProps){
  return <div role="note" aria-label="First generation guide">{formatFirstGenerationGuide(props).map(line=><small key={line}>{line}</small>)}</div>
}

export function ObservedStepStory({observedPath,evidence}:{observedPath:string;evidence:StepActivityEvidence|null}){
  const activitySummary=formatStepActivitySummary(evidence)
  return <div className="interventions" role="group" aria-label="Latest manual action">
    <span><strong>Observed path</strong><small>Latest manual action</small></span>
    <output role="status" aria-live="polite" aria-atomic="true" style={{display:'grid',gap:2,flex:1,maxWidth:'none',overflowWrap:'anywhere'}}><span>{observedPath}</span>{activitySummary&&<span>{activitySummary}</span>}</output>
  </div>
}

export default ObservedStepStory
