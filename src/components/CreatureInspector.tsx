import type { BiologicalTrait, Config, Creature, DecisionCandidateSummary, DecisionProvenance, DecisionSelectionBasis, DecisionSummary, PerceptionDiagnostics, TargetType } from '../simulation/types'

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
const decisionLineStyle={display:'block',marginLeft:0} as const

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
  if(type==='food')return'Food item · unavailable'
  if(type==='prey')return'Prey · unavailable'
  if(type==='threat')return'Threat · unavailable'
  return'Decision target unavailable'
}

/** The app resolves creature IDs to stable individual IDs before passing this copy in. */
export function formatDecisionTargetLabel(summary:DecisionSummary|undefined,label?:string):string{
  const clean=typeof label==='string'&&label.trim()?label.trim():''
  return clean||fallbackDecisionTarget(summary?.chosen)
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
  onClose: () => void
}

export function CreatureInspector({ selected, ecologyMode, dayTime, stateLabel, targetLabel, decisionTargetLabel, huntContactRule, onClose }: CreatureInspectorProps) {
  const perceptionCopy = selected.perceptionDiagnostics ? formatPerceptionTelemetry(selected.perceptionDiagnostics) : null
  const decision=selected.decisionSummary
  const candidates=decision&&Array.isArray(decision.candidates)?decision.candidates:[]
  const chosenIndex=decision?candidates.findIndex(candidate=>decisionCandidateMatches(decision,candidate)):-1

  return <section className="inspector" aria-label={`Selected individual ${selected.individualId}`}>
    <div className="inspector-head"><div><h2>Individual {selected.individualId}</h2><p>Lineage {selected.lineageId} · parent {selected.parentIndividualId??'founder'} · born generation {selected.birthGeneration}</p></div><button type="button" onClick={onClose} aria-label="Close individual inspector">×</button></div>
    <div className="inspector-grid"><dl><div><dt>Age</dt><dd>{selected.age} generations</dd></div><div><dt>Energy</dt><dd>{selected.energy.toFixed(1)}</dd></div><div><dt>Food</dt><dd>{selected.food}{ecologyMode==='classic'?' / 2':' collected'}</dd></div><div><dt>State</dt><dd>{stateLabel}</dd></div><div><dt>Target</dt><dd>{targetLabel}</dd></div><div><dt>Attack ready</dt><dd>{selected.attackCooldownUntil<=dayTime?'now':`in ${(selected.attackCooldownUntil-dayTime).toFixed(2)}s`}</dd></div><div><dt>Memory</dt><dd>food {selected.memory.foodX===null?'none':'active'} · threat {selected.memory.threatX===null?'none':'active'}</dd></div></dl><dl>{(['speed','size','sense','aggression','caution','exploration']as BiologicalTrait[]).map(trait=><div key={trait}><dt>{trait}</dt><dd>{selected[trait].toFixed(3)}</dd></div>)}</dl></div>
    {selected.mode==='hunting'&&<div className="utility-breakdown" role="note"><strong>Hunt contact rule</strong><span>{huntContactRule}</span></div>}
    {selected.perceptionDiagnostics&&perceptionCopy&&<div className="perception-summary" role="group" aria-label="Selected creature perception telemetry"><strong>Perception window {selected.perceptionDiagnostics.reactionWindow}</strong><span>{perceptionCopy.creatures}</span><span>{perceptionCopy.food}</span><span>{perceptionCopy.notDetected}</span></div>}
    {decision&&<div className="utility-breakdown" role="group" aria-label="Captured decision"><strong>Decision: {decision.chosen}</strong><span style={decisionLineStyle}>Chosen target: {formatDecisionTargetLabel(decision,decisionTargetLabel)}</span><span style={decisionLineStyle}>{formatDecisionBasis(decision.selectionBasis)}</span><span style={decisionLineStyle}>{formatDecisionProvenance(decision.decidedAt)}</span><span style={decisionLineStyle}>{typeof decision.reason==='string'&&decision.reason.trim()?decision.reason:'Decision reason unavailable'}</span><small style={{display:'block',marginTop:4,color:'var(--muted)'}}>Candidate utilities are from this captured decision; perception can refresh before the next decision.</small><table><caption className="sr-only">Captured candidate relative utilities; scores rank candidates within this decision, not probability or biological fitness</caption><thead><tr><th>Candidate</th><th>Relative utility</th><th>Reason</th></tr></thead><tbody>{candidates.map((candidate,i)=>{const chosen=i===chosenIndex;return <tr key={`${candidate.type}-${candidate.targetId}-${i}`} aria-label={chosen?`${candidate.type} chosen candidate`:undefined}><td>{candidate.type}{chosen&&<small> · Chosen</small>}</td><td>{Number.isFinite(candidate.score)?candidate.score.toFixed(2):'unavailable'}</td><td>{typeof candidate.reason==='string'&&candidate.reason.trim()?candidate.reason:'Reason unavailable'}</td></tr>})}</tbody></table></div>}
  </section>
}

export default CreatureInspector
