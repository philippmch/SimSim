import type { BiologicalTrait, LineageAnalytics, SelectionShift } from '../simulation/types'

export const POPULATION_TRAIT_ORDER:readonly BiologicalTrait[]=['speed','size','sense','aggression','caution','exploration']

const traitLabels:Record<BiologicalTrait,string>={
  speed:'Speed',
  size:'Size',
  sense:'Sense',
  aggression:'Aggression',
  caution:'Caution',
  exploration:'Exploration',
}

/** Compact signed cohort-mean differences; invalid or missing cohorts stay explicit. */
export function formatSelectionDelta(value:number|null|undefined):string{
  if(typeof value!=='number'||!Number.isFinite(value))return'n/a'
  if(Math.abs(value)<.0005)return'0.000'
  return`${value>0?'+':''}${value.toFixed(3)}`
}

export interface SelectionShiftRow{
  trait:BiologicalTrait
  label:string
  survivor:string
  reproducer:string
}

/** Normalize engine telemetry to a stable six-trait order for a readable table. */
export function buildSelectionShiftRows(shifts:readonly SelectionShift[]|null|undefined):SelectionShiftRow[]{
  return POPULATION_TRAIT_ORDER.map(trait=>{
    const shift=shifts?.find(item=>item?.trait===trait)
    return{trait,label:traitLabels[trait],survivor:formatSelectionDelta(shift?.survivor),reproducer:formatSelectionDelta(shift?.reproducer)}
  })
}

export function hasCompletedSelectionGeneration(latestGeneration:number|null|undefined):latestGeneration is number{
  return typeof latestGeneration==='number'&&Number.isInteger(latestGeneration)&&latestGeneration>=1
}

export function formatSelectionShiftContext(latestGeneration:number|null|undefined):string{
  if(!hasCompletedSelectionGeneration(latestGeneration))return'No completed generation yet; selection shifts will appear after the first generation.'
  return`Latest completed generation: ${latestGeneration}. Positive values mean a higher cohort mean; negative values mean a lower cohort mean.`
}

export interface PopulationStoryProps{lineage:LineageAnalytics}

export function PopulationStory({lineage}:PopulationStoryProps){
  const shifts=buildSelectionShiftRows(lineage.selectionShifts)
  const hasCompletedGeneration=hasCompletedSelectionGeneration(lineage.latestGeneration)
  return <div className="evolution-story">
    <div className="story-head"><div><h2 id="evolution-story-title">Current population · lineages</h2><p>Lineages are live now. Shifts below use the latest completed generation, even when the journal above is pinned to an older one.</p></div><dl><div><dt>Living lineages</dt><dd>{Number.isFinite(lineage.livingLineages)?Math.max(0,Math.trunc(lineage.livingLineages)):'n/a'}</dd></div><div><dt>Effective diversity</dt><dd>{Number.isFinite(lineage.effectiveDiversity)?lineage.effectiveDiversity.toFixed(2):'n/a'}</dd></div></dl></div>
    <div className="selection-shifts utility-breakdown" role="group" aria-labelledby="selection-shifts-title">
      <h3 id="selection-shifts-title" style={{fontSize:'12px',margin:'12px 0 4px'}}>Latest selection shifts</h3>
      <p>{formatSelectionShiftContext(lineage.latestGeneration)}</p>
      {hasCompletedGeneration&&<><small style={{display:'block',marginTop:4,color:'var(--muted)'}}>Δ = cohort mean versus the evaluated starting cohort. n/a means a cohort mean was unavailable.</small><table style={{tableLayout:'fixed'}}><caption className="sr-only">Latest completed generation selection shifts versus the evaluated starting cohort</caption><thead><tr><th>Trait</th><th>Survivors Δ</th><th>Parents of newborns Δ</th></tr></thead><tbody>{shifts.map(row=><tr key={row.trait}><th scope="row">{row.label}</th><td>{row.survivor}</td><td>{row.reproducer}</td></tr>)}</tbody></table><small style={{display:'block',marginTop:4,color:'var(--muted)'}}>Positive and negative shifts are descriptive associations, not proof of cause.</small></>}
      {!hasCompletedGeneration&&<p style={{marginTop:4}}>Finish a generation to compare survivor and parent cohort means.</p>}
    </div>
    <div className="story-grid">
      <div><h3>Leading lineages</h3>{lineage.topLineages.length?<ol>{lineage.topLineages.map(item=><li key={item.lineageId}><span>Lineage {item.lineageId}</span><b>{Number.isFinite(item.count)?Math.max(0,Math.trunc(item.count)):'n/a'}</b><small>{Number.isFinite(item.share)?`${Math.round(Math.max(0,item.share)*100)}%`:'n/a'}</small><i style={{width:`${Number.isFinite(item.share)?Math.max(0,Math.min(100,item.share*100)):0}%`}}/></li>)}</ol>:<p>No living lineages.</p>}</div>
      <div><h3>How to read this</h3><p>Each bar is the share of the living population carrying that lineage. Effective diversity is higher when several lineages remain common. Positive shifts mean higher cohort means; negative shifts mean lower cohort means.</p></div>
      <div><h3>Live vs historical</h3><p>Lineages are live now; selection shifts come from the latest completed generation. Open the generation journal above for the full record and context.</p></div>
    </div>
  </div>
}

export default PopulationStory
