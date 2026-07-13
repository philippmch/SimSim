import { useCallback, useEffect, useRef, useState } from 'react'
import { ArenaCanvas } from './components/ArenaCanvas'
import { BehaviorHistory, Histogram, HistoryChart } from './components/Charts'
import { createWorld, defaultConfig, getModeCounts, getStats, runGeneration, SIMULATION_TIMESTEP, tick } from './simulation/engine'
import type { Config, World } from './simulation/types'

const copyConfig=(c:Config):Config=>({...c})

function NumberControl({label,value,min,max,step,onChange,unit}:{label:string,value:number,min:number,max:number,step:number,onChange:(n:number)=>void,unit?:string}){
  const id=label.toLowerCase().replace(/\W/g,'-')
  return <div className="control">
    <label htmlFor={id}>{label}<output>{value}{unit}</output></label>
    <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/>
  </div>
}

function App(){
  const [draft,setDraft]=useState<Config>(()=>copyConfig(defaultConfig))
  const [world,setWorld]=useState<World>(()=>createWorld(defaultConfig))
  const worldRef=useRef(world); worldRef.current=world
  const [playing,setPlaying]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [speed,setSpeed]=useState(1),[revision,setRevision]=useState(0)
  const [settingsOpen,setSettingsOpen]=useState(false)
  const [isNarrow,setIsNarrow]=useState(()=>window.matchMedia('(max-width: 1050px)').matches)
  const settingsToggleRef=useRef<HTMLButtonElement>(null)
  const settingsRef=useRef<HTMLElement>(null)
  const settingsCloseRef=useRef<HTMLButtonElement>(null)
  const dirty=JSON.stringify(draft)!==JSON.stringify(world.config)
  const living=world.creatures.filter(c=>c.alive).length
  const extinct=world.creatures.length===0
  const stats=getStats(world)
  const modes=getModeCounts(world)
  const update=<K extends keyof Config>(key:K,value:Config[K])=>setDraft(c=>({...c,[key]:value}))
  const closeSettings=useCallback(()=>setSettingsOpen(false),[])
  const reset=useCallback(()=>{const w=createWorld(draft);worldRef.current=w;setWorld(w);setRevision(n=>n+1)},[draft])
  const step=()=>{setPlaying(false);runGeneration(worldRef.current);setWorld({...worldRef.current});setRevision(n=>n+1)}

  useEffect(()=>{
    const query=window.matchMedia('(max-width: 1050px)')
    const change=()=>setIsNarrow(query.matches)
    query.addEventListener('change',change)
    return()=>query.removeEventListener('change',change)
  },[])

  useEffect(()=>{
    if(!settingsOpen)return
    settingsCloseRef.current?.focus()
    const previousOverflow=document.body.style.overflow
    if(isNarrow)document.body.style.overflow='hidden'
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();closeSettings();return}
      if(event.key!=='Tab'||!isNarrow||!settingsRef.current)return
      const focusable=[...settingsRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
      if(!focusable.length)return
      const first=focusable[0],last=focusable.at(-1)!
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
    document.addEventListener('keydown',onKeyDown)
    return()=>{document.removeEventListener('keydown',onKeyDown);document.body.style.overflow=previousOverflow;settingsToggleRef.current?.focus()}
  },[settingsOpen,isNarrow,closeSettings])

  useEffect(()=>{
    if(!playing)return
    let id=0,last=performance.now(),acc=0
    const frame=(now:number)=>{
      const elapsed=Math.min(.1,(now-last)/1000);last=now;acc+=elapsed*speed
      while(acc>=SIMULATION_TIMESTEP){tick(worldRef.current,SIMULATION_TIMESTEP);acc-=SIMULATION_TIMESTEP}
      setRevision(n=>n+1);id=requestAnimationFrame(frame)
    }
    id=requestAnimationFrame(frame);return()=>cancelAnimationFrame(id)
  },[playing,speed])

  useEffect(()=>{if(extinct)setPlaying(false)},[extinct])

  const historyStart=world.history.at(-40)?.generation??0
  const historyEnd=world.history.at(-1)?.generation??0
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="mark" aria-hidden="true">∿</div><div><h1>Evolution Field Lab</h1><p>Shape an ecosystem. Watch selection unfold.</p></div></div>
      <button ref={settingsToggleRef} className="settings-toggle" onClick={()=>setSettingsOpen(v=>!v)} aria-expanded={settingsOpen} aria-controls="settings" aria-haspopup={isNarrow?'dialog':undefined}>
        <span aria-hidden="true">⚙</span> <span>Parameters</span>{dirty&&<><b aria-hidden="true">•</b><span className="sr-only">Unapplied parameter changes</span></>}
      </button>
    </header>
    <main>
      <section className="simulation-panel" aria-label="Simulation" aria-hidden={settingsOpen&&isNarrow||undefined}>
        <div className="arena-wrap">
          <ArenaCanvas world={world} revision={revision}/>
          <div className="arena-badge">GENERATION {world.generation}<small>{world.food.length} / {Math.round(world.environment.foodBudget)} seasonal food</small></div>
          <div className="legend"><span>Creature speed</span><i/><small>slower</small><small>faster</small></div>
          {extinct&&<div className="extinct" role="status"><strong>Population extinct</strong><span>Increase food or energy, then restart the run.</span></div>}
        </div>
        <div className="transport" aria-label="Playback controls">
          <button className="play" disabled={extinct} onClick={()=>setPlaying(v=>!v)} aria-label={extinct?'Playback unavailable: population extinct':playing?'Pause simulation':'Play simulation'}>{playing?'Ⅱ':'▶'}</button>
          <button onClick={step} disabled={extinct} aria-label="Pause and finish the current generation">Finish generation</button>
          <div className="day-progress" role="progressbar" aria-label="Current generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(world.dayTime/world.config.dayLength*100)}><i style={{width:`${world.dayTime/world.config.dayLength*100}%`}}/></div>
          <label className="speed-select">Playback speed <select value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
          <button className="reset" onClick={reset}>{dirty?'Apply & restart':'Restart run'}</button>
        </div>
        {dirty&&<div className="pending" role="status">Changes are staged and will take effect when you choose <strong>Apply &amp; restart</strong>.</div>}

        <section className="dashboard" aria-label="Live statistics">
          <div className="summary-strip">
            <div className="population-summary"><span>Living population</span><strong>{living}</strong><small>Generation {world.generation}</small></div>
            <dl className="trait-summary">
              <div><dt>Average speed</dt><dd>{stats.avgSpeed.toFixed(2)}</dd></div>
              <div><dt>Average size</dt><dd>{stats.avgSize.toFixed(2)}</dd></div>
              <div><dt>Average sense</dt><dd>{stats.avgSense.toFixed(2)}</dd></div>
            </dl>
          </div>
          <div className="behavior-summary" aria-label="Live behavior gene averages">
            <strong>Behavior genes</strong><span>Aggression <b>{stats.avgAggression.toFixed(2)}</b></span><span>Caution <b>{stats.avgCaution.toFixed(2)}</b></span><span>Exploration <b>{stats.avgExploration.toFixed(2)}</b></span>
          </div>
          <div className="mode-line" aria-label="Current behavior modes"><strong>Current modes</strong><span>{modes.exploring} exploring</span><span>{modes.foraging} foraging</span><span>{modes.hunting} hunting</span><span>{modes.fleeing} fleeing</span><span>{modes.returning} returning</span></div>
          <div className="outcome-line" role="status">
            <strong>Previous generation</strong>
            {world.generation===1?<span>No outcome yet</span>:<>
              <span><b>{world.lastReport.survived}</b> survived</span><span><b>{world.lastReport.born}</b> born</span><span><b>{world.lastReport.starved}</b> starved</span><span><b>{world.lastReport.hunted}</b> hunted</span>
            </>}
          </div>
          <div className="insights">
            <div className="chart-card histogram-card"><div className="card-head"><div><h2>Current speed distribution</h2><p>Living creatures by travel rate</p></div><span>N = {living}</span></div><Histogram world={world}/></div>
            <div className="chart-card history-card"><div className="card-head"><div><h2>Generational history</h2><p>Separate scales keep unlike measures honest</p></div>{world.history.length>1&&<span>Gen {historyStart}–{historyEnd}</span>}</div><HistoryChart world={world}/></div>
            <div className="chart-card behavior-history-card"><div className="card-head"><div><h2>Behavior history</h2><p>Inherited tendencies, each on a 0–1 scale</p></div>{world.history.length>1&&<span>Gen {historyStart}–{historyEnd}</span>}</div><BehaviorHistory world={world}/></div>
          </div>
        </section>
      </section>
      {settingsOpen&&isNarrow&&<div className="settings-backdrop" aria-hidden="true" onMouseDown={closeSettings}/>}
      <aside ref={settingsRef} id="settings" className={`settings ${settingsOpen?'open':''}`} role={isNarrow?'dialog':'region'} aria-modal={isNarrow&&settingsOpen||undefined} aria-labelledby="settings-title">
        <div className="settings-head"><div><h2 id="settings-title">Experiment parameters</h2><p>Edits are staged until restart</p></div><button ref={settingsCloseRef} onClick={closeSettings} aria-label="Close parameters">×</button></div>
        <div className="seed-row"><label htmlFor="seed">Random seed</label><input id="seed" type="number" value={draft.seed} min="1" max="9999999" onChange={e=>update('seed',Math.max(1,Number(e.target.value)))}/><button aria-label="Choose a new random seed" onClick={()=>update('seed',Math.floor(Math.random()*9999998)+1)}>↻</button></div>
        <fieldset><legend>World</legend>
          <NumberControl label="Initial population" value={draft.initialPopulation} min={5} max={120} step={1} onChange={v=>update('initialPopulation',v)}/>
          <NumberControl label="Food per generation" value={draft.foodPerDay} min={2} max={120} step={1} onChange={v=>update('foodPerDay',v)}/>
          <NumberControl label="Starting energy" value={draft.startingEnergy} min={30} max={250} step={5} onChange={v=>update('startingEnergy',v)}/>
        </fieldset>
        <fieldset><legend>Starting traits</legend>
          <NumberControl label="Speed" value={draft.startSpeed} min={.3} max={2.5} step={.05} onChange={v=>update('startSpeed',v)}/>
          <NumberControl label="Size" value={draft.startSize} min={.4} max={2.2} step={.05} onChange={v=>update('startSize',v)}/>
          <NumberControl label="Sense radius" value={draft.startSense} min={.04} max={.5} step={.01} onChange={v=>update('startSense',v)}/>
        </fieldset>
        <fieldset><legend>Inheritance</legend>
          <NumberControl label="Mutation chance" value={Math.round(draft.mutationRate*100)} min={0} max={100} step={1} unit="%" onChange={v=>update('mutationRate',v/100)}/>
          <NumberControl label="Mutation strength" value={Math.round(draft.mutationStrength*100)} min={0} max={40} step={1} unit="%" onChange={v=>update('mutationStrength',v/100)}/>
          <div className="trait-toggles"><span>Traits allowed to mutate</span><label><input type="checkbox" checked={draft.mutateSpeed} onChange={e=>update('mutateSpeed',e.target.checked)}/>Speed</label><label><input type="checkbox" checked={draft.mutateSize} onChange={e=>update('mutateSize',e.target.checked)}/>Size</label><label><input type="checkbox" checked={draft.mutateSense} onChange={e=>update('mutateSense',e.target.checked)}/>Sense</label></div>
        </fieldset>
        <fieldset><legend>Behavior &amp; motion</legend>
          <NumberControl label="Starting aggression" value={draft.startAggression} min={0} max={1} step={.05} onChange={v=>update('startAggression',v)}/>
          <NumberControl label="Starting caution" value={draft.startCaution} min={0} max={1} step={.05} onChange={v=>update('startCaution',v)}/>
          <NumberControl label="Starting exploration" value={draft.startExploration} min={0} max={1} step={.05} onChange={v=>update('startExploration',v)}/>
          <div className="trait-toggles"><span>Behavior genes allowed to mutate</span><label><input type="checkbox" checked={draft.mutateAggression} onChange={e=>update('mutateAggression',e.target.checked)}/>Aggression</label><label><input type="checkbox" checked={draft.mutateCaution} onChange={e=>update('mutateCaution',e.target.checked)}/>Caution</label><label><input type="checkbox" checked={draft.mutateExploration} onChange={e=>update('mutateExploration',e.target.checked)}/>Explore</label></div>
          <NumberControl label="Acceleration" value={draft.acceleration} min={.04} max={.25} step={.01} onChange={v=>update('acceleration',v)}/>
          <NumberControl label="Turning agility" value={draft.turnRate} min={1} max={8} step={.25} onChange={v=>update('turnRate',v)}/>
          <NumberControl label="Memory duration" value={draft.memoryDuration} min={.5} max={8} step={.25} unit="s" onChange={v=>update('memoryDuration',v)}/>
          <NumberControl label="Target commitment" value={draft.commitmentDuration} min={.1} max={3} step={.1} unit="s" onChange={v=>update('commitmentDuration',v)}/>
        </fieldset>
        <fieldset><legend>Environment &amp; seasons</legend>
          <NumberControl label="Food patches" value={draft.foodPatchCount} min={1} max={8} step={1} onChange={v=>update('foodPatchCount',v)}/>
          <NumberControl label="Patchiness" value={Math.round(draft.foodPatchiness*100)} min={0} max={100} step={5} unit="%" onChange={v=>update('foodPatchiness',v/100)}/>
          <NumberControl label="Patch spread" value={draft.foodPatchSpread} min={.04} max={.25} step={.01} onChange={v=>update('foodPatchSpread',v)}/>
          <NumberControl label="Obstacles" value={draft.obstacleCount} min={0} max={10} step={1} onChange={v=>update('obstacleCount',v)}/>
          <NumberControl label="Season strength" value={Math.round(draft.seasonAmplitude*100)} min={0} max={70} step={5} unit="%" onChange={v=>update('seasonAmplitude',v/100)}/>
          <NumberControl label="Season length" value={draft.seasonLength} min={2} max={30} step={1} unit=" gen" onChange={v=>update('seasonLength',v)}/>
          <NumberControl label="Environment response" value={Math.round(draft.environmentResponse*100)} min={5} max={100} step={5} unit="%" onChange={v=>update('environmentResponse',v/100)}/>
          <NumberControl label="Food trend / generation" value={Math.round(draft.foodTrend*100)} min={-5} max={5} step={1} unit="%" onChange={v=>update('foodTrend',v/100)}/>
        </fieldset>
        <fieldset><legend>Selection pressures</legend>
          <NumberControl label="Predator size ratio" value={draft.predatorRatio} min={1.05} max={2} step={.05} unit="×" onChange={v=>update('predatorRatio',v)}/>
          <NumberControl label="Movement energy cost" value={draft.moveEnergyFactor} min={.1} max={2} step={.05} onChange={v=>update('moveEnergyFactor',v)}/>
          <NumberControl label="Sensing energy cost" value={draft.senseEnergyFactor} min={.05} max={1.5} step={.05} onChange={v=>update('senseEnergyFactor',v)}/>
        </fieldset>
        <details><summary>Rules of this ecosystem</summary><p>Creatures weigh food, prey, danger, memory, and the cost of returning home. One food brought home survives; two also produces one mutated offspring. Larger creatures can eat animals at least {draft.predatorRatio.toFixed(2)}× smaller. Momentum, obstacles, seasonal food, and inherited behavior genes shape each run.</p></details>
        <button className="apply" onClick={()=>{reset();closeSettings()}} disabled={!dirty}>{dirty?'Apply parameters & restart':'No staged changes'}</button>
      </aside>
    </main>
  </div>
}

export default App
