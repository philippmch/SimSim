import { END_CAUSES } from '../simulation/types'
import type { BiologicalTrait,EndCause,GenerationLedger,HistoryPoint,World,WorldEvent } from '../simulation/types'
import { speedColor } from './ArenaCanvas'

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

const timelineOutcomes=(ledger:GenerationLedger):Record<EndCause,number>=>Object.fromEntries(END_CAUSES.map(cause=>[cause,ledger.outcomes[cause]??0])) as Record<EndCause,number>

/** Join retained generation ledgers to history by generation, not by array position. */
export function buildHistoryTimeline(ledgers:readonly GenerationLedger[],history:readonly HistoryPoint[],events:readonly WorldEvent[],limit=MAX_TIMELINE_ENTRIES):HistoryTimelineEntry[]{
  const bounded=Math.max(0,Math.floor(limit)),recent=bounded?ledgers.slice(-bounded):[]
  return recent.map(ledger=>{
    const point=history.find(candidate=>candidate.generation===ledger.generation)??null
    return{generation:ledger.generation,point,nextPopulation:point?.population??null,nextMeanEnergy:point?.avgEnergy??null,nextMeanAge:point?.avgAge??null,births:ledger.birthsAdmitted,outcomes:timelineOutcomes(ledger),retainedEvents:events.filter(event=>event.generation===ledger.generation).length}
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

const TIMELINE_OUTCOME_LABELS:Record<EndCause,string>={survived:'survived',hunted:'hunted',energy:'energy depleted',unfed:'returned unfed',late:'returned late',aged:'old age'}
const timelineValue=(value:number|null)=>value===null||!Number.isFinite(value)?'unavailable':Number.isInteger(value)?String(value):value.toFixed(2).replace(/\.?0+$/,'')

/** Concise text shared by the visible timeline summary and its range's aria-valuetext. */
export function formatTimelineSummary(entry:HistoryTimelineEntry){
  const outcomes=END_CAUSES.filter(cause=>entry.outcomes[cause]>0).map(cause=>`${entry.outcomes[cause]} ${TIMELINE_OUTCOME_LABELS[cause]}`).join(', ')
  const events=entry.retainedEvents>0?`; ${entry.retainedEvents} retained ${entry.retainedEvents===1?'event':'events'}`:''
  return`Generation ${entry.generation}: next population ${timelineValue(entry.nextPopulation)}, mean energy ${timelineValue(entry.nextMeanEnergy)}, mean age ${timelineValue(entry.nextMeanAge)}, ${entry.births} births${outcomes?`; outcomes ${outcomes}`:''}${events}`
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

export function Histogram({world,trait='speed'}:{world:World;trait?:BiologicalTrait}){
  const values=world.creatures.filter(c=>c.alive).map(c=>c[trait]), bins=trait==='speed'?buildSpeedHistogram(values):buildHistogram(values,traitDomains[trait])
  const peak=Math.max(1,...bins.map(bin=>bin.count))
  const low=values.length?Math.min(...values).toFixed(2):'0.00', high=values.length?Math.max(...values).toFixed(2):'0.00'
  return <><div className="histogram" role="img" aria-label={`${trait} distribution for ${values.length} living creatures, ranging from ${low} to ${high}.`}>
    {bins.map((bin,i)=><span key={i} style={{height:`${Math.max(bin.count?5:1,bin.count/peak*100)}%`,background:traitColor(trait,(bin.lower+bin.upper)/2)}} title={`${bin.lower.toFixed(2)}–${bin.upper.toFixed(2)}: ${bin.count}`} />)}
    <i className="axis-label left">low</i><i className="axis-label right">high</i>
  </div><table className="sr-only"><caption>{trait} distribution data</caption><thead><tr><th>Range</th><th>Creatures</th></tr></thead><tbody>{bins.map((bin,i)=><tr key={i}><td>{bin.lower.toFixed(2)} to {bin.upper.toFixed(2)}</td><td>{bin.count}</td></tr>)}</tbody></table></>
}

export interface HistoryChartProps {
  world:World
  requestedGeneration:number|null
  onSelectGeneration:(generation:number)=>void
}

export function HistoryChart({world,requestedGeneration,onSelectGeneration}:HistoryChartProps){
  const entries=buildHistoryTimeline(world.ledger,world.history,world.events),selectedGeneration=resolveTimelineGeneration(entries,requestedGeneration),selectedIndex=Math.max(0,entries.findIndex(entry=>entry.generation===selectedGeneration)),w=320,h=34,pad=3
  if(!entries.length)return <div className="chart-empty">Complete one generation to begin the timeline.</div>
  const populations=entries.map(entry=>entry.nextPopulation).filter((value):value is number=>value!==null&&Number.isFinite(value)),popMax=Math.max(1,...populations)
  const series:{label:string;short:string;values:(number|null)[];sdValues?:(number|null)[];min:number;max:number;decimals:number;className:string}[]=[
    {label:'Population',short:'creatures',values:entries.map(entry=>entry.nextPopulation),min:0,max:popMax,decimals:0,className:'population-line'},
    {label:'Speed',short:'mean',values:entries.map(entry=>entry.point?.avgSpeed??null),sdValues:entries.map(entry=>entry.point?.sdSpeed??null),min:.3,max:2.8,decimals:2,className:'speed-line'},
    {label:'Size',short:'mean',values:entries.map(entry=>entry.point?.avgSize??null),sdValues:entries.map(entry=>entry.point?.sdSize??null),min:.3,max:2.8,decimals:2,className:'size-line'},
    {label:'Sense',short:'mean',values:entries.map(entry=>entry.point?.avgSense??null),sdValues:entries.map(entry=>entry.point?.sdSense??null),min:.035,max:.6,decimals:2,className:'sense-line'},
  ]
  const path=(vals:(number|null)[],min:number,max:number)=>{let drawing=false;return vals.map((value,index)=>{const point=historyCoordinate(value,min,max,index,vals.length,w,h,pad);if(!point){drawing=false;return ''}const command=drawing?'L':'M';drawing=true;return`${command} ${point.x} ${point.y}`}).join(' ')}
  const start=entries[0].generation,end=entries.at(-1)!.generation,selectedX=historyCoordinate(0,0,1,selectedIndex,entries.length,w,h,pad)!.x,selectedEntry=entries[selectedIndex]
  return <><div className="history-scrubber journal-controls" aria-label="History generation selector">
    <label className="metric-select" htmlFor="history-generation">Inspect generation <input id="history-generation" type="range" min={0} max={Math.max(0,entries.length-1)} step={1} value={selectedIndex} disabled={entries.length<2} aria-valuetext={formatTimelineSummary(selectedEntry)} onChange={event=>{const entry=entries[Number(event.target.value)];if(entry)onSelectGeneration(entry.generation)}}/></label>
    <output className="journal-equation">{formatTimelineSummary(selectedEntry)} · {requestedGeneration===null?'Following latest completed generation':`Pinned to generation ${selectedEntry.generation}`}</output>
  </div><div className="history-facets" role="group" aria-label={`Evolution history from generation ${start} to ${end}. Selected generation ${selectedEntry.generation}. Each row uses its own labeled scale.`}>
    {series.map(s=>{
      const current=s.values[selectedIndex]??null,sd=s.sdValues?.[selectedIndex]??null,currentLabel=current===null?'Unavailable':`${current.toFixed(s.decimals)} ${s.short}${sd===null?'':` · ±1 SD ${sd.toFixed(s.decimals)}`}`,lower=s.sdValues?.map((spread,index)=>spread===null||s.values[index]===null?null:Math.max(s.min,s.values[index]!-spread)),upper=s.sdValues?.map((spread,index)=>spread===null||s.values[index]===null?null:Math.min(s.max,s.values[index]!+spread)),marker=historyCoordinate(current,s.min,s.max,selectedIndex,entries.length,w,h,pad)
      return <div className="history-facet" key={s.label}>
        <div className="facet-label"><strong>{s.label}</strong><span>Gen {selectedEntry.generation} · {currentLabel}</span></div>
        <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${s.label}, selected generation ${selectedEntry.generation}, ${current===null?'unavailable':`mean ${current.toFixed(s.decimals)}${sd===null?'':`, standard deviation ${sd.toFixed(s.decimals)}`}`}, shown from ${s.min.toFixed(s.decimals)} to ${s.max.toFixed(s.decimals)}.`}>
          <path className="facet-grid" d={`M ${pad} ${h-pad} H ${w-pad}`}/><line className="history-cursor" x1={selectedX} x2={selectedX} y1={pad} y2={h-pad}/>
          {lower&&<path className="spread-line" d={path(lower,s.min,s.max)}/>} {upper&&<path className="spread-line" d={path(upper,s.min,s.max)}/>} <path className={s.className} d={path(s.values,s.min,s.max)}/>{marker&&<circle className="history-point" cx={marker.x} cy={marker.y} r="3"/>}
        </svg><small>{s.min.toFixed(s.decimals)}–{s.max.toFixed(s.decimals)}</small>
      </div>
    })}
  </div><table className="sr-only"><caption>Generational trait history data</caption><thead><tr><th>Generation</th><th>Population</th><th>Speed mean</th><th>Speed SD</th><th>Size mean</th><th>Size SD</th><th>Sense mean</th><th>Sense SD</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.generation}><td>{entry.generation}</td><td>{entry.nextPopulation??'Unavailable'}</td><td>{entry.point?.avgSpeed??'Unavailable'}</td><td>{entry.point?.sdSpeed??'Unavailable'}</td><td>{entry.point?.avgSize??'Unavailable'}</td><td>{entry.point?.sdSize??'Unavailable'}</td><td>{entry.point?.avgSense??'Unavailable'}</td><td>{entry.point?.sdSense??'Unavailable'}</td></tr>)}</tbody></table></>
}

export function BehaviorHistory({world,requestedGeneration}:{world:World;requestedGeneration:number|null}){
  const entries=buildHistoryTimeline(world.ledger,world.history,world.events),selectedGeneration=resolveTimelineGeneration(entries,requestedGeneration),selectedIndex=Math.max(0,entries.findIndex(entry=>entry.generation===selectedGeneration)),w=320,h=34,pad=3
  if(!entries.length)return <div className="chart-empty behavior-empty">Complete one generation to begin the behavior timeline.</div>
  const series=[
    {label:'Aggression',values:entries.map(entry=>entry.point?.avgAggression??null),sdValues:entries.map(entry=>entry.point?.sdAggression??null),className:'aggression-line'},
    {label:'Caution',values:entries.map(entry=>entry.point?.avgCaution??null),sdValues:entries.map(entry=>entry.point?.sdCaution??null),className:'caution-line'},
    {label:'Exploration',values:entries.map(entry=>entry.point?.avgExploration??null),sdValues:entries.map(entry=>entry.point?.sdExploration??null),className:'exploration-line'},
  ]
  const path=(values:(number|null)[])=>{let drawing=false;return values.map((value,index)=>{const point=historyCoordinate(value,0,1,index,values.length,w,h,pad);if(!point){drawing=false;return ''}const command=drawing?'L':'M';drawing=true;return`${command} ${point.x} ${point.y}`}).join(' ')}
  const start=entries[0].generation,end=entries.at(-1)!.generation,selectedX=historyCoordinate(0,0,1,selectedIndex,entries.length,w,h,pad)!.x,selectedEntry=entries[selectedIndex]
  return <><div className="history-facets behavior-facets" role="group" aria-label={`${BEHAVIOR_HISTORY_CONTEXT} History from generation ${start} to ${end}. Selected generation ${selectedEntry.generation}. Aggression, caution, and exploration are each shown on a zero to one scale.`}>
    {series.map(s=>{const current=s.values[selectedIndex]??null,sd=s.sdValues[selectedIndex]??null,lower=s.values.map((value,index)=>value===null||s.sdValues[index]===null?null:Math.max(0,value-s.sdValues[index]!)),upper=s.values.map((value,index)=>value===null||s.sdValues[index]===null?null:Math.min(1,value+s.sdValues[index]!)),marker=historyCoordinate(current,0,1,selectedIndex,entries.length,w,h,pad);return <div className="history-facet" key={s.label}>
      <div className="facet-label"><strong>{s.label}</strong><span>Gen {selectedEntry.generation} · {current===null?'Unavailable':`${current.toFixed(2)} mean · ±1 SD ${sd?.toFixed(2)??'unavailable'}`}</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${s.label}, selected generation ${selectedEntry.generation}, ${current===null?'unavailable':`mean ${current.toFixed(2)}, standard deviation ${sd?.toFixed(2)??'unavailable'}`}, scale zero to one.`}><path className="facet-grid" d={`M ${pad} ${h-pad} H ${w-pad}`}/><line className="history-cursor" x1={selectedX} x2={selectedX} y1={pad} y2={h-pad}/><path className="spread-line" d={path(lower)}/><path className="spread-line" d={path(upper)}/><path className={s.className} d={path(s.values)}/>{marker&&<circle className="history-point" cx={marker.x} cy={marker.y} r="3"/>}</svg><small>0.00–1.00</small>
    </div>})}
  </div><table className="sr-only"><caption>Behavior trait means for next populations</caption><thead><tr><th>Generation</th><th>Aggression mean</th><th>Aggression SD</th><th>Caution mean</th><th>Caution SD</th><th>Exploration mean</th><th>Exploration SD</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.generation}><td>{entry.generation}</td><td>{entry.point?.avgAggression??'Unavailable'}</td><td>{entry.point?.sdAggression??'Unavailable'}</td><td>{entry.point?.avgCaution??'Unavailable'}</td><td>{entry.point?.sdCaution??'Unavailable'}</td><td>{entry.point?.avgExploration??'Unavailable'}</td><td>{entry.point?.sdExploration??'Unavailable'}</td></tr>)}</tbody></table></>
}
