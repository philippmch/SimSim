import { memo, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { defaultConfig } from '../simulation/config'
import { experimentUrl, exportExperiment, importExperiment, MAX_EXPERIMENT_TEXT } from '../simulation/share'
import type { Config } from '../simulation/types'

export interface ParametersPanelProps {
  draft: Config
  liveConfig: Config
  dirty: boolean
  actionStatus: string
  runtimeMode: 'worker' | 'fallback'
  setDraft: Dispatch<SetStateAction<Config>>
  onStatusChange: (message: string) => void
  onApply: () => void
}

const configKeys = Object.keys(defaultConfig) as (keyof Config)[]

function configValuesEqual(left: Config, right: Config): boolean {
  if (Object.keys(left).length !== Object.keys(right).length) return false
  return configKeys.every(key => Object.is(left[key], right[key]))
}

export function areParametersPanelPropsEqual(previous: ParametersPanelProps, next: ParametersPanelProps): boolean {
  return configValuesEqual(previous.draft, next.draft)
    && configValuesEqual(previous.liveConfig, next.liveConfig)
    && previous.dirty === next.dirty
    && previous.actionStatus === next.actionStatus
    && previous.runtimeMode === next.runtimeMode
    && previous.setDraft === next.setDraft
    && previous.onStatusChange === next.onStatusChange
    && previous.onApply === next.onApply
}

function NumberControl({ label, value, min, max, step, onChange, unit }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; unit?: string }) {
  const id = label.toLowerCase().replace(/\W/g, '-')
  return <div className="control">
    <label htmlFor={id}>{label}<output>{value}{unit}</output></label>
    <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={`${value}${unit ?? ''}`} onChange={event => onChange(Number(event.target.value))} />
  </div>
}

function SelectControl({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  const id = label.toLowerCase().replace(/\W/g, '-')
  return <label className="select-control" htmlFor={id}>{label}<select id={id} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
}

function ParametersPanel({ draft, liveConfig, dirty, actionStatus, runtimeMode, setDraft, onStatusChange, onApply }: ParametersPanelProps) {
  const importRef = useRef<HTMLInputElement>(null)
  const update = <K extends keyof Config>(key: K, value: Config[K]) => setDraft(config => ({ ...config, [key]: value }))

  return <>
    <div className="seed-row"><label htmlFor="seed">Random seed</label><input id="seed" type="number" value={draft.seed} min="1" max="9999999" onChange={event => { const value = event.currentTarget.valueAsNumber; update('seed', Number.isFinite(value) ? Math.max(1, Math.min(9999999, Math.round(value))) : defaultConfig.seed) }} /><button aria-label="Choose a new random seed" onClick={() => update('seed', Math.floor(Math.random() * 9999998) + 1)}>↻</button></div>
    <div className="share-tools" role="group" aria-label="Experiment sharing and files">
      <button onClick={async () => { try { await navigator.clipboard.writeText(experimentUrl(liveConfig, location.href)); onStatusChange('Experiment link copied.') } catch { onStatusChange('Could not access the clipboard.') } }}>Copy experiment link</button>
      <button onClick={() => { try { const blob = new Blob([exportExperiment(liveConfig)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `evolution-field-lab-seed-${liveConfig.seed}.json`; link.click(); URL.revokeObjectURL(url); onStatusChange('Experiment exported.') } catch { onStatusChange('Could not export this experiment.') } }}>Export experiment</button>
      <button onClick={() => importRef.current?.click()}>Import experiment</button>
      <input ref={importRef} className="sr-only" type="file" accept="application/json,.json" onChange={async event => { try { const file = event.target.files?.[0]; if (!file) return; if (file.size > MAX_EXPERIMENT_TEXT) throw new Error('too large'); const imported = importExperiment(await file.text()); if (!imported) throw new Error(); setDraft(imported); onStatusChange('Experiment imported. Apply and restart to use it.') } catch { onStatusChange('Import failed: choose a valid experiment JSON file under 64 KB.') } finally { event.target.value = '' } }} />
    </div>
    <p className="action-status" role="status">{actionStatus}{runtimeMode === 'fallback' ? ' Running in compatibility mode.' : ''}</p>
    <fieldset><legend>Simulation model</legend>
      <div className="model-presets" role="group" aria-label="Simulation model presets">
        <button aria-pressed={draft.ecologyMode === 'energy-regrowth' && draft.perceptionMode === 'realistic' && draft.predationMode === 'contest'} onClick={() => setDraft(config => ({ ...config, ecologyMode: 'energy-regrowth', perceptionMode: 'realistic', predationMode: 'contest' }))}>Ecological</button>
        <button aria-pressed={draft.ecologyMode === 'classic' && draft.perceptionMode === 'perfect' && draft.predationMode === 'threshold'} onClick={() => setDraft(config => ({ ...config, ecologyMode: 'classic', perceptionMode: 'perfect', predationMode: 'threshold' }))}>Classic</button>
      </div>
      <p className="model-note">Ecological uses energy carryover, regrowing patches, limited perception, and contested hunts. Classic preserves the original token rules.</p>
      <SelectControl label="Lifecycle & resources" value={draft.ecologyMode} onChange={value => update('ecologyMode', value as Config['ecologyMode'])} options={[{ value: 'energy-regrowth', label: 'Energy + patch regrowth' }, { value: 'classic', label: 'Classic generation pulse' }]} />
      <SelectControl label="Perception" value={draft.perceptionMode} onChange={value => update('perceptionMode', value as Config['perceptionMode'])} options={[{ value: 'realistic', label: 'Directional, delayed & occluded' }, { value: 'perfect', label: 'Perfect local sensing' }]} />
      <SelectControl label="Predation" value={draft.predationMode} onChange={value => update('predationMode', value as Config['predationMode'])} options={[{ value: 'contest', label: 'Contested attacks' }, { value: 'threshold', label: 'Size-threshold attacks' }]} />
    </fieldset>
    <fieldset><legend>World</legend>
      <NumberControl label="Initial population" value={draft.initialPopulation} min={5} max={120} step={1} onChange={value => update('initialPopulation', value)} />
      <NumberControl label="Food per generation" value={draft.foodPerDay} min={0} max={120} step={1} onChange={value => update('foodPerDay', value)} />
      <NumberControl label="Starting energy" value={draft.startingEnergy} min={30} max={250} step={5} onChange={value => update('startingEnergy', value)} />
      {draft.ecologyMode === 'energy-regrowth' && <details className="rule-tuning"><summary>Energy lifecycle tuning</summary>
        <NumberControl label="Food energy" value={draft.foodEnergy} min={0} max={100} step={1} onChange={value => update('foodEnergy', value)} />
        <NumberControl label="Energy retained" value={Math.round(draft.energyRetention * 100)} min={0} max={100} step={5} unit="%" onChange={value => update('energyRetention', value / 100)} />
        <NumberControl label="Reproduction energy cost" value={draft.reproductionEnergyCost} min={0} max={200} step={5} onChange={value => update('reproductionEnergyCost', value)} />
        <NumberControl label="Offspring energy" value={draft.offspringEnergy} min={10} max={250} step={5} onChange={value => update('offspringEnergy', value)} />
        <NumberControl label="Maximum age" value={draft.maxAge} min={1} max={80} step={1} unit=" gen" onChange={value => update('maxAge', value)} />
      </details>}
    </fieldset>
    <fieldset><legend>Starting traits</legend>
      <NumberControl label="Speed" value={draft.startSpeed} min={.3} max={2.5} step={.05} onChange={value => update('startSpeed', value)} />
      <NumberControl label="Size" value={draft.startSize} min={.4} max={2.2} step={.05} onChange={value => update('startSize', value)} />
      <NumberControl label="Sense radius" value={draft.startSense} min={.04} max={.5} step={.01} onChange={value => update('startSense', value)} />
      <div className="diversity-presets" role="group" aria-label="Founder diversity presets"><button onClick={() => setDraft(config => ({ ...config, founderPhysicalVariation: 0, founderBehaviorVariation: 0 }))}>Clonal</button><button onClick={() => setDraft(config => ({ ...config, founderPhysicalVariation: .04, founderBehaviorVariation: .06 }))}>Low diversity</button><button onClick={() => setDraft(config => ({ ...config, founderPhysicalVariation: .16, founderBehaviorVariation: .2 }))}>High diversity</button></div>
      <NumberControl label="Founder physical variation" value={draft.founderPhysicalVariation} min={0} max={.35} step={.01} onChange={value => update('founderPhysicalVariation', value)} />
      <NumberControl label="Founder behavior variation" value={draft.founderBehaviorVariation} min={0} max={.35} step={.01} onChange={value => update('founderBehaviorVariation', value)} />
    </fieldset>
    <fieldset><legend>Inheritance</legend>
      <NumberControl label="Mutation chance" value={Math.round(draft.mutationRate * 100)} min={0} max={100} step={1} unit="%" onChange={value => update('mutationRate', value / 100)} />
      <NumberControl label="Mutation strength" value={Math.round(draft.mutationStrength * 100)} min={0} max={40} step={1} unit="%" onChange={value => update('mutationStrength', value / 100)} />
      <div className="trait-toggles"><span>Traits allowed to mutate</span><label><input type="checkbox" checked={draft.mutateSpeed} onChange={event => update('mutateSpeed', event.target.checked)} />Speed</label><label><input type="checkbox" checked={draft.mutateSize} onChange={event => update('mutateSize', event.target.checked)} />Size</label><label><input type="checkbox" checked={draft.mutateSense} onChange={event => update('mutateSense', event.target.checked)} />Sense</label></div>
    </fieldset>
    <fieldset><legend>Behavior &amp; motion</legend>
      <NumberControl label="Starting aggression" value={draft.startAggression} min={0} max={1} step={.05} onChange={value => update('startAggression', value)} />
      <NumberControl label="Starting caution" value={draft.startCaution} min={0} max={1} step={.05} onChange={value => update('startCaution', value)} />
      <NumberControl label="Starting exploration" value={draft.startExploration} min={0} max={1} step={.05} onChange={value => update('startExploration', value)} />
      <div className="trait-toggles"><span>Behavior genes allowed to mutate</span><label><input type="checkbox" checked={draft.mutateAggression} onChange={event => update('mutateAggression', event.target.checked)} />Aggression</label><label><input type="checkbox" checked={draft.mutateCaution} onChange={event => update('mutateCaution', event.target.checked)} />Caution</label><label><input type="checkbox" checked={draft.mutateExploration} onChange={event => update('mutateExploration', event.target.checked)} />Explore</label></div>
      <NumberControl label="Acceleration" value={draft.acceleration} min={.04} max={.25} step={.01} onChange={value => update('acceleration', value)} />
      <NumberControl label="Turning agility" value={draft.turnRate} min={1} max={8} step={.25} onChange={value => update('turnRate', value)} />
      <NumberControl label="Memory duration" value={draft.memoryDuration} min={.5} max={8} step={.25} unit="s" onChange={value => update('memoryDuration', value)} />
      <NumberControl label="Target commitment" value={draft.commitmentDuration} min={.1} max={3} step={.1} unit="s" onChange={value => update('commitmentDuration', value)} />
      {draft.perceptionMode === 'realistic' && <details className="rule-tuning"><summary>Perception tuning</summary>
        <NumberControl label="Field of view" value={draft.fieldOfView} min={30} max={360} step={5} unit="°" onChange={value => update('fieldOfView', value)} />
        <NumberControl label="Detection falloff" value={Math.round(draft.detectionFalloff * 100)} min={0} max={100} step={5} unit="%" onChange={value => update('detectionFalloff', value / 100)} />
        <NumberControl label="Reaction interval" value={draft.reactionTime} min={0} max={2} step={.05} unit="s" onChange={value => update('reactionTime', value)} />
        <label className="check-control"><input type="checkbox" checked={draft.obstacleOcclusion} onChange={event => update('obstacleOcclusion', event.target.checked)} /> Obstacles block sight</label>
      </details>}
    </fieldset>
    <fieldset><legend>Environment &amp; seasons</legend>
      <NumberControl label="Food patches" value={draft.foodPatchCount} min={1} max={8} step={1} onChange={value => update('foodPatchCount', value)} />
      <NumberControl label="Patchiness" value={Math.round(draft.foodPatchiness * 100)} min={0} max={100} step={5} unit="%" onChange={value => update('foodPatchiness', value / 100)} />
      <NumberControl label="Patch spread" value={draft.foodPatchSpread} min={.04} max={.25} step={.01} onChange={value => update('foodPatchSpread', value)} />
      <NumberControl label="Obstacles" value={draft.obstacleCount} min={0} max={10} step={1} onChange={value => update('obstacleCount', value)} />
      <NumberControl label="Season strength" value={Math.round(draft.seasonAmplitude * 100)} min={0} max={70} step={5} unit="%" onChange={value => update('seasonAmplitude', value / 100)} />
      <NumberControl label="Season length" value={draft.seasonLength} min={2} max={30} step={1} unit=" gen" onChange={value => update('seasonLength', value)} />
      <NumberControl label="Environment response" value={Math.round(draft.environmentResponse * 100)} min={5} max={100} step={5} unit="%" onChange={value => update('environmentResponse', value / 100)} />
      <NumberControl label="Food trend / generation" value={Math.round(draft.foodTrend * 100)} min={-5} max={5} step={1} unit="%" onChange={value => update('foodTrend', value / 100)} />
      {draft.ecologyMode === 'energy-regrowth' && <details className="rule-tuning"><summary>Resource regrowth tuning</summary>
        <NumberControl label="Capacity per patch" value={draft.patchCapacity} min={1} max={180} step={1} onChange={value => update('patchCapacity', value)} />
        <NumberControl label="Regrowth rate" value={Math.round(draft.foodRegrowthRate * 100)} min={0} max={100} step={1} unit="% / gen" onChange={value => update('foodRegrowthRate', value / 100)} />
      </details>}
    </fieldset>
    <fieldset><legend>Selection pressures</legend>
      <NumberControl label={draft.predationMode === 'contest' ? 'Contest size benchmark' : 'Predator size ratio'} value={draft.predatorRatio} min={1.05} max={2} step={.05} unit="×" onChange={value => update('predatorRatio', value)} />
      <NumberControl label="Movement energy cost" value={draft.moveEnergyFactor} min={.1} max={2} step={.05} onChange={value => update('moveEnergyFactor', value)} />
      <NumberControl label="Sensing energy cost" value={draft.senseEnergyFactor} min={.05} max={1.5} step={.05} onChange={value => update('senseEnergyFactor', value)} />
      {draft.predationMode === 'contest' && <details className="rule-tuning"><summary>Attack contest tuning</summary>
        <NumberControl label="Prey energy reward" value={draft.preyEnergy} min={0} max={200} step={5} onChange={value => update('preyEnergy', value)} />
        <NumberControl label="Attack energy cost" value={draft.attackCost} min={0} max={50} step={1} onChange={value => update('attackCost', value)} />
        <NumberControl label="Handling time" value={draft.handlingTime} min={0} max={3} step={.05} unit="s" onChange={value => update('handlingTime', value)} />
        <NumberControl label="Contest sharpness" value={draft.contestSharpness} min={.1} max={12} step={.1} onChange={value => update('contestSharpness', value)} />
        <NumberControl label="Evasion weight" value={draft.evasionWeight} min={0} max={3} step={.05} onChange={value => update('evasionWeight', value)} />
      </details>}
    </fieldset>
    <details><summary>Rules of this ecosystem</summary><p>{draft.ecologyMode === 'classic' ? 'One food brought home survives; two also produces one mutated offspring.' : 'Creatures survive by returning home with energy, retain part of it, pay to reproduce, age, and forage from patches that regrow during the generation.'} {draft.perceptionMode === 'realistic' ? 'They react at intervals and can miss targets outside their view or behind obstacles.' : 'They sense every target inside their radius.'} {draft.predationMode === 'contest' ? `Hunters at least as large as their prey may attempt a contest. The ${draft.predatorRatio.toFixed(2)}× size benchmark sets the reference; raising it makes attacks harder. Speed, energy, aggression, and caution also shape the result.` : `Larger creatures instantly catch animals at least ${draft.predatorRatio.toFixed(2)}× smaller.`}</p></details>
    <button className="apply" onClick={onApply} disabled={!dirty}>{dirty ? 'Apply parameters & restart' : 'No staged changes'}</button>
  </>
}

export default memo(ParametersPanel, areParametersPanelPropsEqual)
