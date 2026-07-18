import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArenaCanvas, CREATURE_STATE_METADATA } from './components/ArenaCanvas'
import type { CreatureState } from './components/ArenaCanvas'
import { BehaviorHistory, Histogram, HistoryChart, summarizeDistribution } from './components/Charts'
import { createWorld, getLineageAnalytics, getModeCounts, getStats } from './simulation/engine'
import { defaultConfig,MAX_FOOD,MAX_POPULATION, sanitizeConfig } from './simulation/config'
import { createController } from './simulation/controller'
import type { SimulationController } from './simulation/controller'
import { experimentUrl,exportExperiment,importExperiment,loadInitialConfig,MAX_EXPERIMENT_TEXT,persistExperiment } from './simulation/share'
import type { BiologicalTrait,Config,InterventionKind, World } from './simulation/types'

const ExperimentPanel=lazy(()=>import('./components/ExperimentPanel').then(module=>({default:module.ExperimentPanel})))
const creatureStates=Object.entries(CREATURE_STATE_METADATA) as [CreatureState,(typeof CREATURE_STATE_METADATA)[CreatureState]][]

const copyConfig=(c:Config):Config=>({...c})

function NumberControl({label,value,min,max,step,onChange,unit}:{label:string,value:number,min:number,max:number,step:number,onChange:(n:number)=>void,unit?:string}){
  const id=label.toLowerCase().replace(/\W/g,'-')
  return <div className="control">
    <label htmlFor={id}>{label}<output>{value}{unit}</output></label>
    <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={`${value}${unit??''}`} onChange={e=>onChange(Number(e.target.value))}/>
  </div>
}

function SelectControl({label,value,onChange,options}:{label:string,value:string,onChange:(value:string)=>void,options:{value:string;label:string}[]}){
  const id=label.toLowerCase().replace(/\W/g,'-')
  return <label className="select-control" htmlFor={id}>{label}<select id={id} value={value} onChange={event=>onChange(event.target.value)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
}

function App(){
  const initialRef=useRef<Config>(loadInitialConfig(window.location.search,(()=>{try{return window.localStorage}catch{return null}})()))
  const [draft,setDraft]=useState<Config>(()=>copyConfig(initialRef.current))
  const [world,setWorld]=useState<World>(()=>createWorld(initialRef.current))
  const controllerRef=useRef<SimulationController|null>(null)
  const [playing,setPlaying]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [speed,setSpeed]=useState(1),[revision,setRevision]=useState(0)
  const [settingsOpen,setSettingsOpen]=useState(false)
  const [experimentOpen,setExperimentOpen]=useState(false)
  const [isNarrow,setIsNarrow]=useState(()=>window.matchMedia('(max-width: 1050px)').matches)
  const settingsToggleRef=useRef<HTMLButtonElement>(null)
  const experimentToggleRef=useRef<HTMLButtonElement>(null)
  const settingsRef=useRef<HTMLElement>(null)
  const settingsCloseRef=useRef<HTMLButtonElement>(null)
  const importRef=useRef<HTMLInputElement>(null)
  const [actionStatus,setActionStatus]=useState('')
  const [runtimeMode,setRuntimeMode]=useState<'worker'|'fallback'>('worker')
  const [distributionTrait,setDistributionTrait]=useState<BiologicalTrait>('speed')
  const [selectedIndividualId,setSelectedIndividualId]=useState<number|null>(null)
  const dirty=JSON.stringify(draft)!==JSON.stringify(world.config)
  const living=world.creatures.filter(c=>c.alive).length
  const extinct=world.creatures.length===0
  const playingRef=useRef(playing);playingRef.current=playing
  const extinctRef=useRef(extinct);extinctRef.current=extinct
  const resumeOnVisibleRef=useRef(false)
  const stats=getStats(world)
  const modes=getModeCounts(world)
  const activeModeTotal=Object.values(modes).reduce((sum,count)=>sum+count,0)
  const stateCounts:Record<CreatureState,number>={safe:living-activeModeTotal,...modes}
  const lineage=getLineageAnalytics(world)
  const lastLedger=world.ledger.at(-1)
  const selected=world.creatures.find(c=>c.individualId===selectedIndividualId&&c.alive)
  const distribution=summarizeDistribution(world.creatures.filter(c=>c.alive).map(c=>c[distributionTrait]))
  const update=<K extends keyof Config>(key:K,value:Config[K])=>setDraft(c=>({...c,[key]:value}))
  const closeSettings=useCallback(()=>setSettingsOpen(false),[])
  const closeExperiment=useCallback(()=>{setExperimentOpen(false);requestAnimationFrame(()=>experimentToggleRef.current?.focus())},[])
  const replayExperiment=useCallback((config:Config)=>{setDraft(sanitizeConfig(config));setActionStatus('Control seed staged. Choose Apply & restart to replay it live.');setExperimentOpen(false);requestAnimationFrame(()=>experimentToggleRef.current?.focus())},[])
  const reset=useCallback(()=>{const clean=sanitizeConfig(draft);setDraft(clean);setSelectedIndividualId(null);persistExperiment(clean,(()=>{try{return localStorage}catch{return null}})());try{history.replaceState(null,'',experimentUrl(clean,location.href))}catch{/* URL unavailable */}controllerRef.current?.send({type:'reset',config:clean});setPlaying(false);setActionStatus('Experiment applied and restarted.')},[draft])
  const step=()=>{setPlaying(false);controllerRef.current?.send({type:'finish'})}
  const selectIndividual=(individualId:number|null)=>{setSelectedIndividualId(individualId);controllerRef.current?.send({type:'inspect',individualId})}
  const intervene=(kind:InterventionKind)=>{controllerRef.current?.send({type:'intervene',kind});setActionStatus(kind==='resource-bloom'?'Resource bloom released.':kind==='drought'?'Drought applied.':'Founder migration released.')}

  useEffect(()=>{const controller=createController(initialRef.current,w=>{setWorld(w);setRevision(n=>n+1)},()=>setRuntimeMode('fallback'));controllerRef.current=controller;setRuntimeMode(controller.mode);return()=>{controller.dispose();controllerRef.current=null}},[])

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

  useEffect(()=>{controllerRef.current?.send({type:playing?'play':'pause'})},[playing])
  useEffect(()=>{controllerRef.current?.send({type:'speed',speed})},[speed])
  useEffect(()=>{const visibility=()=>{if(document.hidden){resumeOnVisibleRef.current=playingRef.current;if(resumeOnVisibleRef.current)controllerRef.current?.send({type:'pause'})}else{const shouldResume=resumeOnVisibleRef.current&&playingRef.current&&!extinctRef.current;resumeOnVisibleRef.current=false;if(shouldResume)controllerRef.current?.send({type:'play'})}};document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility)},[])

  useEffect(()=>{if(extinct)setPlaying(false)},[extinct])
  useEffect(()=>{if(selectedIndividualId!==null&&!world.creatures.some(creature=>creature.alive&&creature.individualId===selectedIndividualId)){setSelectedIndividualId(null);controllerRef.current?.send({type:'inspect',individualId:null})}},[world,selectedIndividualId])

  const historyStart=world.history.at(-40)?.generation??0
  const historyEnd=world.history.at(-1)?.generation??0
  return <div className="app-shell">
    <header className="topbar" aria-hidden={experimentOpen||undefined}>
      <div className="brand"><div className="mark" aria-hidden="true">∿</div><div><h1>Evolution Field Lab</h1><p>Shape an ecosystem. Watch selection unfold.</p></div></div>
      <div className="top-actions"><button ref={experimentToggleRef} className="experiment-toggle" onClick={()=>{setPlaying(false);setSettingsOpen(false);setExperimentOpen(true)}} aria-haspopup="dialog"><span aria-hidden="true">◫</span> Experiment lab</button><button ref={settingsToggleRef} className="settings-toggle" onClick={()=>setSettingsOpen(v=>!v)} aria-expanded={settingsOpen} aria-controls="settings" aria-haspopup={isNarrow?'dialog':undefined}>
        <span aria-hidden="true">⚙</span> <span>Parameters</span>{dirty&&<><b aria-hidden="true">•</b><span className="sr-only">Unapplied parameter changes</span></>}
      </button></div>
    </header>
    <main aria-hidden={experimentOpen||undefined}>
      <section className="simulation-panel" aria-label="Simulation" aria-hidden={settingsOpen&&isNarrow||undefined}>
        <div className="arena-wrap">
          <ArenaCanvas world={world} revision={revision} selectedIndividualId={selectedIndividualId} onSelect={selectIndividual}/>
          <div className="arena-badge">GENERATION {world.generation}<small>{world.config.ecologyMode==='energy-regrowth'?`${world.food.length} food · ${world.environment.patches.reduce((sum,patch)=>sum+patch.stock,0)} patch stock`:`${world.food.length} / ${Math.round(world.environment.foodBudget)} seasonal food`}</small></div>
          <div className="arena-keys">
            <div className="state-key" role="group" aria-label="Creature action outline key"><strong>Outline = action · body color = speed</strong>{creatureStates.map(([state,metadata])=><span key={state}><i aria-hidden="true" style={{backgroundColor:metadata.color}}/>{metadata.label}</span>)}</div>
            <div className="legend"><span>Body color = speed</span><i/><small>slower</small><small>faster</small></div>
          </div>
          {extinct&&<div className="extinct" role="status"><strong>Population extinct</strong><span>Use Founder migration to rescue this run, or adjust the parameters and restart.</span></div>}
        </div>
        {selected&&<section className="inspector" aria-label={`Selected individual ${selected.individualId}`}>
          <div className="inspector-head"><div><h2>Individual {selected.individualId}</h2><p>Lineage {selected.lineageId} · parent {selected.parentIndividualId??'founder'} · born generation {selected.birthGeneration}</p></div><button onClick={()=>selectIndividual(null)} aria-label="Close individual inspector">×</button></div>
          <div className="inspector-grid"><dl><div><dt>Age</dt><dd>{selected.age} generations</dd></div><div><dt>Energy</dt><dd>{selected.energy.toFixed(1)}</dd></div><div><dt>Food</dt><dd>{selected.food}{world.config.ecologyMode==='classic'?' / 2':' collected'}</dd></div><div><dt>State</dt><dd>{CREATURE_STATE_METADATA[selected.home?'safe':selected.mode].label}</dd></div><div><dt>Target</dt><dd>{selected.targetType??'none'} {selected.targetId??''}</dd></div><div><dt>Attack ready</dt><dd>{selected.attackCooldownUntil<=world.dayTime?'now':`in ${(selected.attackCooldownUntil-world.dayTime).toFixed(2)}s`}</dd></div><div><dt>Memory</dt><dd>food {selected.memory.foodX===null?'none':'active'} · threat {selected.memory.threatX===null?'none':'active'}</dd></div></dl><dl>{(['speed','size','sense','aggression','caution','exploration']as BiologicalTrait[]).map(trait=><div key={trait}><dt>{trait}</dt><dd>{selected[trait].toFixed(3)}</dd></div>)}</dl></div>
          {selected.perceptionDiagnostics&&<div className="perception-summary" role="group" aria-label="Selected creature perception telemetry"><strong>Perception window {selected.perceptionDiagnostics.reactionWindow}</strong><span>Creatures {selected.perceptionDiagnostics.creatures.detected}/{selected.perceptionDiagnostics.creatures.total}</span><span>Food {selected.perceptionDiagnostics.food.detected}/{selected.perceptionDiagnostics.food.total}</span><span>Missed: {selected.perceptionDiagnostics.creatures.fov+selected.perceptionDiagnostics.food.fov} view · {selected.perceptionDiagnostics.creatures.occlusion+selected.perceptionDiagnostics.food.occlusion} blocked · {selected.perceptionDiagnostics.creatures.detection+selected.perceptionDiagnostics.food.detection} uncertain</span></div>}
          {selected.decisionSummary&&<div className="utility-breakdown"><strong>Decision: {selected.decisionSummary.chosen}</strong><span>{selected.decisionSummary.reason}</span><table><thead><tr><th>Candidate</th><th>Score</th><th>Reason</th></tr></thead><tbody>{selected.decisionSummary.candidates.map((candidate,i)=><tr key={`${candidate.type}-${candidate.targetId}-${i}`}><td>{candidate.type}</td><td>{candidate.score.toFixed(2)}</td><td>{candidate.reason}</td></tr>)}</tbody></table></div>}
        </section>}
        <div className="transport" role="group" aria-label="Playback controls">
          <button className="play" disabled={extinct} onClick={()=>setPlaying(v=>!v)} aria-label={extinct?'Playback unavailable: population extinct':playing?'Pause simulation':'Play simulation'}>{playing?'Ⅱ':'▶'}</button>
          <button onClick={step} disabled={extinct} aria-label="Pause and finish the current generation">Finish generation</button>
          <div className="day-progress" role="progressbar" aria-label="Current generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(world.dayTime/world.config.dayLength*100)}><i style={{width:`${world.dayTime/world.config.dayLength*100}%`}}/></div>
          <label className="speed-select">Playback speed <select value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
          <button className="reset" onClick={reset}>{dirty?'Apply & restart':'Restart run'}</button>
        </div>
        <div className="interventions" role="group" aria-label="Live ecological interventions">
          <span><strong>Live shocks</strong><small>No restart needed</small></span>
          <button onClick={()=>intervene('resource-bloom')} disabled={world.food.length>=MAX_FOOD} title={world.food.length>=MAX_FOOD?'Food is at the safety cap':'Add a deterministic pulse of food'}>Resource bloom</button>
          <button onClick={()=>intervene('drought')} disabled={!world.food.length} title={!world.food.length?'There is no food to remove':'Remove 40% of current food'}>Drought</button>
          <button onClick={()=>intervene('founder-migration')} disabled={living>=MAX_POPULATION} title={living>=MAX_POPULATION?'Population is at the safety cap':'Add up to eight genetically varied founders'}>Founder migration</button>
          <output aria-live="polite">{world.events.at(-1)?.summary??'The ecosystem is undisturbed.'}</output>
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
          <div className="mode-line activity-line" aria-label={`What creatures are doing now. ${living} living creatures total.`}><strong>What creatures are doing now</strong>{creatureStates.map(([state,metadata])=><span key={state}><i aria-hidden="true" style={{backgroundColor:metadata.color}}/><b>{stateCounts[state]}</b> {metadata.label.toLowerCase()}</span>)}</div>
          <div className="ecology-line" aria-label="Current model and energy statistics"><strong>{world.config.ecologyMode==='energy-regrowth'?'Ecological model':'Classic model'}</strong><span>{world.config.perceptionMode} perception</span><span>{world.config.predationMode} predation</span><span>mean energy <b>{stats.avgEnergy.toFixed(1)}</b></span><span>mean age <b>{stats.avgAge.toFixed(1)}</b></span><span>{world.dayFoodProduced} food added today</span>{world.dayFoodRemoved>0&&<span>{world.dayFoodRemoved} removed by drought</span>}</div>
          <div className="outcome-line" role="status">
            <strong>Previous generation</strong>
            {world.generation===1?<span>No outcome yet</span>:<>
              <span><b>{world.lastReport.survived}</b> survived</span><span><b>{world.lastReport.born}</b> born</span><span><b>{world.lastReport.hunted}</b> hunted</span><span><b>{world.lastReport.energy}</b> energy</span>{world.lastReport.aged>0&&<span><b>{world.lastReport.aged}</b> aged</span>}<span><b>{world.lastReport.unfed}</b> unfed</span><span><b>{world.lastReport.late}</b> late</span>{lastLedger&&<span><b>{lastLedger.attackSuccesses}/{lastLedger.attackAttempts}</b> attacks won</span>}{world.lastReport.capped>0&&<span><b>{world.lastReport.capped}</b> births capped</span>}
            </>}
          </div>
          <section className="evolution-story" aria-labelledby="evolution-story-title">
            <div className="story-head"><div><h2 id="evolution-story-title">Evolution story</h2><p>Who remains, and which traits selection favored most recently.</p></div><dl><div><dt>Living lineages</dt><dd>{lineage.livingLineages}</dd></div><div><dt>Effective diversity</dt><dd>{lineage.effectiveDiversity.toFixed(2)}</dd></div></dl></div>
            <div className="story-grid">
              <div><h3>Leading lineages</h3>{lineage.topLineages.length?<ol>{lineage.topLineages.map(item=><li key={item.lineageId}><span>Lineage {item.lineageId}</span><b>{item.count}</b><small>{Math.round(item.share*100)}%</small><i style={{width:`${item.share*100}%`}}/></li>)}</ol>:<p>No living lineages.</p>}</div>
              <div><h3>{lineage.latestGeneration===null?'Selection shifts':'Selection shifts · generation '+lineage.latestGeneration}</h3>{lineage.latestGeneration===null?<p>Finish a generation to compare starters, survivors, and reproducers.</p>:<ul>{[...lineage.selectionShifts].sort((a,b)=>Math.max(Math.abs(b.survivor??0),Math.abs(b.reproducer??0))-Math.max(Math.abs(a.survivor??0),Math.abs(a.reproducer??0))).slice(0,4).map(shift=><li key={shift.trait}><strong>{shift.trait}</strong><span>survivors {shift.survivor===null?'—':`${shift.survivor>=0?'+':''}${shift.survivor.toFixed(3)}`}</span><span>reproducers {shift.reproducer===null?'—':`${shift.reproducer>=0?'+':''}${shift.reproducer.toFixed(3)}`}</span></li>)}</ul>}</div>
              <div className="event-story"><h3>Latest ecosystem events</h3>{world.events.length?<ul>{world.events.slice(-3).reverse().map((event,index)=><li key={`${event.generation}-${event.day}-${event.kind}-${index}`}><span>Gen {event.generation} · day {event.day.toFixed(1)}</span><strong>{event.summary}</strong></li>)}</ul>:<p>Use a live shock to begin an intervention timeline.</p>}</div>
            </div>
          </section>
          <div className="insights">
            <div className="chart-card histogram-card"><div className="card-head"><div><h2>Current trait distribution</h2><p>Mean {distribution.mean.toFixed(2)} · median {distribution.median.toFixed(2)} · IQR {distribution.iqr.toFixed(2)} · SD {distribution.sd.toFixed(2)}</p></div><label className="metric-select">Metric <select value={distributionTrait} onChange={e=>setDistributionTrait(e.target.value as BiologicalTrait)}>{(['speed','size','sense','aggression','caution','exploration']as BiologicalTrait[]).map(trait=><option key={trait}>{trait}</option>)}</select></label></div><Histogram world={world} trait={distributionTrait}/></div>
            <div className="chart-card history-card"><div className="card-head"><div><h2>Generational history</h2><p>Separate scales keep unlike measures honest</p></div>{world.history.length>1&&<span>Gen {historyStart}–{historyEnd}</span>}</div><HistoryChart world={world}/></div>
            <div className="chart-card behavior-history-card"><div className="card-head"><div><h2>Behavior history</h2><p>Inherited tendencies, each on a 0–1 scale</p></div>{world.history.length>1&&<span>Gen {historyStart}–{historyEnd}</span>}</div><BehaviorHistory world={world}/></div>
          </div>
        </section>
      </section>
      {settingsOpen&&isNarrow&&<div className="settings-backdrop" aria-hidden="true" onMouseDown={closeSettings}/>}
      <aside ref={settingsRef} id="settings" className={`settings ${settingsOpen?'open':''}`} role={isNarrow?'dialog':'region'} aria-modal={isNarrow&&settingsOpen||undefined} aria-labelledby="settings-title">
        <div className="settings-head"><div><h2 id="settings-title">Experiment parameters</h2><p>Edits are staged until restart</p></div><button ref={settingsCloseRef} onClick={closeSettings} aria-label="Close parameters">×</button></div>
        <div className="seed-row"><label htmlFor="seed">Random seed</label><input id="seed" type="number" value={draft.seed} min="1" max="9999999" onChange={e=>{const value=e.currentTarget.valueAsNumber;update('seed',Number.isFinite(value)?Math.max(1,Math.min(9999999,Math.round(value))):defaultConfig.seed)}}/><button aria-label="Choose a new random seed" onClick={()=>update('seed',Math.floor(Math.random()*9999998)+1)}>↻</button></div>
        <div className="share-tools" role="group" aria-label="Experiment sharing and files">
          <button onClick={async()=>{try{await navigator.clipboard.writeText(experimentUrl(world.config,location.href));setActionStatus('Experiment link copied.')}catch{setActionStatus('Could not access the clipboard.')}}}>Copy experiment link</button>
          <button onClick={()=>{try{const blob=new Blob([exportExperiment(world.config)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`evolution-field-lab-seed-${world.config.seed}.json`;a.click();URL.revokeObjectURL(url);setActionStatus('Experiment exported.')}catch{setActionStatus('Could not export this experiment.')}}}>Export experiment</button>
          <button onClick={()=>importRef.current?.click()}>Import experiment</button>
          <input ref={importRef} className="sr-only" type="file" accept="application/json,.json" onChange={async e=>{try{const file=e.target.files?.[0];if(!file)return;if(file.size>MAX_EXPERIMENT_TEXT)throw new Error('too large');const imported=importExperiment(await file.text());if(!imported)throw new Error();setDraft(imported);setActionStatus('Experiment imported. Apply and restart to use it.')}catch{setActionStatus('Import failed: choose a valid experiment JSON file under 64 KB.')}finally{e.target.value=''}}}/>
        </div>
        <p className="action-status" role="status">{actionStatus}{runtimeMode==='fallback'?' Running in compatibility mode.':''}</p>
        <fieldset><legend>Simulation model</legend>
          <div className="model-presets" role="group" aria-label="Simulation model presets">
            <button aria-pressed={draft.ecologyMode==='energy-regrowth'&&draft.perceptionMode==='realistic'&&draft.predationMode==='contest'} onClick={()=>setDraft(config=>({...config,ecologyMode:'energy-regrowth',perceptionMode:'realistic',predationMode:'contest'}))}>Ecological</button>
            <button aria-pressed={draft.ecologyMode==='classic'&&draft.perceptionMode==='perfect'&&draft.predationMode==='threshold'} onClick={()=>setDraft(config=>({...config,ecologyMode:'classic',perceptionMode:'perfect',predationMode:'threshold'}))}>Classic</button>
          </div>
          <p className="model-note">Ecological uses energy carryover, regrowing patches, limited perception, and contested hunts. Classic preserves the original token rules.</p>
          <SelectControl label="Lifecycle & resources" value={draft.ecologyMode} onChange={value=>update('ecologyMode',value as Config['ecologyMode'])} options={[{value:'energy-regrowth',label:'Energy + patch regrowth'},{value:'classic',label:'Classic generation pulse'}]}/>
          <SelectControl label="Perception" value={draft.perceptionMode} onChange={value=>update('perceptionMode',value as Config['perceptionMode'])} options={[{value:'realistic',label:'Directional, delayed & occluded'},{value:'perfect',label:'Perfect local sensing'}]}/>
          <SelectControl label="Predation" value={draft.predationMode} onChange={value=>update('predationMode',value as Config['predationMode'])} options={[{value:'contest',label:'Contested attacks'},{value:'threshold',label:'Size-threshold attacks'}]}/>
        </fieldset>
        <fieldset><legend>World</legend>
          <NumberControl label="Initial population" value={draft.initialPopulation} min={5} max={120} step={1} onChange={v=>update('initialPopulation',v)}/>
          <NumberControl label="Food per generation" value={draft.foodPerDay} min={0} max={120} step={1} onChange={v=>update('foodPerDay',v)}/>
          <NumberControl label="Starting energy" value={draft.startingEnergy} min={30} max={250} step={5} onChange={v=>update('startingEnergy',v)}/>
          {draft.ecologyMode==='energy-regrowth'&&<details className="rule-tuning"><summary>Energy lifecycle tuning</summary>
            <NumberControl label="Food energy" value={draft.foodEnergy} min={0} max={100} step={1} onChange={v=>update('foodEnergy',v)}/>
            <NumberControl label="Energy retained" value={Math.round(draft.energyRetention*100)} min={0} max={100} step={5} unit="%" onChange={v=>update('energyRetention',v/100)}/>
            <NumberControl label="Reproduction energy cost" value={draft.reproductionEnergyCost} min={0} max={200} step={5} onChange={v=>update('reproductionEnergyCost',v)}/>
            <NumberControl label="Offspring energy" value={draft.offspringEnergy} min={10} max={250} step={5} onChange={v=>update('offspringEnergy',v)}/>
            <NumberControl label="Maximum age" value={draft.maxAge} min={1} max={80} step={1} unit=" gen" onChange={v=>update('maxAge',v)}/>
          </details>}
        </fieldset>
        <fieldset><legend>Starting traits</legend>
          <NumberControl label="Speed" value={draft.startSpeed} min={.3} max={2.5} step={.05} onChange={v=>update('startSpeed',v)}/>
          <NumberControl label="Size" value={draft.startSize} min={.4} max={2.2} step={.05} onChange={v=>update('startSize',v)}/>
          <NumberControl label="Sense radius" value={draft.startSense} min={.04} max={.5} step={.01} onChange={v=>update('startSense',v)}/>
          <div className="diversity-presets" role="group" aria-label="Founder diversity presets"><button onClick={()=>setDraft(c=>({...c,founderPhysicalVariation:0,founderBehaviorVariation:0}))}>Clonal</button><button onClick={()=>setDraft(c=>({...c,founderPhysicalVariation:.04,founderBehaviorVariation:.06}))}>Low diversity</button><button onClick={()=>setDraft(c=>({...c,founderPhysicalVariation:.16,founderBehaviorVariation:.2}))}>High diversity</button></div>
          <NumberControl label="Founder physical variation" value={draft.founderPhysicalVariation} min={0} max={.35} step={.01} onChange={v=>update('founderPhysicalVariation',v)}/>
          <NumberControl label="Founder behavior variation" value={draft.founderBehaviorVariation} min={0} max={.35} step={.01} onChange={v=>update('founderBehaviorVariation',v)}/>
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
          {draft.perceptionMode==='realistic'&&<details className="rule-tuning"><summary>Perception tuning</summary>
            <NumberControl label="Field of view" value={draft.fieldOfView} min={30} max={360} step={5} unit="°" onChange={v=>update('fieldOfView',v)}/>
            <NumberControl label="Detection falloff" value={Math.round(draft.detectionFalloff*100)} min={0} max={100} step={5} unit="%" onChange={v=>update('detectionFalloff',v/100)}/>
            <NumberControl label="Reaction interval" value={draft.reactionTime} min={0} max={2} step={.05} unit="s" onChange={v=>update('reactionTime',v)}/>
            <label className="check-control"><input type="checkbox" checked={draft.obstacleOcclusion} onChange={event=>update('obstacleOcclusion',event.target.checked)}/> Obstacles block sight</label>
          </details>}
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
          {draft.ecologyMode==='energy-regrowth'&&<details className="rule-tuning"><summary>Resource regrowth tuning</summary>
            <NumberControl label="Capacity per patch" value={draft.patchCapacity} min={1} max={180} step={1} onChange={v=>update('patchCapacity',v)}/>
            <NumberControl label="Regrowth rate" value={Math.round(draft.foodRegrowthRate*100)} min={0} max={100} step={1} unit="% / gen" onChange={v=>update('foodRegrowthRate',v/100)}/>
          </details>}
        </fieldset>
        <fieldset><legend>Selection pressures</legend>
          <NumberControl label="Predator size ratio" value={draft.predatorRatio} min={1.05} max={2} step={.05} unit="×" onChange={v=>update('predatorRatio',v)}/>
          <NumberControl label="Movement energy cost" value={draft.moveEnergyFactor} min={.1} max={2} step={.05} onChange={v=>update('moveEnergyFactor',v)}/>
          <NumberControl label="Sensing energy cost" value={draft.senseEnergyFactor} min={.05} max={1.5} step={.05} onChange={v=>update('senseEnergyFactor',v)}/>
          {draft.predationMode==='contest'&&<details className="rule-tuning"><summary>Attack contest tuning</summary>
            <NumberControl label="Prey energy reward" value={draft.preyEnergy} min={0} max={200} step={5} onChange={v=>update('preyEnergy',v)}/>
            <NumberControl label="Attack energy cost" value={draft.attackCost} min={0} max={50} step={1} onChange={v=>update('attackCost',v)}/>
            <NumberControl label="Handling time" value={draft.handlingTime} min={0} max={3} step={.05} unit="s" onChange={v=>update('handlingTime',v)}/>
            <NumberControl label="Contest sharpness" value={draft.contestSharpness} min={.1} max={12} step={.1} onChange={v=>update('contestSharpness',v)}/>
            <NumberControl label="Evasion weight" value={draft.evasionWeight} min={0} max={3} step={.05} onChange={v=>update('evasionWeight',v)}/>
          </details>}
        </fieldset>
        <details><summary>Rules of this ecosystem</summary><p>{draft.ecologyMode==='classic'?'One food brought home survives; two also produces one mutated offspring.':'Creatures survive by returning home with energy, retain part of it, pay to reproduce, age, and forage from patches that regrow during the generation.'} {draft.perceptionMode==='realistic'?'They react at intervals and can miss targets outside their view or behind obstacles.':'They sense every target inside their radius.'} {draft.predationMode==='contest'?'Eligible hunts are probabilistic contests shaped by size, speed, energy, aggression, and caution.':`Larger creatures instantly catch animals at least ${draft.predatorRatio.toFixed(2)}× smaller.`}</p></details>
        <button className="apply" onClick={()=>{reset();closeSettings()}} disabled={!dirty}>{dirty?'Apply parameters & restart':'No staged changes'}</button>
      </aside>
    </main>
    {experimentOpen&&<Suspense fallback={<div className="experiment-backdrop"><section className="experiment-panel" role="status">Opening Experiment Lab…</section></div>}><ExperimentPanel baseConfig={world.config} onClose={closeExperiment} onReplay={replayExperiment}/></Suspense>}
  </div>
}

export default App
