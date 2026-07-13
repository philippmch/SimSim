import type { BiologicalTrait,World } from '../simulation/types'
import { speedColor } from './ArenaCanvas'

export const SPEED_HISTOGRAM_DOMAIN = {min:.3,max:2.8} as const
const traitDomains:Record<BiologicalTrait,{min:number;max:number}>={speed:{min:.3,max:2.8},size:{min:.3,max:2.8},sense:{min:.035,max:.6},aggression:{min:0,max:1},caution:{min:0,max:1},exploration:{min:0,max:1}}
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

export function Histogram({world,trait='speed'}:{world:World;trait?:BiologicalTrait}){
  const values=world.creatures.filter(c=>c.alive).map(c=>c[trait]), bins=trait==='speed'?buildSpeedHistogram(values):buildHistogram(values,traitDomains[trait])
  const peak=Math.max(1,...bins.map(bin=>bin.count))
  const low=values.length?Math.min(...values).toFixed(2):'0.00', high=values.length?Math.max(...values).toFixed(2):'0.00'
  return <><div className="histogram" role="img" aria-label={`${trait} distribution for ${values.length} living creatures, ranging from ${low} to ${high}.`}>
    {bins.map((bin,i)=><span key={i} style={{height:`${Math.max(bin.count?5:1,bin.count/peak*100)}%`,background:speedColor((bin.lower+bin.upper)/2)}} title={`${bin.lower.toFixed(2)}–${bin.upper.toFixed(2)}: ${bin.count}`} />)}
    <i className="axis-label left">low</i><i className="axis-label right">high</i>
  </div><table className="sr-only"><caption>{trait} distribution data</caption><thead><tr><th>Range</th><th>Creatures</th></tr></thead><tbody>{bins.map((bin,i)=><tr key={i}><td>{bin.lower.toFixed(2)} to {bin.upper.toFixed(2)}</td><td>{bin.count}</td></tr>)}</tbody></table></>
}

export function HistoryChart({world}:{world:World}){
  const points=world.history.slice(-40)
  if(points.length<2)return <div className="chart-empty">Complete one generation to begin the timeline.</div>
  const popMax=Math.max(1,...points.map(p=>p.population))
  const series:{label:string;short:string;values:(number|null)[];sdValues?:(number|null)[];min:number;max:number;decimals:number;className:string}[]=[
    {label:'Population',short:'creatures',values:points.map(p=>p.population),min:0,max:popMax,decimals:0,className:'population-line'},
    {label:'Speed',short:'mean',values:points.map(p=>p.avgSpeed),sdValues:points.map(p=>p.sdSpeed),min:.3,max:2.8,decimals:2,className:'speed-line'},
    {label:'Size',short:'mean',values:points.map(p=>p.avgSize),sdValues:points.map(p=>p.sdSize),min:.3,max:2.8,decimals:2,className:'size-line'},
    {label:'Sense',short:'mean',values:points.map(p=>p.avgSense),sdValues:points.map(p=>p.sdSense),min:.035,max:.6,decimals:2,className:'sense-line'},
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
  return <><div className="history-facets" role="group" aria-label={`Evolution history from generation ${start} to ${end}. Each row uses its own labeled scale.`}>
    {series.map(s=>{
      const current=s.values.at(-1)??null
      const sd=s.sdValues?.at(-1)??null,currentLabel=current===null?'No population':`${current.toFixed(s.decimals)} ${s.short}${sd===null?'':` · ±1 SD ${sd.toFixed(s.decimals)}`}`
      const lower=s.sdValues?.map((spread,i)=>spread===null||s.values[i]===null?null:Math.max(s.min,s.values[i]!-spread))
      const upper=s.sdValues?.map((spread,i)=>spread===null||s.values[i]===null?null:Math.min(s.max,s.values[i]!+spread))
      return <div className="history-facet" key={s.label}>
        <div className="facet-label"><strong>{s.label}</strong><span>{currentLabel}</span></div>
        <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${s.label}, ${current===null?'unavailable because the population is empty':`currently mean ${current.toFixed(s.decimals)}${sd===null?'':`, standard deviation ${sd.toFixed(s.decimals)}`}`}, shown from ${s.min.toFixed(s.decimals)} to ${s.max.toFixed(s.decimals)}.`}>
          <path className="facet-grid" d={`M ${pad} ${h-pad} H ${w-pad}`}/>
          {lower&&<path className="spread-line" d={path(lower,s.min,s.max)}/>}
          {upper&&<path className="spread-line" d={path(upper,s.min,s.max)}/>}
          <path className={s.className} d={path(s.values,s.min,s.max)}/>
        </svg>
        <small>{s.min.toFixed(s.decimals)}–{s.max.toFixed(s.decimals)}</small>
      </div>
    })}
  </div><table className="sr-only"><caption>Generational trait history data</caption><thead><tr><th>Generation</th><th>Population</th><th>Speed mean</th><th>Speed SD</th><th>Size mean</th><th>Size SD</th><th>Sense mean</th><th>Sense SD</th></tr></thead><tbody>{points.map(p=><tr key={p.generation}><td>{p.generation}</td><td>{p.population}</td><td>{p.avgSpeed??'Unavailable'}</td><td>{p.sdSpeed??'Unavailable'}</td><td>{p.avgSize??'Unavailable'}</td><td>{p.sdSize??'Unavailable'}</td><td>{p.avgSense??'Unavailable'}</td><td>{p.sdSense??'Unavailable'}</td></tr>)}</tbody></table></>
}

export function BehaviorHistory({world}:{world:World}){
  const points=world.history.slice(-40)
  if(points.length<2)return <div className="chart-empty behavior-empty">Complete one generation to begin the behavior timeline.</div>
  const series=[
    {label:'Aggression',values:points.map(p=>p.avgAggression),sdValues:points.map(p=>p.sdAggression),className:'aggression-line'},
    {label:'Caution',values:points.map(p=>p.avgCaution),sdValues:points.map(p=>p.sdCaution),className:'caution-line'},
    {label:'Exploration',values:points.map(p=>p.avgExploration),sdValues:points.map(p=>p.sdExploration),className:'exploration-line'},
  ]
  const w=320,h=34,pad=3
  const path=(values:(number|null)[])=>{let drawing=false;return values.map((v,i)=>{if(v===null){drawing=false;return ''}const cmd=drawing?'L':'M';drawing=true;return`${cmd} ${pad+i/(values.length-1)*(w-pad*2)} ${h-pad-v*(h-pad*2)}`}).join(' ')}
  return <><div className="history-facets behavior-facets" role="group" aria-label="Behavior gene history. Aggression, caution, and exploration are each shown on a zero to one scale.">
    {series.map(s=>{const current=s.values.at(-1)??null,sd=s.sdValues.at(-1)??null,lower=s.values.map((value,i)=>value===null||s.sdValues[i]===null?null:Math.max(0,value-s.sdValues[i]!)),upper=s.values.map((value,i)=>value===null||s.sdValues[i]===null?null:Math.min(1,value+s.sdValues[i]!));return <div className="history-facet" key={s.label}>
      <div className="facet-label"><strong>{s.label}</strong><span>{current===null?'No population':`${current.toFixed(2)} mean · ±1 SD ${sd?.toFixed(2)}`}</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${s.label}, ${current===null?'unavailable':`currently mean ${current.toFixed(2)}, standard deviation ${sd?.toFixed(2)}`}, scale zero to one.`}><path className="facet-grid" d={`M ${pad} ${h-pad} H ${w-pad}`}/><path className="spread-line" d={path(lower)}/><path className="spread-line" d={path(upper)}/><path className={s.className} d={path(s.values)}/></svg><small>0.00–1.00</small>
    </div>})}
  </div><table className="sr-only"><caption>Behavior gene history data</caption><thead><tr><th>Generation</th><th>Aggression mean</th><th>Aggression SD</th><th>Caution mean</th><th>Caution SD</th><th>Exploration mean</th><th>Exploration SD</th></tr></thead><tbody>{points.map(p=><tr key={p.generation}><td>{p.generation}</td><td>{p.avgAggression??'Unavailable'}</td><td>{p.sdAggression??'Unavailable'}</td><td>{p.avgCaution??'Unavailable'}</td><td>{p.sdCaution??'Unavailable'}</td><td>{p.avgExploration??'Unavailable'}</td><td>{p.sdExploration??'Unavailable'}</td></tr>)}</tbody></table></>
}
