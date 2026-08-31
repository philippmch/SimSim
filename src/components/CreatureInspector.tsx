import type { BiologicalTrait, Config, Creature, PerceptionDiagnostics } from '../simulation/types'

export interface PerceptionTelemetryCopy {
  creatures: string
  food: string
  notDetected: string
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
  huntContactRule: string
  onClose: () => void
}

export function CreatureInspector({ selected, ecologyMode, dayTime, stateLabel, targetLabel, huntContactRule, onClose }: CreatureInspectorProps) {
  const perceptionCopy = selected.perceptionDiagnostics ? formatPerceptionTelemetry(selected.perceptionDiagnostics) : null

  return <section className="inspector" aria-label={`Selected individual ${selected.individualId}`}>
    <div className="inspector-head"><div><h2>Individual {selected.individualId}</h2><p>Lineage {selected.lineageId} · parent {selected.parentIndividualId??'founder'} · born generation {selected.birthGeneration}</p></div><button type="button" onClick={onClose} aria-label="Close individual inspector">×</button></div>
    <div className="inspector-grid"><dl><div><dt>Age</dt><dd>{selected.age} generations</dd></div><div><dt>Energy</dt><dd>{selected.energy.toFixed(1)}</dd></div><div><dt>Food</dt><dd>{selected.food}{ecologyMode==='classic'?' / 2':' collected'}</dd></div><div><dt>State</dt><dd>{stateLabel}</dd></div><div><dt>Target</dt><dd>{targetLabel}</dd></div><div><dt>Attack ready</dt><dd>{selected.attackCooldownUntil<=dayTime?'now':`in ${(selected.attackCooldownUntil-dayTime).toFixed(2)}s`}</dd></div><div><dt>Memory</dt><dd>food {selected.memory.foodX===null?'none':'active'} · threat {selected.memory.threatX===null?'none':'active'}</dd></div></dl><dl>{(['speed','size','sense','aggression','caution','exploration']as BiologicalTrait[]).map(trait=><div key={trait}><dt>{trait}</dt><dd>{selected[trait].toFixed(3)}</dd></div>)}</dl></div>
    {selected.mode==='hunting'&&<div className="utility-breakdown" role="note"><strong>Hunt contact rule</strong><span>{huntContactRule}</span></div>}
    {selected.perceptionDiagnostics&&perceptionCopy&&<div className="perception-summary" role="group" aria-label="Selected creature perception telemetry"><strong>Perception window {selected.perceptionDiagnostics.reactionWindow}</strong><span>{perceptionCopy.creatures}</span><span>{perceptionCopy.food}</span><span>{perceptionCopy.notDetected}</span></div>}
    {selected.decisionSummary&&<div className="utility-breakdown"><strong>Decision: {selected.decisionSummary.chosen}</strong><span>{selected.decisionSummary.reason}</span><small style={{display:'block',marginTop:4,color:'var(--muted)'}}>Relative utility ranks only the current candidates; it is not probability or biological fitness.</small><table><caption className="sr-only">Current candidate relative utilities; higher ranks as preferred, not probability or biological fitness</caption><thead><tr><th>Candidate</th><th>Relative utility</th><th>Reason</th></tr></thead><tbody>{selected.decisionSummary.candidates.map((candidate,i)=><tr key={`${candidate.type}-${candidate.targetId}-${i}`}><td>{candidate.type}</td><td>{candidate.score.toFixed(2)}</td><td>{candidate.reason}</td></tr>)}</tbody></table></div>}
  </section>
}

export default CreatureInspector
