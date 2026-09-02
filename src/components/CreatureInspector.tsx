import type { BiologicalTrait, Config, Creature, DecisionCandidateSummary, DecisionProvenance, DecisionSelectionBasis, DecisionSummary, PerceptionDiagnostics, TargetType } from '../simulation/types'
import { FORECAST_LOSS_LABELS, type SelectedSettlementPreview } from './SettlementPreview'

export interface PerceptionTelemetryCopy {
  creatures: string
  food: string
  notDetected: string
}

const decisionBasisLabels:Record<DecisionSelectionBasis,string>={
  'best-utility':'Chosen by highest relative utility',
  commitment:'Chosen by target commitment',
  'urgent-override':'Chosen by urgent safety override',
}
const decisionActionLabels:Record<TargetType,string>={
  food:'Forage for food',
  prey:'Hunt prey',
  threat:'Flee from danger',
  home:'Return home',
  memory:'Follow remembered food',
  explore:'Explore the arena',
}
const decisionLineStyle={display:'block',marginLeft:0} as const
const settlementPreviewStyle={fontSize:11,lineHeight:1.4} as const
const settlementFramingStyle={display:'block',marginTop:3,color:'var(--muted)',fontSize:10,lineHeight:1.35} as const
const formatPreviewNumber=(value:number|null)=>value===null||!Number.isFinite(value)?'unavailable':value.toFixed(1)
const formatPreviewFood=(value:number)=>!Number.isFinite(value)?'unavailable':Number.isInteger(value)?String(value):value.toFixed(1)
const formatPreviewCount=(count:number,singular:string)=>`${count} ${count===1?singular:`${singular}s`}`

export function formatSelectedSettlementOutcome(preview:SelectedSettlementPreview):string{
  if(preview.outcome!=='survived')return`Would not survive · ${FORECAST_LOSS_LABELS[preview.outcome]}.`
  const age=preview.nextAge===null?'next age unavailable':`age ${preview.nextAge}`
  return`Would survive → generation ${preview.generation+1} · ${age} · ${formatPreviewNumber(preview.settledEnergy)} energy.`
}

export function formatSelectedSettlementReproduction(preview:SelectedSettlementPreview):string{
  if(preview.outcome!=='survived')return'It would produce no offspring.'
  if(preview.reproductionStatus==='admitted')return preview.mode==='classic'
    ?`One offspring would be admitted · ${formatPreviewFood(preview.foodAtSettlement)}/2 food collected.`
    :`One offspring would be admitted · ${formatPreviewNumber(preview.retainedEnergy)} retained energy − ${formatPreviewNumber(preview.reproductionCost)} reproduction cost.`
  if(preview.reproductionStatus==='eligible-capacity-blocked')return`Eligible for offspring, but would not be admitted · ${formatPreviewCount(preview.availableBirthSlots,'available birth slot')} for ${formatPreviewCount(preview.eligibleParentCount,'eligible parent')}.`
  return preview.mode==='classic'
    ?`No offspring · ${formatPreviewFood(preview.foodAtSettlement)}/2 food collected (needs at least 2).`
    :`No offspring · ${formatPreviewNumber(preview.retainedEnergy)} retained energy must exceed the ${formatPreviewNumber(preview.reproductionCost)} cost.`
}

/** Keep captured-decision metadata readable even when an old snapshot omits it. */
export function formatDecisionBasis(basis:DecisionSelectionBasis|undefined):string{
  const label=typeof basis==='string'?decisionBasisLabels[basis]:undefined
  return typeof label==='string'?label:'Selection basis unavailable'
}

export function formatDecisionProvenance(provenance:DecisionProvenance|undefined):string{
  if(!provenance||!Number.isInteger(provenance.generation)||provenance.generation<1||!Number.isFinite(provenance.dayTime)||provenance.dayTime<0||!Number.isInteger(provenance.reactionWindow)||provenance.reactionWindow<0)return'Decision capture time unavailable'
  return`Captured decision · Generation ${provenance.generation} · day ${provenance.dayTime.toFixed(2)} · reaction window ${provenance.reactionWindow}`
}

function fallbackDecisionTarget(type:TargetType|undefined):string{
  if(type==='home')return'Home location'
  if(type==='memory')return'Remembered location'
  if(type==='explore')return'Exploration waypoint'
  if(type==='food')return'Food target · current status unavailable'
  if(type==='prey')return'Prey target · current status unavailable'
  if(type==='threat')return'Threat target · current status unavailable'
  return'Decision target unavailable'
}

/** The app resolves creature IDs to stable individual IDs before passing this copy in. */
export function formatDecisionTargetLabel(summary:DecisionSummary|undefined,label?:string):string{
  const clean=typeof label==='string'&&label.trim()?label.trim():''
  return clean||fallbackDecisionTarget(summary?.chosen)
}

/** Translate an internal target type into the action a person would describe. */
export function formatDecisionActionLabel(type:TargetType|undefined):string{
  return type&&decisionActionLabels[type] ? decisionActionLabels[type] : 'Action unavailable'
}

export function formatCandidateUtilitySummary(count:number):string{
  const safeCount=Number.isFinite(count)&&count>=0?Math.floor(count):0
  return`Compare candidate utilities · ${safeCount} candidate${safeCount===1?'':'s'}`
}

/** Match by semantic target identity, not by a candidate's array position. */
export function decisionCandidateMatches(summary:DecisionSummary,candidate:DecisionCandidateSummary):boolean{
  if(candidate.type!==summary.chosen)return false
  const chosenId=summary.chosenTargetId
  if(chosenId===undefined)return true
  if(chosenId===null)return candidate.targetId===null
  return Number.isFinite(chosenId)&&candidate.targetId===chosenId
}

/** Keep the inspector's rejection buckets additive and understandable at a glance. */
export function formatPerceptionTelemetry(diagnostics: PerceptionDiagnostics): PerceptionTelemetryCopy {
  const creature = diagnostics.creatures
  const food = diagnostics.food
  const combined = (key: 'range'|'fov'|'occlusion'|'detection') => creature[key] + food[key]
  const range = combined('range')
  const fov = combined('fov')
  const occlusion = combined('occlusion')
  const detection = combined('detection')
  const notDetected = range + fov + occlusion + detection
  return {
    creatures: `Other active creatures detected ${creature.detected}/${creature.total}`,
    food: `Food detected ${food.detected}/${food.total}`,
    notDetected: `Not detected: ${notDetected} total · ${range} out of range · ${fov} outside view · ${occlusion} blocked · ${detection} detection miss${detection===1?'':'es'}`,
  }
}

export interface CreatureInspectorProps {
  selected: Creature
  ecologyMode: Config['ecologyMode']
  dayTime: number
  stateLabel: string
  targetLabel: string
  decisionTargetLabel?: string
  huntContactRule: string
  /** Scalar lifecycle facts derived from the complete cohort; never a World reference. */
  settlementPreview?: SelectedSettlementPreview|null
  onClose: () => void
}

export function CreatureInspector({ selected, ecologyMode, dayTime, stateLabel, targetLabel, decisionTargetLabel, huntContactRule, settlementPreview, onClose }: CreatureInspectorProps) {
  const perceptionCopy = selected.perceptionDiagnostics ? formatPerceptionTelemetry(selected.perceptionDiagnostics) : null
  const decision=selected.decisionSummary
  const candidates=decision&&Array.isArray(decision.candidates)?decision.candidates:[]
  const chosenIndex=decision?candidates.findIndex(candidate=>decisionCandidateMatches(decision,candidate)):-1
  const decisionReason=typeof decision?.reason==='string'&&decision.reason.trim()?decision.reason:'Decision reason unavailable'

  return <section className="inspector" aria-label={`Selected individual ${selected.individualId}`}>
    <div className="inspector-head"><div><h2>Individual {selected.individualId}</h2><p>Lineage {selected.lineageId} · parent {selected.parentIndividualId??'founder'} · born generation {selected.birthGeneration}</p></div><button type="button" onClick={onClose} aria-label="Close individual inspector">×</button></div>
    <div className="utility-breakdown" role="note" style={settlementPreviewStyle}>
      <strong>If generation ended now</strong>
      {settlementPreview
        ? <span style={decisionLineStyle}>{`${formatSelectedSettlementOutcome(settlementPreview)} ${formatSelectedSettlementReproduction(settlementPreview)}`}</span>
        : <span style={decisionLineStyle}>Settlement details unavailable for this individual.</span>}
      <small style={settlementFramingStyle}>Counterfactual snapshot · not a prediction · updates as the cohort changes</small>
    </div>
    {decision
      ? <div className="utility-breakdown" role="group" aria-label="Latest captured decision"><strong>Latest decision: {formatDecisionActionLabel(decision.chosen)}</strong><span style={decisionLineStyle}>Chosen target: {formatDecisionTargetLabel(decision,decisionTargetLabel)}</span><span style={decisionLineStyle}>Reason: {decisionReason}</span><span style={decisionLineStyle}>Selection basis: {formatDecisionBasis(decision.selectionBasis)}</span><span style={decisionLineStyle}>{formatDecisionProvenance(decision.decidedAt)}</span></div>
      : <div className="utility-breakdown" role="group" aria-label="Latest captured decision"><strong>{selected.home?'No active decision while home.':'No decision captured yet'}</strong><span style={decisionLineStyle}>{selected.home?'This individual is waiting at home; there is no active action to explain.':selected.alive?'Advance the simulation to capture its next decision.':'This individual is inactive; no further decisions will be captured.'}</span></div>}
    <div className="inspector-grid"><dl style={{gridColumn:'1/-1'}}><div><dt>Age</dt><dd>{selected.age} generations</dd></div><div><dt>Energy</dt><dd>{selected.energy.toFixed(1)}</dd></div><div><dt>Food</dt><dd>{selected.food}{ecologyMode==='classic'?' / 2':' collected'}</dd></div><div><dt>State</dt><dd>{stateLabel}</dd></div><div><dt>Target</dt><dd>{targetLabel}</dd></div><div><dt>Attack ready</dt><dd>{selected.attackCooldownUntil<=dayTime?'now':`in ${(selected.attackCooldownUntil-dayTime).toFixed(2)}s`}</dd></div><div><dt>Memory</dt><dd>food {selected.memory.foodX===null?'none':'active'} · threat {selected.memory.threatX===null?'none':'active'}</dd></div></dl></div>
    {selected.perceptionDiagnostics&&perceptionCopy&&<div className="perception-summary" role="group" aria-label="Selected creature perception telemetry"><strong>Perception window {selected.perceptionDiagnostics.reactionWindow}</strong><span>{perceptionCopy.creatures}</span><span>{perceptionCopy.food}</span><span>{perceptionCopy.notDetected}</span></div>}
    {selected.mode==='hunting'&&<div className="utility-breakdown" role="note"><strong>Hunt contact rule</strong><span>{huntContactRule}</span></div>}
    <details key={`traits-${selected.individualId}`} className="utility-breakdown"><summary>Trait profile · 6 values</summary><dl>{(['speed','size','sense','aggression','caution','exploration']as BiologicalTrait[]).map(trait=><div key={trait}><dt>{trait}</dt><dd>{selected[trait].toFixed(3)}</dd></div>)}</dl></details>
    {decision&&<details key={`candidates-${selected.individualId}`} className="utility-breakdown"><summary>{formatCandidateUtilitySummary(candidates.length)}</summary><small style={{display:'block',marginTop:4,color:'var(--muted)'}}>Scores rank candidates within this captured decision—not probability or biological fitness; perception can refresh before the next decision.</small><table><caption className="sr-only">Captured candidate relative utilities; scores rank candidates within this decision, not probability or biological fitness</caption><thead><tr><th>Candidate</th><th>Relative utility</th><th>Reason</th></tr></thead><tbody>{candidates.map((candidate,i)=>{const chosen=i===chosenIndex;return <tr key={`${candidate.type}-${candidate.targetId}-${i}`} aria-label={chosen?`${candidate.type} chosen candidate`:undefined}><td>{candidate.type}{chosen&&<small> · Chosen</small>}</td><td>{Number.isFinite(candidate.score)?candidate.score.toFixed(2):'unavailable'}</td><td>{typeof candidate.reason==='string'&&candidate.reason.trim()?candidate.reason:'Reason unavailable'}</td></tr>})}</tbody></table></details>}
  </section>
}

export default CreatureInspector
