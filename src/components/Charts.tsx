import type { World } from '../simulation/types'
import { speedColor } from './ArenaCanvas'

export const SPEED_HISTOGRAM_DOMAIN = {min:.3,max:2.8} as const

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

export function Histogram({world}:{world:World}){
  const values=world.creatures.filter(c=>c.alive).map(c=>c.speed), bins=buildSpeedHistogram(values)
  const peak=Math.max(1,...bins.map(bin=>bin.count))
  const low=values.length?Math.min(...values).toFixed(2):'0.00', high=values.length?Math.max(...values).toFixed(2):'0.00'
  return <div className="histogram" role="img" aria-label={`Speed distribution for ${values.length} living creatures, ranging from ${low} to ${high}.`}>
    {bins.map((bin,i)=><span key={i} style={{height:`${Math.max(bin.count?5:1,bin.count/peak*100)}%`,background:speedColor((bin.lower+bin.upper)/2)}} title={`${bin.lower.toFixed(2)}–${bin.upper.toFixed(2)}: ${bin.count}`} />)}
    <i className="axis-label left">slow</i><i className="axis-label right">fast</i>
  </div>
}

export function HistoryChart({world}:{world:World}){
  const points=world.history.slice(-40)
  if(points.length<2)return <div className="chart-empty">Complete one generation to begin the timeline.</div>
  const popMax=Math.max(1,...points.map(p=>p.population))
  const series:{label:string;short:string;values:(number|null)[];min:number;max:number;decimals:number;className:string}[]=[
    {label:'Population',short:'creatures',values:points.map(p=>p.population),min:0,max:popMax,decimals:0,className:'population-line'},
    {label:'Speed',short:'average',values:points.map(p=>p.avgSpeed),min:.3,max:2.8,decimals:2,className:'speed-line'},
    {label:'Size',short:'average',values:points.map(p=>p.avgSize),min:.3,max:2.8,decimals:2,className:'size-line'},
    {label:'Sense',short:'average',values:points.map(p=>p.avgSense),min:.035,max:.6,decimals:2,className:'sense-line'},
  ]
  const w=320,h=34,pad=3
  const path=(vals:(number|null)[],min:number,max:number)=>{
    let drawing=false
    return vals.map((v,i)=>{
      if(v===null){drawing=false;return ''}
      const command=drawing?'L':'M';drawing=true
      return `${command} ${pad+i/(vals.length-1)*(w-pad*2)} ${h-pad-(v-min)/(max-min)*(h-pad*2)}`
    }).join(' ')
  }
  const start=points[0].generation,end=points.at(-1)!.generation
  return <div className="history-facets" role="group" aria-label={`Evolution history from generation ${start} to ${end}. Each row uses its own labeled scale.`}>
    {series.map(s=>{
      const current=s.values.at(-1)??null
      const currentLabel=current===null?'No population':`${current.toFixed(s.decimals)} ${s.short}`
      return <div className="history-facet" key={s.label}>
        <div className="facet-label"><strong>{s.label}</strong><span>{currentLabel}</span></div>
        <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${s.label}, ${current===null?'unavailable because the population is empty':`currently ${current.toFixed(s.decimals)}`}, shown from ${s.min.toFixed(s.decimals)} to ${s.max.toFixed(s.decimals)}.`}>
          <path className="facet-grid" d={`M ${pad} ${h-pad} H ${w-pad}`}/>
          <path className={s.className} d={path(s.values,s.min,s.max)}/>
        </svg>
        <small>{s.min.toFixed(s.decimals)}–{s.max.toFixed(s.decimals)}</small>
      </div>
    })}
  </div>
}

export function BehaviorHistory({world}:{world:World}){
  const points=world.history.slice(-40)
  if(points.length<2)return <div className="chart-empty behavior-empty">Complete one generation to begin the behavior timeline.</div>
  const series=[
    {label:'Aggression',values:points.map(p=>p.avgAggression),className:'aggression-line'},
    {label:'Caution',values:points.map(p=>p.avgCaution),className:'caution-line'},
    {label:'Exploration',values:points.map(p=>p.avgExploration),className:'exploration-line'},
  ]
  const w=320,h=34,pad=3
  const path=(values:(number|null)[])=>{let drawing=false;return values.map((v,i)=>{if(v===null){drawing=false;return ''}const cmd=drawing?'L':'M';drawing=true;return`${cmd} ${pad+i/(values.length-1)*(w-pad*2)} ${h-pad-v*(h-pad*2)}`}).join(' ')}
  return <div className="history-facets behavior-facets" role="group" aria-label="Behavior gene history. Aggression, caution, and exploration are each shown on a zero to one scale.">
    {series.map(s=>{const current=s.values.at(-1)??null;return <div className="history-facet" key={s.label}>
      <div className="facet-label"><strong>{s.label}</strong><span>{current===null?'No population':`${current.toFixed(2)} average`}</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${s.label}, ${current===null?'unavailable':`currently ${current.toFixed(2)}`}, scale zero to one.`}><path className="facet-grid" d={`M ${pad} ${h-pad} H ${w-pad}`}/><path className={s.className} d={path(s.values)}/></svg><small>0.00–1.00</small>
    </div>})}
  </div>
}
