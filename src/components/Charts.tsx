import { END_CAUSES } from '../simulation/types'
import type { BiologicalTrait,EndCause,GenerationLedger,HistoryPoint,World,WorldEvent } from '../simulation/types'
import { MAX_WORLD_EVENTS } from '../simulation/engine'
import { useEffect,useRef } from 'react'
import { speedColor } from './ArenaCanvasModel'

export const SPEED_HISTOGRAM_DOMAIN = {min:.3,max:2.8} as const
const traitDomains:Record<BiologicalTrait,{min:number;max:number}>={speed:{min:.3,max:2.8},size:{min:.3,max:2.8},sense:{min:.035,max:.6},aggression:{min:0,max:1},caution:{min:0,max:1},exploration:{min:0,max:1}}
type NonSpeedTrait=Exclude<BiologicalTrait,'speed'>
const traitHueRamps:Record<NonSpeedTrait,{start:number;end:number}>={size:{start:20,end:4},sense:{start:198,end:168},aggression:{start:-12,end:14},caution:{start:236,end:202},exploration:{start:94,end:136}}
const clampUnit=(value:number)=>Math.max(0,Math.min(1,value))
export function traitColor(trait:BiologicalTrait,value:number){
  if(trait==='speed')return speedColor(value)
  const domain=traitDomains[trait],normalized=clampUnit((value-domain.min)/(domain.max-domain.min)),ramp=traitHueRamps[trait],hue=(ramp.start+(ramp.end-ramp.start)*normalized+360)%360
  return `hsl(${hue} 58% ${38+normalized*18}%)`
}
export function summarizeDistribution(values:number[]){if(!values.length)return{mean:0,median:0,q1:0,q3:0,iqr:0,sd:0};const sorted=[...values].sort((a,b)=>a-b),quantile=(p:number)=>{const index=(sorted.length-1)*p,low=Math.floor(index),fraction=index-low;return sorted[low]+(sorted[Math.min(low+1,sorted.length-1)]-sorted[low])*fraction},mean=values.reduce((a,b)=>a+b,0)/values.length,sd=Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/values.length),q1=quantile(.25),q3=quantile(.75);return{mean,median:quantile(.5),q1,q3,iqr:q3-q1,sd}}
function buildHistogram(values:number[],domain:{min:number;max:number},count=12){const counts=Array(count).fill(0)as number[];values.forEach(v=>counts[Math.max(0,Math.min(count-1,Math.floor((v-domain.min)/(domain.max-domain.min)*count)))]++);return counts.map((value,i)=>({count:value,lower:domain.min+i/count*(domain.max-domain.min),upper:domain.min+(i+1)/count*(domain.max-domain.min)}))}

export function buildSpeedHistogram(values:number[],bins=12){
  const {min,max}=SPEED_HISTOGRAM_DOMAIN
  const counts=Array(bins).fill(0) as number[]
  values.forEach(v=>counts[Math.max(0,Math.min(bins-1,Math.floor((v-min)/(max-min)*bins)))]++)
  return counts.map((count,i)=>({
    count,
    lower:min+i/bins*(max-min),
    upper:min+(i+1)/bins*(max-min),
  }))
}

export const MAX_TIMELINE_ENTRIES=40
export const BEHAVIOR_HISTORY_CONTEXT='Mean behavior traits in each next population; survivors and newborns combined.'
export const GENERATION_JOURNAL_TARGET_ID='generation-journal'
export const GENERATION_REVIEW_TARGET_ID='generation-review'
export const GENERATION_JOURNAL_PENDING_FOCUS_ATTRIBUTE='data-generation-journal-focus-pending'

export interface GenerationJournalJumpTarget {
  disabled?:boolean
  scrollIntoView:(options?:ScrollIntoViewOptions)=>void
  focus:(options?:FocusOptions)=>void
  setAttribute?:(name:string,value:string)=>void
  removeAttribute?:(name:string)=>void
  hasAttribute?:(name:string)=>boolean
}

export interface GenerationJournalJumpDocument {
  getElementById:(id:string)=>GenerationJournalJumpTarget|null
  activeElement?:GenerationJournalJumpTarget|null
}

export interface GenerationJournalJumpOptions {
  document?:GenerationJournalJumpDocument
  scheduleFocus?:(callback:()=>void)=>void
}

export const GENERATION_JOURNAL_SCROLL_OPTIONS:ScrollIntoViewOptions={behavior:'auto',block:'center',inline:'nearest'}

const scheduleGenerationJournalFocus=(callback:()=>void)=>{
  if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>callback())
  else setTimeout(callback,0)
}

const journalReviewEnabled=(target:GenerationJournalJumpTarget|null):target is GenerationJournalJumpTarget=>Boolean(target&&!target.disabled)
const markGenerationJournalFocusPending=(target:GenerationJournalJumpTarget)=>target.setAttribute?.(GENERATION_JOURNAL_PENDING_FOCUS_ATTRIBUTE,'true')
const clearGenerationJournalFocusPending=(target:GenerationJournalJumpTarget|null)=>target?.removeAttribute?.(GENERATION_JOURNAL_PENDING_FOCUS_ATTRIBUTE)
const hasGenerationJournalFocusPending=(target:GenerationJournalJumpTarget|null)=>Boolean(target?.hasAttribute?.(GENERATION_JOURNAL_PENDING_FOCUS_ATTRIBUTE))

/** Complete a deferred journal jump after its lazy review selector mounts. */
export function completePendingGenerationJournalFocus(options:Pick<GenerationJournalJumpOptions,'document'>={}):boolean{
  const documentRef:GenerationJournalJumpDocument|null=options.document??(typeof document==='undefined'?null:document as unknown as GenerationJournalJumpDocument)
  if(!documentRef)return false
  const journal=documentRef.getElementById(GENERATION_JOURNAL_TARGET_ID)
  if(!hasGenerationJournalFocusPending(journal))return false
  if(documentRef.activeElement!==journal){clearGenerationJournalFocusPending(journal);return false}
  const review=documentRef.getElementById(GENERATION_REVIEW_TARGET_ID)
  if(!journalReviewEnabled(review))return false
  review.focus({preventScroll:true})
  clearGenerationJournalFocusPending(journal)
  return true
}

/** Open the selected generation's journal review only when the user explicitly requests it. */
export function openGenerationJournalReview(options:GenerationJournalJumpOptions={}):boolean{
  const documentRef:GenerationJournalJumpDocument|null=options.document??(typeof document==='undefined'?null:document as unknown as GenerationJournalJumpDocument)
  if(!documentRef)return false
  const journal=documentRef.getElementById(GENERATION_JOURNAL_TARGET_ID),review=documentRef.getElementById(GENERATION_REVIEW_TARGET_ID),enabledReview=journalReviewEnabled(review),pending=!enabledReview&&Boolean(journal),scrollTarget=enabledReview?review:journal
  if(!scrollTarget)return false
  scrollTarget.scrollIntoView(GENERATION_JOURNAL_SCROLL_OPTIONS)
  if(pending){
    markGenerationJournalFocusPending(scrollTarget)
    scrollTarget.focus({preventScroll:true})
  }
  const scheduleFocus=options.scheduleFocus??scheduleGenerationJournalFocus
  scheduleFocus(()=>{
    if(pending){completePendingGenerationJournalFocus({document:documentRef});return}
    const currentReview=documentRef.getElementById(GENERATION_REVIEW_TARGET_ID),currentJournal=documentRef.getElementById(GENERATION_JOURNAL_TARGET_ID)
    if(journalReviewEnabled(currentReview)){
      currentReview.focus({preventScroll:true})
      clearGenerationJournalFocusPending(currentJournal)
    }
  })
  return true
}

const HISTORY_TRAITS:BiologicalTrait[]=['speed','size','sense','aggression','caution','exploration']
const HISTORY_TRAIT_FIELDS:Record<BiologicalTrait,keyof HistoryPoint>={speed:'avgSpeed',size:'avgSize',sense:'avgSense',aggression:'avgAggression',caution:'avgCaution',exploration:'avgExploration'}

export interface HistoryTimelineEntry {
  generation:number
  point:HistoryPoint|null
  nextPopulation:number|null
  nextMeanEnergy:number|null
  nextMeanAge:number|null
  births:number
  outcomes:Record<EndCause,number>
  retainedEvents:number
}

const timelineOutcomes=(ledger:GenerationLedger):Record<EndCause,number>=>Object.fromEntries(END_CAUSES.map(cause=>[cause,ledger?.outcomes?.[cause]??0])) as Record<EndCause,number>

/** Join retained generation ledgers to history by generation, not by array position. */
export function buildHistoryTimeline(ledgers:readonly GenerationLedger[],history:readonly HistoryPoint[],events:readonly WorldEvent[],limit=MAX_TIMELINE_ENTRIES):HistoryTimelineEntry[]{
  const bounded=Math.max(0,Math.floor(limit)),recent=bounded?ledgers.slice(-bounded):[]
  return recent.flatMap(ledger=>{
    if(!ledger||typeof ledger!=='object'||!Number.isSafeInteger(ledger.generation)||ledger.generation<0)return[]
    const point=history.find(candidate=>candidate?.generation===ledger.generation)??null
    return[{generation:ledger.generation,point,nextPopulation:point?.population??null,nextMeanEnergy:point?.avgEnergy??null,nextMeanAge:point?.avgAge??null,births:ledger.birthsAdmitted,outcomes:timelineOutcomes(ledger),retainedEvents:events.filter(event=>event?.generation===ledger.generation).length}]
  })
}

/** Resolve a shared scrubber value to the nearest retained generation. */
export function resolveTimelineGeneration(entries:readonly HistoryTimelineEntry[],requestedGeneration:number|null){
  if(!entries.length)return null
  if(requestedGeneration===null)return entries.at(-1)!.generation
  if(entries.some(entry=>entry.generation===requestedGeneration))return requestedGeneration
  if(requestedGeneration<=entries[0].generation)return entries[0].generation
  if(requestedGeneration>=entries.at(-1)!.generation)return entries.at(-1)!.generation
  return entries.reduce((closest,entry)=>Math.abs(entry.generation-requestedGeneration)<Math.abs(closest.generation-requestedGeneration)?entry:closest).generation
}

const TIMELINE_OUTCOME_LABELS:Record<EndCause,string>={survived:'survived',hunted:'hunted',energy:'energy depleted',unfed:'no food at settlement',late:'missed return deadline',aged:'old age'}
const timelineValue=(value:number|null,nonnegative=false)=>value===null||!Number.isFinite(value)||(nonnegative&&value<0)?'unavailable':Number.isInteger(value)?String(value):value.toFixed(2).replace(/\.?0+$/,'')

export interface GenerationRulerMark {
  generation:number
  index:number
  position:'first'|'middle'|'last'|'selected'
  selected:boolean
}

/** Keep a compact, truthful first/middle/last ruler aligned to retained rows. */
export function buildGenerationRuler(entries:readonly Pick<HistoryTimelineEntry,'generation'>[],selectedGeneration:number|null):GenerationRulerMark[]{
  if(!Array.isArray(entries))return[]
  const retained:{generation:number;index:number}[]=[],seen=new Set<number>()
  entries.forEach((entry,index)=>{
    const generation=entry?.generation
    if(!Number.isSafeInteger(generation)||generation<0||seen.has(generation))return
    seen.add(generation)
    retained.push({generation,index})
  })
  if(!retained.length)return[]
  const picks:{position:GenerationRulerMark['position'];index:number}[]=retained.length===1
    ? [{position:'first' as const,index:0}]
    : retained.length===2
      ? [{position:'first' as const,index:0},{position:'last' as const,index:retained.length-1}]
      : [{position:'first' as const,index:0},{position:'middle' as const,index:Math.floor(retained.length/2)},{position:'last' as const,index:retained.length-1}]
  const selected=selectedGeneration!==null&&Number.isSafeInteger(selectedGeneration)&&selectedGeneration>=0?selectedGeneration:null
  const selectedIndex=selected===null? -1:retained.findIndex(entry=>entry.generation===selected)
  if(selectedIndex>0&&selectedIndex<retained.length-1&&!picks.some(pick=>pick.index===selectedIndex))picks.push({position:'selected',index:selectedIndex})
  return picks.sort((left,right)=>left.index-right.index).map(({position,index})=>({generation:retained[index].generation,index:retained[index].index,position,selected:retained[index].generation===selected}))
}

interface GenerationRulerProps {
  entries:readonly Pick<HistoryTimelineEntry,'generation'>[]
  selectedGeneration:number|null
  compact?:boolean
}

/** Make the chart's left-to-right time direction and current scrubber selection explicit. */
export function GenerationRuler({entries,selectedGeneration,compact=false}:GenerationRulerProps){
  const marks=buildGenerationRuler(entries,selectedGeneration)
  if(!marks.length)return null
  const count=Array.isArray(entries)?entries.length:0,first=marks[0],last=marks.at(-1)!,selected=selectedGeneration!==null&&Number.isSafeInteger(selectedGeneration)&&selectedGeneration>=0?selectedGeneration:null
  const direction='Earlier generations → later generations',selection=selected===null?'No generation selected':`Inspecting Gen ${selected}`
  const positioned=marks.map(mark=>{const offset=generationRulerOffset(mark.index,count);return offset===null?null:{...mark,offset}}).filter((mark):mark is GenerationRulerMark&{offset:number}=>mark!==null)
  if(!positioned.length)return null
  const labelWidth=compact?56:64,hasInsertedSelection=positioned.some(mark=>mark.position==='selected'),trackHeight=hasInsertedSelection?(compact?49:52):(compact?31:34)
  return <div className="generation-ruler" role="group" aria-label={`Generation ruler from Gen ${first.generation} to Gen ${last.generation}. ${direction}. ${selection}.`} style={{display:'grid',gap:compact?0:2,width:'100%',minWidth:0,margin:compact?'1px 0 0':'4px 0 6px',fontSize:11,lineHeight:1.25,color:'var(--muted)'}}>
    {!compact&&<strong style={{color:'var(--ink)',fontSize:11,lineHeight:1.3}}>Generation · earlier → later</strong>}
    <div style={{position:'relative',height:trackHeight,minWidth:0,width:'100%',borderTop:'1px solid var(--line)',paddingTop:2}}>
      {positioned.map(mark=>{const alignment=positioned.length===1?'translateX(-50%)':mark===positioned[0]?'translateX(0)':mark===positioned.at(-1)?'translateX(-100%)':'translateX(-50%)',labelTop=mark.position==='selected'?(compact?19:21):4;return <span key={`${mark.generation}-${mark.index}`} style={{position:'absolute',left:`${mark.offset}%`,top:0,width:0,height:trackHeight}}><span aria-hidden="true" style={{position:'absolute',left:0,top:-5,display:'block',width:1,height:5,background:'var(--muted)'}}/><span aria-current={mark.selected?'true':undefined} aria-label={`Generation ${mark.generation}${mark.selected?' selected':''}`} style={{position:'absolute',left:0,top:labelTop,transform:alignment,display:'grid',justifyItems:'center',width:labelWidth,textAlign:'center',fontWeight:mark.selected?700:500,color:mark.selected?'var(--ink)':'var(--muted)',whiteSpace:'nowrap'}}><span>{mark.generation}</span>{mark.selected&&<small style={{fontSize:11}}>selected</small>}</span></span>})}
    </div>
  </div>
}

const chartSvgSlug=(scope:string,key:string)=>`${scope}-${key.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}`
const chartSvgSemantics=(scope:string,key:string)=>{
  const slug=chartSvgSlug(scope,key)
  return{titleId:`${slug}-title`,descriptionId:`${slug}-description`}
}

/** Keep observed energy/age values chartable without inventing a physical ceiling. */
export function safeNonnegativeHistoryValue(value:unknown):number|null{
  return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null
}

/** Keep malformed trait values out of labels, tables, and SVG coordinates. */
export function safeFiniteHistoryValue(value:unknown):number|null{
  return typeof value==='number'&&Number.isFinite(value)?value:null
}

/** Use the observed nonnegative range, with a one-unit minimum for readable empty/small charts. */
export function buildObservedNonnegativeDomain(values:readonly unknown[]){
  const observed=values.map(safeNonnegativeHistoryValue).filter((value):value is number=>value!==null)
  return{min:0,max:Math.max(1,...observed)} as const
}

/** Concise text shared by the visible timeline summary and its range's aria-valuetext. */
export function formatTimelineSummary(entry:HistoryTimelineEntry){
  const outcomes=END_CAUSES.filter(cause=>entry.outcomes[cause]>0).map(cause=>`${entry.outcomes[cause]} ${TIMELINE_OUTCOME_LABELS[cause]}`).join(', ')
  const events=entry.retainedEvents>0?`; ${entry.retainedEvents} retained ${entry.retainedEvents===1?'event':'events'}`:''
  return`Generation ${entry.generation}: next population ${timelineValue(entry.nextPopulation,true)}, mean energy ${timelineValue(entry.nextMeanEnergy,true)}, mean age ${timelineValue(entry.nextMeanAge,true)}, ${timelineValue(entry.births,true)} births${outcomes?`; outcomes ${outcomes}`:''}${events}`
}

export const OUTCOME_FLOW_MISSING_TEXT='unavailable for malformed or partial record'
export type OutcomeFlowCapState='available'|'unavailable'

export interface OutcomeFlowTimelineEntry {
  generation:number
  startPopulation:number|null
  outcomes:Record<EndCause,number|null>
  evaluated:number|null
  cohortFlowAvailable:boolean
  survivors:number|null
  birthsEligible:number|null
  birthsAdmitted:number|null
  birthsCapped:number|null
  birthCapState:OutcomeFlowCapState
  exactNextPopulation:number|null
  nextPopulationAvailable:boolean
}

const OUTCOME_FLOW_LOSS_LABELS:Record<Exclude<EndCause,'survived'>,string>={hunted:'hunted',energy:'energy depleted',unfed:'no food at settlement',late:'missed return deadline',aged:'old age'}
export type OutcomeFlowSegmentKey=EndCause|'births'|'capped'
export type OutcomeFlowPattern='solid'|'diagonal'|'crosshatch'|'horizontal'|'vertical'|'dots'|'reverse-diagonal'|'grid'
export interface OutcomeFlowLegendItem {key:OutcomeFlowSegmentKey;label:string;color:string;pattern:OutcomeFlowPattern}
export const OUTCOME_FLOW_CARD_SURFACES= ['#f9fbf7','#182520'] as const
export const OUTCOME_FLOW_LEGEND:readonly OutcomeFlowLegendItem[]=[
  {key:'survived',label:'Survived',color:'#4b8f72',pattern:'solid'},
  {key:'hunted',label:'Hunted',color:'#a25f54',pattern:'diagonal'},
  {key:'energy',label:'Energy depleted',color:'#8c7054',pattern:'crosshatch'},
  {key:'unfed',label:'No food at settlement',color:'#72806b',pattern:'horizontal'},
  {key:'late',label:'Missed return deadline',color:'#6a6f85',pattern:'vertical'},
  {key:'aged',label:'Old age',color:'#6a7e83',pattern:'dots'},
  {key:'births',label:'Admitted births',color:'#527f80',pattern:'reverse-diagonal'},
  {key:'capped',label:'Capped births (not admitted)',color:'#81805c',pattern:'grid'},
]
const OUTCOME_FLOW_SWATCH_PATTERNS:Record<OutcomeFlowPattern,string>={
  solid:'none',
  diagonal:'repeating-linear-gradient(135deg, transparent 0 3px, var(--paper) 3px 4px)',
  crosshatch:'repeating-linear-gradient(45deg, transparent 0 3px, var(--paper) 3px 4px), repeating-linear-gradient(-45deg, transparent 0 3px, var(--paper) 3px 4px)',
  horizontal:'repeating-linear-gradient(0deg, transparent 0 3px, var(--paper) 3px 4px)',
  vertical:'repeating-linear-gradient(90deg, transparent 0 3px, var(--paper) 3px 4px)',
  dots:'radial-gradient(var(--paper) 1px, transparent 1.2px) 0 0 / 4px 4px',
  'reverse-diagonal':'repeating-linear-gradient(45deg, transparent 0 3px, var(--paper) 3px 4px)',
  grid:'repeating-linear-gradient(0deg, transparent 0 3px, var(--paper) 3px 4px), repeating-linear-gradient(90deg, transparent 0 3px, var(--paper) 3px 4px)',
}

const hexColor=(value:unknown):[number,number,number]|null=>{
  if(typeof value!=='string')return null
  const trimmed=value.trim(),match=/^#([\da-f]{3}|[\da-f]{6})$/i.exec(trimmed)
  if(!match)return null
  const hex=match[1].length===3?match[1].split('').map(char=>char+char).join(''):match[1]
  return[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16)/255) as [number,number,number]
}
const relativeLuminance=(rgb:[number,number,number])=>rgb.map(channel=>channel<=.03928?channel/12.92:((channel+.055)/1.055)**2.4).reduce((sum,channel,index)=>sum+channel*[.2126,.7152,.0722][index],0)
/** Calculate WCAG contrast for the fixed outcome-flow colors and their surfaces. */
export function contrastRatio(foreground:string,background:string):number|null{
  const foregroundRgb=hexColor(foreground),backgroundRgb=hexColor(background)
  if(!foregroundRgb||!backgroundRgb)return null
  const foregroundLuminance=relativeLuminance(foregroundRgb),backgroundLuminance=relativeLuminance(backgroundRgb)
  return(Math.max(foregroundLuminance,backgroundLuminance)+.05)/(Math.min(foregroundLuminance,backgroundLuminance)+.05)
}
const outcomeFlowPatternId=(key:OutcomeFlowSegmentKey,scope:string)=>`outcome-flow-${scope}-${key}`
const outcomeFlowPatternOverlay=(pattern:OutcomeFlowPattern)=>{
  const stroke={stroke:'var(--paper)',strokeWidth:.9,fill:'none',opacity:.8}
  if(pattern==='solid')return null
  if(pattern==='dots')return <circle cx="2" cy="2" r="1" style={{fill:'var(--paper)',opacity:.8}}/>
  if(pattern==='diagonal'||pattern==='reverse-diagonal')return <path d={pattern==='diagonal'?'M -2 2 L 2 -2 M 2 10 L 10 2':'M -2 -2 L 6 6 M 2 -2 L 10 6'} style={stroke}/>
  if(pattern==='crosshatch')return <><path d="M -2 2 L 2 -2 M 2 10 L 10 2" style={stroke}/><path d="M -2 6 L 6 -2 M 2 10 L 10 2" style={stroke}/></>
  if(pattern==='horizontal')return <path d="M 0 2 H 8 M 0 6 H 8" style={stroke}/>
  if(pattern==='vertical')return <path d="M 2 0 V 8 M 6 0 V 8" style={stroke}/>
  return <><path d="M 0 2 H 8 M 0 6 H 8" style={stroke}/><path d="M 2 0 V 8 M 6 0 V 8" style={stroke}/></>
}
const outcomeFlowPatternDefinitions=(scope:string)=> <defs>{OUTCOME_FLOW_LEGEND.map(item=><pattern key={item.key} id={outcomeFlowPatternId(item.key,scope)} width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" style={{fill:item.color}}/>{outcomeFlowPatternOverlay(item.pattern)}</pattern>)}</defs>

const isSafeNonnegativeInteger=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0
const isRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value))
const readRecordValue=(record:Record<string,unknown>,key:string):unknown=>{
  try{return record[key]}catch{return undefined}
}
const safeAddIntegers=(left:number|null,right:number|null):number|null=>{
  if(left===null||right===null||!isSafeNonnegativeInteger(left)||!isSafeNonnegativeInteger(right)||left>Number.MAX_SAFE_INTEGER-right)return null
  return left+right
}
const validCohortFlow=(startPopulation:number|null,outcomes:Record<EndCause,number|null>)=>{
  if(startPopulation===null||!END_CAUSES.every(cause=>outcomes[cause]!==null))return false
  const total=END_CAUSES.reduce<number|null>((sum,cause)=>safeAddIntegers(sum,outcomes[cause]),0)
  return total===startPopulation
}
const validBirthCapacity=(survivors:number|null,birthsEligible:number|null,birthsAdmitted:number|null,birthsCapped:number|null)=>survivors!==null&&birthsEligible!==null&&birthsAdmitted!==null&&birthsCapped!==null&&birthsAdmitted<=birthsEligible&&birthsEligible<=survivors&&safeAddIntegers(birthsAdmitted,birthsCapped)===birthsEligible
const validNextPopulation=(startPopulation:number|null,survivors:number|null,birthsEligible:number|null,birthsAdmitted:number|null)=>{
  const total=safeAddIntegers(survivors,birthsAdmitted),birthCapacityKnownAndValid=birthsEligible===null||survivors===null||(birthsAdmitted!==null&&birthsAdmitted<=birthsEligible&&birthsEligible<=survivors)
  return startPopulation!==null&&survivors!==null&&survivors<=startPopulation&&birthsAdmitted!==null&&birthsAdmitted<=survivors&&birthCapacityKnownAndValid&&total!==null
}
const normalizeOutcomeFlowLimit=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.floor(value)):MAX_TIMELINE_ENTRIES

/**
 * Build a truthful, retained outcome-flow timeline from unknown ledger data.
 * Known scalar fields are kept in partial records; derived stacks stay unavailable
 * until their accounting identities and capacity bounds reconcile exactly.
 */
export function buildOutcomeFlowTimeline(ledgers:unknown,limit=MAX_TIMELINE_ENTRIES):OutcomeFlowTimelineEntry[]{
  if(!Array.isArray(ledgers))return[]
  const bounded=normalizeOutcomeFlowLimit(limit),records:OutcomeFlowTimelineEntry[]=[]
  for(const rawLedger of (bounded?ledgers.slice(-bounded):[])){
    if(!isRecord(rawLedger))continue
    const generation=readRecordValue(rawLedger,'generation')
    if(!isSafeNonnegativeInteger(generation)||generation<1)continue
    const startValue=readRecordValue(rawLedger,'startPopulation'),startPopulation=isSafeNonnegativeInteger(startValue)?startValue:null
    const rawOutcomes=readRecordValue(rawLedger,'outcomes'),outcomes=Object.fromEntries(END_CAUSES.map(cause=>{
      const value=isRecord(rawOutcomes)?readRecordValue(rawOutcomes,cause):undefined
      return[cause,isSafeNonnegativeInteger(value)?value:null]
    })) as Record<EndCause,number|null>
    const cohortFlowAvailable=validCohortFlow(startPopulation,outcomes)
    const evaluated=cohortFlowAvailable?startPopulation:null
    const survivors=outcomes.survived
    const birthsEligibleValue=readRecordValue(rawLedger,'birthsEligible'),birthsEligible=isSafeNonnegativeInteger(birthsEligibleValue)?birthsEligibleValue:null
    const birthsAdmittedValue=readRecordValue(rawLedger,'birthsAdmitted'),birthsAdmitted=isSafeNonnegativeInteger(birthsAdmittedValue)?birthsAdmittedValue:null
    const birthsCappedValue=readRecordValue(rawLedger,'birthsCapped'),birthsCapped=isSafeNonnegativeInteger(birthsCappedValue)?birthsCappedValue:null
    const nextTotal=safeAddIntegers(survivors,birthsAdmitted)
    const nextPopulationAvailable=validNextPopulation(startPopulation,survivors,birthsEligible,birthsAdmitted)&&nextTotal!==null
    const birthCapState:OutcomeFlowCapState=validBirthCapacity(survivors,birthsEligible,birthsAdmitted,birthsCapped)?'available':'unavailable'
    records.push({generation,startPopulation,outcomes,evaluated,cohortFlowAvailable,survivors,birthsEligible,birthsAdmitted,birthsCapped,birthCapState,exactNextPopulation:nextPopulationAvailable?nextTotal:null,nextPopulationAvailable})
  }
  return records
}

const outcomeFlowCountText=(value:number|null)=>value===null?'Unavailable':String(value)
const outcomeFlowEntryValue=(entry:unknown,key:string)=>isRecord(entry)?readRecordValue(entry,key):undefined
const outcomeFlowValue=(entry:unknown,cause:EndCause)=>{const value=outcomeFlowEntryValue(isRecord(entry)?readRecordValue(entry,'outcomes'):undefined,cause);return isSafeNonnegativeInteger(value)?value:null}
const normalizedOutcomeFlowOutcomes=(entry:unknown)=>Object.fromEntries(END_CAUSES.map(cause=>[cause,outcomeFlowValue(entry,cause)])) as Record<EndCause,number|null>
const outcomeFlowKnownText=(entry:unknown)=>END_CAUSES.filter(cause=>outcomeFlowValue(entry,cause)!==null).map(cause=>`${outcomeFlowValue(entry,cause)} ${cause==='survived'?'survived':OUTCOME_FLOW_LOSS_LABELS[cause]}`).join(', ')

const outcomeFlowCountPhrase=(value:number,label:string,plural=label)=>`${value} ${value===1?label:plural}`

interface OutcomeFlowSummaryLines {generation:string;cohort:string;next:string;cap:string;known:string;note:string}

const buildOutcomeFlowSummaryLines=(entry:unknown):OutcomeFlowSummaryLines=>{
  const generation=outcomeFlowEntryValue(entry,'generation'),startValue=outcomeFlowEntryValue(entry,'startPopulation'),startPopulation=isSafeNonnegativeInteger(startValue)?startValue:null,outcomes=normalizedOutcomeFlowOutcomes(entry),survivors=outcomes.survived,birthsEligibleValue=outcomeFlowEntryValue(entry,'birthsEligible'),birthsEligible=isSafeNonnegativeInteger(birthsEligibleValue)?birthsEligibleValue:null,birthsAdmittedValue=outcomeFlowEntryValue(entry,'birthsAdmitted'),birthsAdmitted=isSafeNonnegativeInteger(birthsAdmittedValue)?birthsAdmittedValue:null,birthsCappedValue=outcomeFlowEntryValue(entry,'birthsCapped'),birthsCapped=isSafeNonnegativeInteger(birthsCappedValue)?birthsCappedValue:null,cohortFlowAvailable=validCohortFlow(startPopulation,outcomes),nextPopulationAvailable=validNextPopulation(startPopulation,survivors,birthsEligible,birthsAdmitted),nextTotal=safeAddIntegers(survivors,birthsAdmitted),birthCapAvailable=validBirthCapacity(survivors,birthsEligible,birthsAdmitted,birthsCapped),evaluated=cohortFlowAvailable?startPopulation:null,losses=END_CAUSES.filter((cause):cause is Exclude<EndCause,'survived'>=>cause!=='survived'&&outcomes[cause]!==null&&outcomes[cause]>0).map(cause=>outcomeFlowCountPhrase(outcomes[cause]!,OUTCOME_FLOW_LOSS_LABELS[cause],OUTCOME_FLOW_LOSS_LABELS[cause]))
  const cohort=cohortFlowAvailable&&evaluated!==null&&survivors!==null
    ?`Evaluated = survivors + losses: ${evaluated} = ${outcomeFlowCountPhrase(survivors,'survivor','survivors')}${losses.length?` + ${losses.join(' + ')}`:' + no recorded losses'}.`
    :`Evaluated = survivors + losses: ${OUTCOME_FLOW_MISSING_TEXT}.`
  const next=nextPopulationAvailable&&survivors!==null&&birthsAdmitted!==null&&nextTotal!==null
    ?`Survivors + admitted births = exact next population: ${survivors} + ${birthsAdmitted} = ${nextTotal} (${outcomeFlowCountPhrase(survivors,'survivor','survivors')}; ${outcomeFlowCountPhrase(birthsAdmitted,'admitted birth','admitted births')}).`
    :`Survivors + admitted births = exact next population: ${OUTCOME_FLOW_MISSING_TEXT}.`
  const cap=birthCapAvailable&&birthsEligible!==null&&birthsAdmitted!==null&&birthsCapped!==null
    ?`Birth cap: eligible parents = admitted births + capped births: ${birthsEligible} = ${birthsAdmitted} + ${birthsCapped} (${outcomeFlowCountPhrase(birthsEligible,'eligible parent','eligible parents')}; ${outcomeFlowCountPhrase(birthsAdmitted,'admitted birth','admitted births')}; ${outcomeFlowCountPhrase(birthsCapped,'capped birth','capped births')}).`
    :`Birth cap: eligible parents = admitted births + capped births: ${OUTCOME_FLOW_MISSING_TEXT}.`
  const known=cohortFlowAvailable?'':outcomeFlowKnownText(entry),generationText=isSafeNonnegativeInteger(generation)&&generation>=1?String(generation):'unavailable'
  return{generation:generationText,cohort,next,cap,known:known?`Known outcomes: ${known}.`:'',note:'Descriptive counts only; they do not establish cause.'}
}

/** Describe both independent settlement accounting equations for the selected row. */
export function formatOutcomeFlowSummary(entry:OutcomeFlowTimelineEntry){
  const lines=buildOutcomeFlowSummaryLines(entry)
  return`Generation ${lines.generation}. ${lines.cohort} ${lines.next} ${lines.cap}${lines.known?` ${lines.known}`:''} ${lines.note}`
}

/** Backwards-friendly short alias for callers that want the selected-row copy. */
export const formatOutcomeFlowSelection=formatOutcomeFlowSummary

export const RETAINED_SHOCK_CONTEXT='Retained shocks are observational context, not proof of cause.'
export const RETAINED_SHOCK_ORDER_NOTE='Listed by day; same-day shocks are alphabetized for display, not command order.'
export const RETAINED_SHOCK_ARIA_LABEL_LIMIT=240
const RETAINED_SHOCK_KINDS:readonly WorldEvent['kind'][]=['resource-bloom','drought','founder-migration']
const RETAINED_SHOCK_KIND_LABELS:Record<WorldEvent['kind'],string>={'resource-bloom':'Resource bloom',drought:'Drought','founder-migration':'Founder migration'}

export interface RetainedShockNavigatorGroup {
  generation:number
  events:WorldEvent[]
  label:string
  ariaLabel:string
  partial:boolean
}

export interface RetainedShockNavigator {
  groups:RetainedShockNavigatorGroup[]
  bufferFull:boolean
  retentionLimit:number
  partialOldestGeneration:number|null
}

const isCompletedGeneration=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&Number.isFinite(value)&&value>=1
const isRetainedShockKind=(value:unknown):value is WorldEvent['kind']=>typeof value==='string'&&(RETAINED_SHOCK_KINDS as readonly string[]).includes(value)
const normalizedShockSummary=(value:unknown)=>typeof value==='string'?value.trim().replace(/\s+/g,' '):''
const isValidRetainedShock=(event:WorldEvent):event is WorldEvent=>Boolean(event&&typeof event==='object'&&isCompletedGeneration(event.generation)&&typeof event.day==='number'&&Number.isFinite(event.day)&&event.day>=0&&isRetainedShockKind(event.kind)&&normalizedShockSummary(event.summary).length>0)
const normalizeRetentionLimit=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.max(1,Math.floor(value)):MAX_WORLD_EVENTS
const boundedShockText=(value:string,limit:number)=>value.length<=limit?value:`${value.slice(0,Math.max(0,limit-1)).trimEnd()}…`
const formatShockDay=(day:number)=>day.toFixed(2)

/** Group truthful retained shocks by the visible/latest forty completed generations. */
export function buildRetainedShockNavigator(entries:readonly HistoryTimelineEntry[],events:readonly WorldEvent[],retentionLimit=MAX_WORLD_EVENTS):RetainedShockNavigator{
  const limit=normalizeRetentionLimit(retentionLimit),visibleEntries=entries.slice(-MAX_TIMELINE_ENTRIES),visibleGenerations=new Set(visibleEntries.flatMap(entry=>isCompletedGeneration(entry.generation)?[entry.generation]:[])),byGeneration=new Map<number,WorldEvent[]>()
  for(const event of events){
    if(!isValidRetainedShock(event)||!visibleGenerations.has(event.generation))continue
    const bucket=byGeneration.get(event.generation)??[]
    bucket.push(event)
    byGeneration.set(event.generation,bucket)
  }
  const validEvents=events.filter(isValidRetainedShock),oldestValidGeneration=validEvents.length?Math.min(...validEvents.map(event=>event.generation)):null,bufferFull=events.length>=limit
  const partialOldestGeneration=bufferFull&&oldestValidGeneration!==null&&visibleGenerations.has(oldestValidGeneration)?oldestValidGeneration:null
  const groups:RetainedShockNavigatorGroup[]=[]
  const seen=new Set<number>()
  for(const entry of visibleEntries){
    const generation=entry.generation
    if(!isCompletedGeneration(generation)||seen.has(generation))continue
    seen.add(generation)
    const grouped=byGeneration.get(generation)
    if(!grouped?.length)continue
    const ordered=[...grouped].sort((a,b)=>a.day-b.day||a.kind.localeCompare(b.kind)),count=ordered.length,shockWord=count===1?'shock':'shocks',label=`Gen ${generation} · ${count} ${shockWord}`,partial=partialOldestGeneration===generation,preview=ordered.map(event=>`Day ${formatShockDay(event.day)} · ${RETAINED_SHOCK_KIND_LABELS[event.kind]}: ${normalizedShockSummary(event.summary)}`).join('; '),ariaLabel=boundedShockText(`${label}${partial?' (partial retained list)':''}. ${preview}. Select generation ${generation} to inspect its history.`,RETAINED_SHOCK_ARIA_LABEL_LIMIT)
    groups.push({generation,events:ordered,label,ariaLabel,partial})
  }
  return{groups,bufferFull,retentionLimit:limit,partialOldestGeneration}
}

/** Explain retention and interpretation limits alongside the navigator controls. */
export function formatRetainedShockNavigatorNotice(navigator:RetainedShockNavigator){
  if(!navigator.groups.length)return navigator.bufferFull?`The ${navigator.retentionLimit}-event buffer is full; no retained shocks overlap the visible completed-generation window. Earlier shocks may be missing.`:''
  const retentionWarning=navigator.bufferFull?` The ${navigator.retentionLimit}-event buffer is full; earlier shocks may be missing.`:''
  const partialWarning=navigator.partialOldestGeneration===null?'':` Generation ${navigator.partialOldestGeneration} is the oldest marked generation; its retained list may be partial.`
  return`${RETAINED_SHOCK_CONTEXT} ${RETAINED_SHOCK_ORDER_NOTE}${retentionWarning}${partialWarning}`
}

export type GenerationDeltaStatus='available'|'missing-selected'|'missing-predecessor'
export interface GenerationDelta {
  status:GenerationDeltaStatus
  generation:number|null
  previousGeneration:number|null
  population:number|null
  meanEnergy:number|null
  meanAge:number|null
  traits:Record<BiologicalTrait,number|null>
}

const emptyGenerationDelta=(status:GenerationDeltaStatus,generation:number|null,previousGeneration:number|null):GenerationDelta=>({status,generation,previousGeneration,population:null,meanEnergy:null,meanAge:null,traits:Object.fromEntries(HISTORY_TRAITS.map(trait=>[trait,null])) as Record<BiologicalTrait,number|null>})
const finiteDifference=(after:number|null|undefined,before:number|null|undefined)=>after!==null&&after!==undefined&&before!==null&&before!==undefined&&Number.isFinite(after)&&Number.isFinite(before)?after-before:null

/** Compare one retained history point with the exact preceding generation. */
export function buildGenerationDelta(history:readonly HistoryPoint[],generation:number|null):GenerationDelta{
  if(generation===null||!Number.isFinite(generation))return emptyGenerationDelta('missing-selected',null,null)
  const previousGeneration=generation-1,selected=history.find(point=>point.generation===generation)
  if(!selected)return emptyGenerationDelta('missing-selected',generation,previousGeneration)
  const previous=history.find(point=>point.generation===previousGeneration)
  if(!previous)return emptyGenerationDelta('missing-predecessor',generation,previousGeneration)
  return{status:'available',generation,previousGeneration,population:finiteDifference(selected.population,previous.population),meanEnergy:finiteDifference(selected.avgEnergy,previous.avgEnergy),meanAge:finiteDifference(selected.avgAge,previous.avgAge),traits:Object.fromEntries(HISTORY_TRAITS.map(trait=>{const field=HISTORY_TRAIT_FIELDS[trait];return[trait,finiteDifference(selected[field] as number|null,previous[field] as number|null)]})) as Record<BiologicalTrait,number|null>}
}

const formatObservedDeltaValue=(value:number|null,decimals:number)=>{
  if(value===null||!Number.isFinite(value))return'unavailable'
  const rounded=Number(value.toFixed(decimals))
  if(rounded===0)return'0'
  const formatted=decimals?rounded.toFixed(decimals):String(Math.round(rounded))
  return rounded>0?`+${formatted}`:formatted
}

/** Describe retained summary differences without implying why they changed. */
export function formatGenerationDelta(delta:GenerationDelta){
  if(delta.status==='missing-selected')return delta.generation===null?'No observed change available: no retained generation is selected.':`Generation ${delta.generation}: observed change unavailable; that generation is not retained.`
  if(delta.status==='missing-predecessor')return`Generation ${delta.generation}: observed change unavailable; generation ${delta.previousGeneration} is not retained.`
  const traits=HISTORY_TRAITS.map(trait=>`${trait} ${formatObservedDeltaValue(delta.traits[trait],2)}`).join(', ')
  return`Generation ${delta.generation} vs ${delta.previousGeneration}: population ${formatObservedDeltaValue(delta.population,0)}; mean energy ${formatObservedDeltaValue(delta.meanEnergy,2)}; mean age ${formatObservedDeltaValue(delta.meanAge,2)}; trait means ${traits}.`
}

export interface ChartCoordinate {x:number;y:number}

/** Convert a finite history value to SVG coordinates without ever emitting NaN. */
export function historyCoordinate(value:number|null,min:number,max:number,index:number,count:number,width=320,height=34,pad=3):ChartCoordinate|null{
  if(value===null||!Number.isFinite(value)||!Number.isFinite(min)||!Number.isFinite(max)||!Number.isFinite(index)||count<1||width<=pad*2||height<=pad*2)return null
  const range=max-min,normalized=range>0?Math.max(0,Math.min(1,(value-min)/range)):.5
  const denominator=Math.max(1,count-1),x=count===1?width/2:pad+Math.max(0,Math.min(denominator,index))/denominator*(width-pad*2),y=height-pad-normalized*(height-pad*2)
  return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null
}

/** Return the exact percentage offset used by a history cursor on a 320px plot. */
export function generationRulerOffset(index:number,count:number,width=320,pad=3):number|null{
  if(!Number.isSafeInteger(index)||index<0||!Number.isSafeInteger(count)||count<1||index>=count||!Number.isFinite(width)||width<=0||!Number.isFinite(pad)||pad<0||width<=pad*2)return null
  const point=historyCoordinate(0,0,1,index,count,width,34,pad)
  return point===null?null:point.x/width*100
}

export function Histogram({world,trait='speed'}:{world:World;trait?:BiologicalTrait}){
  const values=world.creatures.filter(c=>c.alive).map(c=>c[trait]), bins=trait==='speed'?buildSpeedHistogram(values):buildHistogram(values,traitDomains[trait])
  const peak=Math.max(1,...bins.map(bin=>bin.count))
  const low=values.length?Math.min(...values).toFixed(2):'0.00', high=values.length?Math.max(...values).toFixed(2):'0.00'
  return <><div className="histogram" role="img" aria-label={`${trait} distribution for ${values.length} living creatures, ranging from ${low} to ${high}.`}>
    {bins.map((bin,i)=><span key={i} style={{height:`${Math.max(bin.count?5:1,bin.count/peak*100)}%`,background:traitColor(trait,(bin.lower+bin.upper)/2)}} title={`${bin.lower.toFixed(2)}–${bin.upper.toFixed(2)}: ${bin.count}`} />)}
    <i className="axis-label left">low</i><i className="axis-label right">high</i>
  </div><table className="sr-only"><caption>{trait} distribution data</caption><thead><tr><th scope="col">Range</th><th scope="col">Creatures</th></tr></thead><tbody>{bins.map((bin,i)=><tr key={i}><th scope="row">{bin.lower.toFixed(2)} to {bin.upper.toFixed(2)}</th><td>{bin.count}</td></tr>)}</tbody></table></>
}

export interface HistoryChartProps {
  world:World
  requestedGeneration:number|null
  onSelectGeneration:(generation:number)=>void
}

/** Resolve a scrubber request to the nearest retained outcome-flow record. */
export function resolveOutcomeFlowGeneration(entries:readonly OutcomeFlowTimelineEntry[],requestedGeneration:number|null){
  if(!entries.length)return null
  if(requestedGeneration===null)return entries.at(-1)!.generation
  if(entries.some(entry=>entry.generation===requestedGeneration))return requestedGeneration
  if(requestedGeneration<=entries[0].generation)return entries[0].generation
  if(requestedGeneration>=entries.at(-1)!.generation)return entries.at(-1)!.generation
  return entries.reduce((closest,entry)=>Math.abs(entry.generation-requestedGeneration)<Math.abs(closest.generation-requestedGeneration)?entry:closest).generation
}

/** Locate the visual center of a retained generation slot without using endpoints. */
export function outcomeFlowSlotCenter(index:number,count:number,width=320,pad=3):number|null{
  if(!Number.isSafeInteger(index)||!Number.isSafeInteger(count)||count<1||index<0||index>=count||!Number.isFinite(width)||!Number.isFinite(pad)||width<=pad*2||pad<0)return null
  const center=pad+(index+.5)*(width-pad*2)/count
  return Number.isFinite(center)?center:null
}

/**
 * Compute the scroll offset that centers a selected outcome-flow slot.
 * Geometry is supplied by the caller so this stays deterministic and safe to
 * use while a responsive chart is between layouts.
 */
export function outcomeFlowScrollLeft(index:number,count:number,plotWidth:number,viewportWidth:number,currentScroll:number,plotOffset=0,scrollWidth=plotWidth,pad=3):number|null{
  if(!Number.isFinite(viewportWidth)||viewportWidth<=0||!Number.isFinite(currentScroll)||currentScroll<0||!Number.isFinite(plotOffset)||!Number.isFinite(scrollWidth)||scrollWidth<0)return null
  const slotCenter=outcomeFlowSlotCenter(index,count,plotWidth,pad)
  if(slotCenter===null)return null
  const maxScroll=Math.max(0,scrollWidth-viewportWidth),target=currentScroll+plotOffset+slotCenter-viewportWidth/2
  if(!Number.isFinite(target))return null
  return Math.max(0,Math.min(maxScroll,target))
}


interface OutcomeFlowBarRect {x:number;y:number;width:number;height:number}

/** Return one finite stacked-bar segment, or null for unavailable/zero data. */
const outcomeFlowBarRect=(value:number|null,offset:number,index:number,count:number,max:number,width:number,height:number,pad:number):OutcomeFlowBarRect|null=>{
  if(value===null||offset<0||!isSafeNonnegativeInteger(value)||!isSafeNonnegativeInteger(offset)||!isSafeNonnegativeInteger(max)||max<1||count<1||index<0||index>=count||width<=pad*2||height<=pad*2||value===0)return null
  const innerWidth=width-pad*2,innerHeight=height-pad*2,columnWidth=innerWidth/count,x=pad+index*columnWidth+Math.min(.5,columnWidth*.12),barWidth=Math.max(.5,columnWidth-Math.min(1,columnWidth*.24)),top=height-pad-(offset+value)/max*innerHeight,bottom=height-pad-offset/max*innerHeight,y=Math.max(pad,top),segmentHeight=Math.max(0,bottom-y)
  return [x,barWidth,y,segmentHeight].every(Number.isFinite)&&segmentHeight>0?{x,y,width:barWidth,height:segmentHeight}:null
}

const outcomeFlowRowSegments=(entry:OutcomeFlowTimelineEntry,row:'cohort'|'next'):readonly [OutcomeFlowSegmentKey,number][]=>{
  if(row==='cohort'&&!entry.cohortFlowAvailable)return[]
  if(row==='next'&&!entry.nextPopulationAvailable)return[]
  if(row==='cohort')return END_CAUSES.flatMap(cause=>{const value=entry.outcomes[cause];return value===null?[]:[[cause,value] as [OutcomeFlowSegmentKey,number]]})
  return entry.survivors===null||entry.birthsAdmitted===null?[]:[['survived',entry.survivors],['births',entry.birthsAdmitted]]
}

const outcomeFlowBarMarkup=(entry:OutcomeFlowTimelineEntry,row:'cohort'|'next',index:number,count:number,max:number,width:number,height:number,pad:number)=>{
  let offset=0
  return outcomeFlowRowSegments(entry,row).flatMap(([key,value])=>{
    const rect=outcomeFlowBarRect(value,offset,index,count,max,width,height,pad)
    offset+=value
    return rect?[<rect key={`${entry.generation}-${row}-${index}-${key}`} className="outcome-flow-segment" x={rect.x} y={rect.y} width={rect.width} height={rect.height} style={{fill:`url(#${outcomeFlowPatternId(key,row)})`}} stroke="var(--paper)" strokeWidth=".7" aria-hidden="true"/>]:[]
  })
}

const outcomeFlowSvgDescription=(entry:OutcomeFlowTimelineEntry,row:'cohort'|'next')=>{
  if(row==='cohort'){
    if(!entry.cohortFlowAvailable)return`outcome stack unavailable for malformed or partial record`
    const outcomes=END_CAUSES.map(cause=>`${entry.outcomes[cause]} ${cause==='survived'?'survived':OUTCOME_FLOW_LOSS_LABELS[cause]}`).join(', ')
    return`${entry.evaluated} evaluated; ${outcomes}`
  }
  return entry.nextPopulationAvailable?`${outcomeFlowCountPhrase(entry.survivors!,'survivor','survivors')} carried forward and ${outcomeFlowCountPhrase(entry.birthsAdmitted!,'admitted birth','admitted births')}; exact next population ${entry.exactNextPopulation}`:`next-population stack unavailable for malformed or partial record`
}

function OutcomeFlowHistory({ledgers,requestedGeneration}:{ledgers:unknown;requestedGeneration:number|null}){
  const entries=buildOutcomeFlowTimeline(ledgers),selectedGeneration=resolveOutcomeFlowGeneration(entries,requestedGeneration),selectedIndex=entries.length?Math.max(0,entries.findIndex(entry=>entry.generation===selectedGeneration)):0,cohortScrollRef=useRef<HTMLDivElement>(null),nextScrollRef=useRef<HTMLDivElement>(null),flowChartRef=useRef<SVGSVGElement>(null)
  useEffect(()=>{
    if(!entries.length)return
    const scrollHost=cohortScrollRef.current,nextScrollHost=nextScrollRef.current,chart=flowChartRef.current
    if(!scrollHost||!nextScrollHost||!chart)return
    let disposed=false,frame:number|null=null
    const recenter=()=>{
      if(disposed)return
      const hostRect=scrollHost.getBoundingClientRect(),chartRect=chart.getBoundingClientRect(),plotWidth=chartRect.width,viewportWidth=scrollHost.clientWidth||hostRect.width,nextViewportWidth=nextScrollHost.clientWidth||viewportWidth
      if(!Number.isFinite(plotWidth)||plotWidth<320||!Number.isFinite(viewportWidth)||viewportWidth<=0||!Number.isFinite(nextViewportWidth)||nextViewportWidth<=0)return
      const maxScroll=Math.min(Math.max(0,scrollHost.scrollWidth-viewportWidth),Math.max(0,nextScrollHost.scrollWidth-nextViewportWidth)),scaledPad=plotWidth*(pad/w),target=outcomeFlowScrollLeft(selectedIndex,entries.length,plotWidth,viewportWidth,scrollHost.scrollLeft,chartRect.left-hostRect.left,scrollHost.scrollWidth,scaledPad),nextScroll=target===null?null:Math.max(0,Math.min(maxScroll,target))
      if(nextScroll!==null&&Number.isFinite(nextScroll)){
        scrollHost.scrollLeft=nextScroll
        nextScrollHost.scrollLeft=nextScroll
      }
    }
    const scheduleRecenter=()=>{
      if(disposed)return
      if(typeof requestAnimationFrame==='function'){
        if(frame!==null)return
        frame=requestAnimationFrame(()=>{frame=null;recenter()})
      }else recenter()
    }
    scheduleRecenter()
    const ResizeObserverCtor=typeof ResizeObserver==='function'?ResizeObserver:null
    let observer:ResizeObserver|null=null
    if(ResizeObserverCtor){
      try{
        observer=new ResizeObserverCtor(scheduleRecenter)
        observer.observe(scrollHost)
        observer.observe(nextScrollHost)
        observer.observe(chart)
      }catch{
        observer?.disconnect()
        observer=null
      }
    }
    if(!observer&&typeof window!=='undefined'){
      window.addEventListener('resize',scheduleRecenter)
      window.addEventListener('orientationchange',scheduleRecenter)
    }
    return()=>{
      disposed=true
      observer?.disconnect()
      if(frame!==null&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(frame)
      frame=null
      if(!observer&&typeof window!=='undefined'){
        window.removeEventListener('resize',scheduleRecenter)
        window.removeEventListener('orientationchange',scheduleRecenter)
      }
    }
  },[entries.length,selectedIndex])
  if(!entries.length)return <p className="journal-warning" role="status">Outcome flow unavailable: no valid retained generation records.</p>
  const selectedEntry=entries[selectedIndex],w=320,h=42,pad=3,flowValues=entries.flatMap(entry=>[entry.evaluated,entry.exactNextPopulation].filter((value):value is number=>value!==null)),flowMax=Math.max(1,...flowValues),selectedX=outcomeFlowSlotCenter(selectedIndex,entries.length,w,pad)??w/2,summaryLines=buildOutcomeFlowSummaryLines(selectedEntry),legendStyle={display:'flex',flexWrap:'wrap',gap:'4px 10px',alignItems:'center',lineHeight:1.4} as const,summaryStyle={display:'grid',gap:2,lineHeight:1.45} as const
  const renderRow=(row:'cohort'|'next',label:string)=>{
    const description=outcomeFlowSvgDescription(selectedEntry,row)
    return <div className="history-facet" key={row}>
      <div className="facet-label"><strong>{label}</strong><span>Gen {selectedEntry.generation} · {row==='cohort'?(selectedEntry.cohortFlowAvailable?`${selectedEntry.evaluated} evaluated`:'Unavailable'):(selectedEntry.nextPopulationAvailable?`${selectedEntry.exactNextPopulation} next`:'Unavailable')}</span></div>
      <div ref={row==='cohort'?cohortScrollRef:nextScrollRef} className="outcome-flow-scroll" data-outcome-flow-scroll="true" style={{overflowX:'auto',width:'100%'}} onScroll={event=>{const target=row==='cohort'?nextScrollRef.current:cohortScrollRef.current;if(target&&target.scrollLeft!==event.currentTarget.scrollLeft)target.scrollLeft=event.currentTarget.scrollLeft}}><div className="outcome-flow-plot" data-outcome-flow-plot="true" style={{minWidth:320,width:'100%'}}><svg ref={row==='cohort'?flowChartRef:undefined} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label}, selected generation ${selectedEntry.generation}, ${description}, shared count scale 0 to ${flowMax}.`}>
        {outcomeFlowPatternDefinitions(row)}<path className="facet-grid" d={`M ${pad} ${h-pad} H ${w-pad}`}/><line className="history-cursor" x1={selectedX} x2={selectedX} y1={pad} y2={h-pad}/>
        {entries.flatMap((entry,index)=>outcomeFlowBarMarkup(entry,row,index,entries.length,flowMax,w,h,pad))}
      </svg></div></div><small>0–{flowMax}</small>
    </div>
  }
  return <div className="history-facets outcome-flow-facets" role="group" aria-label={`Population outcome flow from generation ${entries[0].generation} to ${entries.at(-1)!.generation}. Selected generation ${selectedEntry.generation}. Cohort fates are evaluated survivors and losses; next population is survivors carried forward plus admitted births. Counts are descriptive, not causal.`}>
    <p className="journal-kicker">Outcome flow · shared scale 0–{flowMax}. The cohort row ends with the evaluated population; the next row starts with survivors and admitted births. Capped births stay in the summary and table because they are not part of the next population.</p>
    <p className="journal-equation" style={summaryStyle}><strong>Generation {summaryLines.generation}.</strong><span>{summaryLines.cohort}</span><span>{summaryLines.next}</span><span>{summaryLines.cap}</span>{summaryLines.known&&<span>{summaryLines.known}</span>}<span>{summaryLines.note}</span></p>
    <div className="journal-kicker" role="group" aria-label="Outcome flow legend" style={legendStyle}>
      <strong style={{color:'var(--ink)'}}>Legend:</strong>{OUTCOME_FLOW_LEGEND.filter(item=>item.key!=='capped').map(item=><span key={item.key} style={{display:'inline-flex',alignItems:'center',gap:3}}><span aria-hidden="true" style={{display:'inline-block',width:10,height:10,flex:'0 0 auto',backgroundColor:item.color,backgroundImage:OUTCOME_FLOW_SWATCH_PATTERNS[item.pattern],border:'1px solid var(--line)',borderRadius:2}}/>{item.label}</span>)}
    </div>
    {renderRow('cohort','Cohort fates')}{renderRow('next','Next population')}
    <details className="journal-events utility-breakdown" style={{fontSize:10}}>
      <summary style={{display:'flex',alignItems:'center',minHeight:44,padding:'8px 10px',cursor:'pointer',gap:6}}>Exact outcome table · {entries.length} retained {entries.length===1?'row':'rows'}</summary>
      <div style={{overflowX:'auto'}}>
        <table><caption>Exact retained outcome flow by generation. Unavailable fields are malformed or partial observations.</caption><thead><tr><th scope="col">Generation</th><th scope="col">Recorded start</th><th scope="col">Reconciled evaluated</th>{END_CAUSES.map(cause=><th key={cause} scope="col">{cause==='survived'?'Survived':OUTCOME_FLOW_LEGEND.find(item=>item.key===cause)!.label}</th>)}<th scope="col">Eligible parents</th><th scope="col">Admitted births</th><th scope="col">Capped births</th><th scope="col">Birth-cap status</th><th scope="col">Exact next population</th></tr></thead><tbody>{entries.map((entry,index)=><tr key={`${entry.generation}-${index}`}><th scope="row">{entry.generation}</th><td>{outcomeFlowCountText(entry.startPopulation)}</td><td>{outcomeFlowCountText(entry.evaluated)}</td>{END_CAUSES.map(cause=><td key={cause}>{outcomeFlowCountText(entry.outcomes[cause])}</td>)}<td>{outcomeFlowCountText(entry.birthsEligible)}</td><td>{outcomeFlowCountText(entry.birthsAdmitted)}</td><td>{outcomeFlowCountText(entry.birthsCapped)}</td><td>{entry.birthCapState==='available'?'Available':'Unavailable'}</td><td>{outcomeFlowCountText(entry.exactNextPopulation)}</td></tr>)}</tbody></table>
      </div>
    </details>
  </div>
}

export function HistoryChart({world,requestedGeneration,onSelectGeneration}:HistoryChartProps){
  const entries=buildHistoryTimeline(world.ledger,world.history,world.events),selectedGeneration=resolveTimelineGeneration(entries,requestedGeneration),selectedIndex=Math.max(0,entries.findIndex(entry=>entry.generation===selectedGeneration)),shockNavigator=buildRetainedShockNavigator(entries,world.events),shockNotice=formatRetainedShockNavigatorNotice(shockNavigator),w=320,h=34,pad=3
  if(!entries.length)return <div className="chart-empty">Complete one generation to begin the timeline.</div>
  const populations=entries.map(entry=>safeNonnegativeHistoryValue(entry.nextPopulation)).filter((value):value is number=>value!==null),popMax=Math.max(1,...populations),energyDomain=buildObservedNonnegativeDomain(entries.map(entry=>entry.nextMeanEnergy)),ageDomain=buildObservedNonnegativeDomain(entries.map(entry=>entry.nextMeanAge))
  type HistoryFacetKind='population'|'trait'|'observed-mean'
  const series:{label:string;short:string;kind:HistoryFacetKind;metric?:'energy'|'age';values:(number|null)[];sdValues?:(number|null)[];min:number;max:number;decimals:number;className:string}[]=[
    {label:'Next population',short:'creatures',kind:'population',values:entries.map(entry=>safeNonnegativeHistoryValue(entry.nextPopulation)),min:0,max:popMax,decimals:0,className:'population-line'},
    {label:'Speed',short:'mean',kind:'trait',values:entries.map(entry=>safeFiniteHistoryValue(entry.point?.avgSpeed)),sdValues:entries.map(entry=>safeFiniteHistoryValue(entry.point?.sdSpeed)),min:.3,max:2.8,decimals:2,className:'speed-line'},
    {label:'Size',short:'mean',kind:'trait',values:entries.map(entry=>safeFiniteHistoryValue(entry.point?.avgSize)),sdValues:entries.map(entry=>safeFiniteHistoryValue(entry.point?.sdSize)),min:.3,max:2.8,decimals:2,className:'size-line'},
    {label:'Sense',short:'mean',kind:'trait',values:entries.map(entry=>safeFiniteHistoryValue(entry.point?.avgSense)),sdValues:entries.map(entry=>safeFiniteHistoryValue(entry.point?.sdSense)),min:.035,max:.6,decimals:2,className:'sense-line'},
    {label:'Mean energy',short:'mean in next population',kind:'observed-mean',metric:'energy',values:entries.map(entry=>safeNonnegativeHistoryValue(entry.nextMeanEnergy)),min:energyDomain.min,max:energyDomain.max,decimals:2,className:'speed-line'},
    {label:'Mean age',short:'mean in next population',kind:'observed-mean',metric:'age',values:entries.map(entry=>safeNonnegativeHistoryValue(entry.nextMeanAge)),min:ageDomain.min,max:ageDomain.max,decimals:2,className:'size-line'},
  ]
  const path=(vals:(number|null)[],min:number,max:number)=>{let drawing=false;return vals.map((value,index)=>{const point=historyCoordinate(value,min,max,index,vals.length,w,h,pad);if(!point){drawing=false;return ''}const command=drawing?'L':'M';drawing=true;return`${command} ${point.x} ${point.y}`}).join(' ')}
  const start=entries[0].generation,end=entries.at(-1)!.generation,selectedX=historyCoordinate(0,0,1,selectedIndex,entries.length,w,h,pad)!.x,selectedEntry=entries[selectedIndex]
  return <><div className="history-scrubber journal-controls" aria-label="History generation selector">
    <label className="metric-select" htmlFor="history-generation">Inspect generation <input id="history-generation" type="range" min={0} max={Math.max(0,entries.length-1)} step={1} value={selectedIndex} disabled={entries.length<2} aria-valuetext={formatTimelineSummary(selectedEntry)} onChange={event=>{const entry=entries[Number(event.target.value)];if(entry)onSelectGeneration(entry.generation)}}/></label>
    <output className="journal-equation">{formatTimelineSummary(selectedEntry)} · {requestedGeneration===null?'Following latest completed generation':`Pinned to generation ${selectedEntry.generation}`}</output>
    <button type="button" className="settings-toggle journal-pin" aria-label={`Open journal review for generation ${selectedEntry.generation}`} onClick={()=>openGenerationJournalReview()}>Open journal review</button>
  </div>{shockNotice&&<div className="journal-events"><p className={shockNavigator.groups.length?'journal-kicker':'journal-warning'}>{shockNotice}</p>{shockNavigator.groups.length>0&&<div className="history-scrubber journal-controls" role="group" aria-label="Retained shocks by generation">{shockNavigator.groups.map(group=>{const selected=group.generation===selectedGeneration;return <button key={group.generation} type="button" className="settings-toggle journal-latest" aria-label={group.ariaLabel} aria-current={selected?'true':undefined} aria-pressed={selected} onClick={()=>onSelectGeneration(group.generation)}>{group.label}{group.partial?' · partial':''}</button>})}</div>}</div>}<OutcomeFlowHistory ledgers={world.ledger} requestedGeneration={selectedGeneration}/><div className="history-facets" role="group" aria-label={`Evolution history from generation ${start} to ${end}. Selected generation ${selectedEntry.generation}. Each row uses its own labeled scale. Population is a count; energy and age are observed means in each next population, descriptive, not causal.`}>
    <p className="journal-kicker">Energy and age are observed means in each next population; descriptive, not causal.</p>
    {series.map(s=>{
      const current=s.values[selectedIndex]??null,sd=s.sdValues?.[selectedIndex]??null,currentLabel=current===null?'Unavailable':s.kind==='population'?`${current.toFixed(s.decimals)} creatures`:s.kind==='observed-mean'?`${current.toFixed(s.decimals)} mean`:`${current.toFixed(s.decimals)} ${s.short}${sd===null?'':` · ±1 SD ${sd.toFixed(s.decimals)}`}`,lower=s.sdValues?.map((spread,index)=>spread===null||s.values[index]===null?null:Math.max(s.min,s.values[index]!-spread)),upper=s.sdValues?.map((spread,index)=>spread===null||s.values[index]===null?null:Math.min(s.max,s.values[index]!+spread)),marker=historyCoordinate(current,s.min,s.max,selectedIndex,entries.length,w,h,pad),ariaValue=current===null?s.kind==='observed-mean'?'observed mean unavailable in the next population':'Unavailable':s.kind==='population'?`${current.toFixed(s.decimals)} creatures`:s.kind==='observed-mean'?`observed mean ${current.toFixed(s.decimals)} in the next population`:`mean ${current.toFixed(s.decimals)}${sd===null?'':`, standard deviation ${sd.toFixed(s.decimals)}`}`,svg=chartSvgSemantics('history',s.label),svgTitle=`${s.label} history`,svgDescription=`${s.label} values across retained generations ${start} through ${end}, from earlier generations on the left to later generations on the right. Selected generation ${selectedEntry.generation}: ${ariaValue}.`
      return <div className="history-facet" key={s.label}>
        <div className="facet-label"><strong>{s.label}</strong><span>Gen {selectedEntry.generation} · {currentLabel}</span></div>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-labelledby={svg.titleId} aria-describedby={svg.descriptionId}>
          <title id={svg.titleId}>{svgTitle}</title><desc id={svg.descriptionId}>{svgDescription}</desc><path className="facet-grid" d={`M ${pad} ${h-pad} H ${w-pad}`}/><line className="history-cursor" x1={selectedX} x2={selectedX} y1={pad} y2={h-pad}/>
          {lower&&<path className="spread-line" d={path(lower,s.min,s.max)}/>} {upper&&<path className="spread-line" d={path(upper,s.min,s.max)}/>} <path className={s.className} d={path(s.values,s.min,s.max)}/>{marker&&<circle className="history-point" cx={marker.x} cy={marker.y} r="3"/>}
        </svg><small>{s.min.toFixed(s.decimals)}–{s.max.toFixed(s.decimals)}</small>
      </div>
    })}
  </div><div className="history-facet generation-ruler-row" style={{height:'auto',minHeight:42,alignItems:'start',borderTop:0}}><span aria-hidden="true"/><GenerationRuler entries={entries} selectedGeneration={selectedGeneration}/><span aria-hidden="true"/></div><table className="sr-only"><caption>Generational history data: population counts and observed means in each next population</caption><thead><tr><th scope="col">Generation</th><th scope="col">Next population</th><th scope="col">Speed mean</th><th scope="col">Speed SD</th><th scope="col">Size mean</th><th scope="col">Size SD</th><th scope="col">Sense mean</th><th scope="col">Sense SD</th><th scope="col">Mean energy in next population</th><th scope="col">Mean age in next population</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.generation}><th scope="row">{entry.generation}</th><td>{safeNonnegativeHistoryValue(entry.nextPopulation)??'Unavailable'}</td><td>{safeFiniteHistoryValue(entry.point?.avgSpeed)??'Unavailable'}</td><td>{safeFiniteHistoryValue(entry.point?.sdSpeed)??'Unavailable'}</td><td>{safeFiniteHistoryValue(entry.point?.avgSize)??'Unavailable'}</td><td>{safeFiniteHistoryValue(entry.point?.sdSize)??'Unavailable'}</td><td>{safeFiniteHistoryValue(entry.point?.avgSense)??'Unavailable'}</td><td>{safeFiniteHistoryValue(entry.point?.sdSense)??'Unavailable'}</td><td>{safeNonnegativeHistoryValue(entry.nextMeanEnergy)??'Unavailable'}</td><td>{safeNonnegativeHistoryValue(entry.nextMeanAge)??'Unavailable'}</td></tr>)}</tbody></table></>
}

export function BehaviorHistory({world,requestedGeneration}:{world:World;requestedGeneration:number|null}){
  const entries=buildHistoryTimeline(world.ledger,world.history,world.events),selectedGeneration=resolveTimelineGeneration(entries,requestedGeneration),selectedIndex=Math.max(0,entries.findIndex(entry=>entry.generation===selectedGeneration)),w=320,h=34,pad=3
  if(!entries.length)return <div className="chart-empty behavior-empty">Complete one generation to begin the behavior timeline.</div>
  const series=[
    {label:'Aggression',values:entries.map(entry=>safeFiniteHistoryValue(entry.point?.avgAggression)),sdValues:entries.map(entry=>safeFiniteHistoryValue(entry.point?.sdAggression)),className:'aggression-line'},
    {label:'Caution',values:entries.map(entry=>safeFiniteHistoryValue(entry.point?.avgCaution)),sdValues:entries.map(entry=>safeFiniteHistoryValue(entry.point?.sdCaution)),className:'caution-line'},
    {label:'Exploration',values:entries.map(entry=>safeFiniteHistoryValue(entry.point?.avgExploration)),sdValues:entries.map(entry=>safeFiniteHistoryValue(entry.point?.sdExploration)),className:'exploration-line'},
  ]
  const path=(values:(number|null)[])=>{let drawing=false;return values.map((value,index)=>{const point=historyCoordinate(value,0,1,index,values.length,w,h,pad);if(!point){drawing=false;return ''}const command=drawing?'L':'M';drawing=true;return`${command} ${point.x} ${point.y}`}).join(' ')}
  const start=entries[0].generation,end=entries.at(-1)!.generation,selectedX=historyCoordinate(0,0,1,selectedIndex,entries.length,w,h,pad)!.x,selectedEntry=entries[selectedIndex]
  return <><p className="journal-kicker" style={{fontSize:11,margin:'4px 0 2px'}}>Generation · Earlier generations → later generations. Each ruler follows its plot's time axis.</p><div className="history-facets behavior-facets" role="group" aria-label={`${BEHAVIOR_HISTORY_CONTEXT} History from generation ${start} to ${end}. Selected generation ${selectedEntry.generation}. Aggression, caution, and exploration are each shown on a zero to one scale.`}>
    {series.map(s=>{const current=s.values[selectedIndex]??null,sd=s.sdValues[selectedIndex]??null,lower=s.values.map((value,index)=>value===null||s.sdValues[index]===null?null:Math.max(0,value-s.sdValues[index]!)),upper=s.values.map((value,index)=>value===null||s.sdValues[index]===null?null:Math.min(1,value+s.sdValues[index]!)),marker=historyCoordinate(current,0,1,selectedIndex,entries.length,w,h,pad),svg=chartSvgSemantics('behavior',s.className),svgTitle=`${s.label} behavior history`,svgDescription=`${s.label} mean values across retained generations ${start} through ${end}, from earlier generations on the left to later generations on the right. Selected generation ${selectedEntry.generation}: ${current===null?'unavailable':`mean ${current.toFixed(2)}, standard deviation ${sd?.toFixed(2)??'unavailable'}`}.`;return <div className="history-facet" key={s.label} style={{height:'auto',minHeight:68,alignItems:'start'}}>
      <div className="facet-label"><strong>{s.label}</strong><span>Gen {selectedEntry.generation} · {current===null?'Unavailable':`${current.toFixed(2)} mean · ±1 SD ${sd?.toFixed(2)??'unavailable'}`}</span></div>
      <div style={{display:'grid',gap:0,minWidth:0,width:'100%',alignContent:'start'}}><svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-labelledby={svg.titleId} aria-describedby={svg.descriptionId}><title id={svg.titleId}>{svgTitle}</title><desc id={svg.descriptionId}>{svgDescription}</desc><path className="facet-grid" d={`M ${pad} ${h-pad} H ${w-pad}`}/><line className="history-cursor" x1={selectedX} x2={selectedX} y1={pad} y2={h-pad}/><path className="spread-line" d={path(lower)}/><path className="spread-line" d={path(upper)}/><path className={s.className} d={path(s.values)}/>{marker&&<circle className="history-point" cx={marker.x} cy={marker.y} r="3"/>}</svg><GenerationRuler entries={entries} selectedGeneration={selectedGeneration} compact/></div><small>0.00–1.00</small>
    </div>})}
  </div><table className="sr-only"><caption>Behavior trait means for next populations</caption><thead><tr><th scope="col">Generation</th><th scope="col">Aggression mean</th><th scope="col">Aggression SD</th><th scope="col">Caution mean</th><th scope="col">Caution SD</th><th scope="col">Exploration mean</th><th scope="col">Exploration SD</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.generation}><th scope="row">{entry.generation}</th><td>{safeFiniteHistoryValue(entry.point?.avgAggression)??'Unavailable'}</td><td>{safeFiniteHistoryValue(entry.point?.sdAggression)??'Unavailable'}</td><td>{safeFiniteHistoryValue(entry.point?.avgCaution)??'Unavailable'}</td><td>{safeFiniteHistoryValue(entry.point?.sdCaution)??'Unavailable'}</td><td>{safeFiniteHistoryValue(entry.point?.avgExploration)??'Unavailable'}</td><td>{safeFiniteHistoryValue(entry.point?.sdExploration)??'Unavailable'}</td></tr>)}</tbody></table></>
}
