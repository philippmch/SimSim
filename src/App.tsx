import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ARENA_FOCUS_OPTIONS, ARENA_HUNT_CONTACT_KEY, ARENA_PATCH_STOCK_KEY, ARENA_QUICK_START, ARENA_SELECTED_OVERLAY_KEY, ArenaCanvas, arenaPlaybackStatus, CREATURE_STATE_METADATA, formatArenaDayProgress, formatArenaFocusDescription, formatArenaFocusOption, formatObservedPath, formatSelectedTarget, showArenaQuickStart } from './components/ArenaCanvas'
import type { CreatureState } from './components/ArenaCanvas'
import { GenerationAccounting } from './components/GenerationAccounting'
import { GenerationForecast } from './components/GenerationForecast'
import { createWorld, formatLatestWorldEvent, getLineageAnalytics, getModeCounts, getStats } from './simulation/engine'
import { defaultConfig,MAX_FOOD,MAX_POPULATION, sanitizeConfig } from './simulation/config'
import { createController } from './simulation/controller'
import type { SimulationController,SimulationSnapshotMeta } from './simulation/controller'
import { experimentUrl,exportExperiment,importExperiment,loadInitialConfig,MAX_EXPERIMENT_TEXT,persistExperiment } from './simulation/share'
import type { Config,InterventionKind,LastInspectedOutcome, World } from './simulation/types'

const ExperimentPanel=lazy(()=>import('./components/ExperimentPanel').then(module=>({default:module.ExperimentPanel})))
const GenerationJournal=lazy(()=>import('./components/GenerationJournal'))
const InsightsPanel=lazy(()=>import('./components/InsightsPanel'))
const LivePulse=lazy(()=>import('./components/LivePulse'))
const TerminalOutcome=lazy(()=>import('./components/TerminalOutcome'))
const CreatureInspector=lazy(()=>import('./components/CreatureInspector'))
const PopulationStory=lazy(()=>import('./components/PopulationStory'))
const creatureStates=Object.entries(CREATURE_STATE_METADATA) as [CreatureState,(typeof CREATURE_STATE_METADATA)[CreatureState]][]

const copyConfig=(c:Config):Config=>({...c})

function formatStepCompletion(world:World,meta:SimulationSnapshotMeta){
  const result=meta.stepResult
  if(!result)return''
  if(result.stop==='generation-boundary')return`Generation ${world.generation} started.`
  if(result.stop==='selected-inactive')return'Selected creature is no longer active; other active creatures remain.'
  if(result.stop==='no-active')return'No active creatures remain.'
  if(result.stop==='bounded')return'Reaction window bound reached.'
  return'Next action beat reached.'
}

export interface NextActionCopyInput {
  extinct: boolean
  hasActiveCreatures: boolean
  pending: boolean
  selectedIndividualId: number | null
  selectedIsActive: boolean
}

export interface NextActionCopy {
  buttonLabel: string
  ariaLabel: string
  title: string
}

export function formatNextActionCopy(input: NextActionCopyInput): NextActionCopy {
  const subject = input.selectedIsActive && input.selectedIndividualId !== null && Number.isFinite(input.selectedIndividualId)
    ? `Individual ${input.selectedIndividualId}`
    : null
  if (input.extinct) return {
    buttonLabel: 'Population extinct',
    ariaLabel: 'Next action unavailable: population extinct',
    title: 'Population extinct; no next action is available.',
  }
  if (!input.hasActiveCreatures) return {
    buttonLabel: 'No active creatures',
    ariaLabel: 'Next action unavailable: no active living creatures',
    title: 'No active living creatures can take a next action.',
  }
  if (input.pending) return subject ? {
    buttonLabel: `Advancing to ${subject}'s next decision`,
    ariaLabel: `Advancing the simulation until ${subject} reaches its next action beat; other creatures may also move and react`,
    title: `Advancing the simulation until ${subject} reaches its next action beat.`,
  } : {
    buttonLabel: 'Next action pending',
    ariaLabel: 'Next action pending',
    title: 'Waiting for the current action beat to finish.',
  }
  if (subject) return {
    buttonLabel: `Advance until ${subject}'s next decision`,
    ariaLabel: `Pause and advance the simulation until ${subject} reaches its next action beat; other creatures may also move and react`,
    title: `Advance the simulation until ${subject} reaches its next decision beat; other creatures may also move and react.`,
  }
  return {
    buttonLabel: 'Advance action beat',
    ariaLabel: 'Pause and advance the simulation to the next action beat',
    title: 'Advance the simulation to the next decision beat.',
  }
}

export type TerminalOutcomeCreature=Pick<World['creatures'][number],'individualId'|'alive'|'deathCause'>

export interface TerminalOutcomeResolverInput{
  selectedIndividualId:number|null
  creatures:ReadonlyArray<TerminalOutcomeCreature>
  recordedOutcome:LastInspectedOutcome|null|undefined
  currentGeneration:number
}

const isTerminalOutcomeCause=(cause:unknown):cause is LastInspectedOutcome['cause']=>cause==='hunted'||cause==='energy'||cause==='unfed'||cause==='late'||cause==='aged'
const isGeneration=(value:number)=>Number.isInteger(value)&&value>=1

export function resolveTerminalOutcome(input:TerminalOutcomeResolverInput):LastInspectedOutcome|null{
  const selectedIndividualId=input.selectedIndividualId
  if(selectedIndividualId===null)return null
  const selected=input.creatures.find(creature=>creature.individualId===selectedIndividualId)
  if(selected?.alive)return null
  const recorded=input.recordedOutcome
  if(recorded&&recorded.individualId===selectedIndividualId&&isGeneration(recorded.generation)&&isGeneration(input.currentGeneration)&&recorded.generation<=input.currentGeneration&&isTerminalOutcomeCause(recorded.cause))return{...recorded}
  if(selected&&!selected.alive&&isTerminalOutcomeCause(selected.deathCause)&&isGeneration(input.currentGeneration))return{individualId:selectedIndividualId,generation:input.currentGeneration,cause:selected.deathCause}
  return null
}

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
  const [speed,setSpeed]=useState(1),[revision,setRevision]=useState(0),[livePulseRun,setLivePulseRun]=useState(0)
  const [settingsOpen,setSettingsOpen]=useState(false)
  const [experimentOpen,setExperimentOpen]=useState(false)
  const [isNarrow,setIsNarrow]=useState(()=>window.matchMedia('(max-width: 1050px)').matches)
  const [arenaKeysOpen,setArenaKeysOpen]=useState(()=>!window.matchMedia('(max-width: 1050px)').matches)
  const settingsToggleRef=useRef<HTMLButtonElement>(null)
  const experimentToggleRef=useRef<HTMLButtonElement>(null)
  const settingsRef=useRef<HTMLElement>(null)
  const settingsCloseRef=useRef<HTMLButtonElement>(null)
  const importRef=useRef<HTMLInputElement>(null)
  const [actionStatus,setActionStatus]=useState('')
  const [observedPath,setObservedPath]=useState('Inspect a creature, then choose Next action to observe its perception and decision path.')
  const [stepPending,setStepPending]=useState(false)
  const pendingStepRef=useRef<number|null>(null)
  const pendingPulseResetRef=useRef(false)
  const nextStepIdRef=useRef(0)
  const [runtimeMode,setRuntimeMode]=useState<'worker'|'fallback'>('worker')
  const [selectedIndividualId,setSelectedIndividualId]=useState<number|null>(null)
  const [arenaFocus,setArenaFocus]=useState<'all'|CreatureState>('all')
  const [requestedGeneration,setRequestedGeneration]=useState<number|null>(null)
  const dirty=JSON.stringify(draft)!==JSON.stringify(world.config)
  const living=world.creatures.filter(c=>c.alive).length
  const extinct=world.creatures.length===0
  const hasActiveCreatures=world.creatures.some(c=>c.alive&&!c.home)
  const nextActionUnavailable=!hasActiveCreatures
  const playingRef=useRef(playing);playingRef.current=playing
  const extinctRef=useRef(extinct);extinctRef.current=extinct
  const resumeOnVisibleRef=useRef(false)
  const stats=getStats(world)
  const modes=getModeCounts(world)
  const activeModeTotal=Object.values(modes).reduce((sum,count)=>sum+count,0)
  const stateCounts:Record<CreatureState,number>={safe:living-activeModeTotal,...modes}
  const arenaFocusCount=arenaFocus==='all'?living:stateCounts[arenaFocus]
  const lineage=getLineageAnalytics(world)
  const selected=world.creatures.find(c=>c.individualId===selectedIndividualId&&c.alive)
  const decisionTargetLabel=selected?.decisionSummary
    ? formatSelectedTarget({targetType:selected.decisionSummary.chosen,targetId:selected.decisionSummary.chosenTargetId??(selected.decisionSummary.chosen===selected.targetType?selected.targetId:null)},world.creatures,world.food)
    : undefined
  const selectedArenaState=selected?(selected.home?'safe':selected.mode):null
  const selectedOutsideArenaFocus=arenaFocus!=='all'&&selectedArenaState!==null&&selectedArenaState!==arenaFocus
  const nextActionCopy=formatNextActionCopy({extinct,hasActiveCreatures,pending:stepPending,selectedIndividualId,selectedIsActive:Boolean(selected&&!selected.home)})
  const arenaStatus=arenaPlaybackStatus(playing,extinct)
  const arenaDayLabel=formatArenaDayProgress(world.dayTime,world.config.dayLength,arenaStatus)
  const dayProgress=Math.max(0,Math.min(100,Math.round(world.dayTime/world.config.dayLength*100)))
  const update=<K extends keyof Config>(key:K,value:Config[K])=>setDraft(c=>({...c,[key]:value}))
  const closeSettings=useCallback(()=>setSettingsOpen(false),[])
  const closeExperiment=useCallback(()=>{setExperimentOpen(false);requestAnimationFrame(()=>experimentToggleRef.current?.focus())},[])
  const replayExperiment=useCallback((config:Config)=>{setDraft(sanitizeConfig(config));setActionStatus('Control seed staged. Choose Apply & restart to replay it live.');setExperimentOpen(false);requestAnimationFrame(()=>experimentToggleRef.current?.focus())},[])
  const [terminalOutcome,setTerminalOutcome]=useState<LastInspectedOutcome|null>(null)
  const reset=useCallback(()=>{pendingStepRef.current=null;setStepPending(false);const clean=sanitizeConfig(draft);setDraft(clean);setSelectedIndividualId(null);setTerminalOutcome(null);setRequestedGeneration(null);setObservedPath('Inspect a creature, then choose Next action to observe its perception and decision path.');persistExperiment(clean,(()=>{try{return localStorage}catch{return null}})());try{history.replaceState(null,'',experimentUrl(clean,location.href))}catch{/* URL unavailable */}const controller=controllerRef.current;if(controller){pendingPulseResetRef.current=true;controller.send({type:'reset',config:clean})}setPlaying(false);setActionStatus('Experiment applied and restarted.')},[draft])
  const finishGeneration=()=>{const interrupted=pendingStepRef.current!==null;pendingStepRef.current=null;setStepPending(false);if(interrupted)setObservedPath('Manual step interrupted; choose Next action to retry.');setPlaying(false);controllerRef.current?.send({type:'finish'})}
  const nextAction=()=>{const controller=controllerRef.current;if(!controller||stepPending||pendingStepRef.current!==null)return;const stepId=++nextStepIdRef.current;pendingStepRef.current=stepId;setStepPending(true);setObservedPath('Next action pending…');setPlaying(false);setActionStatus('Playback paused.');controller.send({type:'step',stepId})}
  const selectIndividual=(individualId:number|null)=>{setTerminalOutcome(null);setSelectedIndividualId(individualId);controllerRef.current?.send({type:'inspect',individualId})}
  const intervene=(kind:InterventionKind)=>{controllerRef.current?.send({type:'intervene',kind});setActionStatus(kind==='resource-bloom'?'Resource bloom released.':kind==='drought'?'Drought applied.':'Founder migration released.')}

  const handleSnapshot=useCallback((nextWorld:World,meta?:SimulationSnapshotMeta)=>{setWorld(nextWorld);setRevision(n=>n+1);if(pendingPulseResetRef.current){pendingPulseResetRef.current=false;setLivePulseRun(n=>n+1)}if(pendingStepRef.current!==null&&meta?.stepResult&&meta.stepId===pendingStepRef.current){pendingStepRef.current=null;setStepPending(false);if(meta.stepContext)setObservedPath(formatObservedPath(nextWorld,meta.stepResult,meta.stepContext));else setObservedPath('Observed path unavailable; retry Next action.');setActionStatus(formatStepCompletion(nextWorld,meta))}},[])
  const handleFallback=useCallback(()=>{const interrupted=pendingStepRef.current!==null;pendingStepRef.current=null;setStepPending(false);if(interrupted){setObservedPath('Manual step interrupted; choose Next action to retry.');setActionStatus('Step interrupted; retry Next action.')}setRuntimeMode('fallback')},[])

  useEffect(()=>{const controller=createController(initialRef.current,handleSnapshot,handleFallback);controllerRef.current=controller;setRuntimeMode(controller.mode);return()=>{controller.dispose();controllerRef.current=null}},[handleSnapshot,handleFallback])

  useEffect(()=>{
    const query=window.matchMedia('(max-width: 1050px)')
    const change=()=>{setIsNarrow(query.matches);setArenaKeysOpen(!query.matches)}
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
  useEffect(()=>{
    if(selectedIndividualId===null||world.creatures.some(creature=>creature.alive&&creature.individualId===selectedIndividualId))return
    setTerminalOutcome(resolveTerminalOutcome({selectedIndividualId,creatures:world.creatures,recordedOutcome:world.lastInspectedOutcome,currentGeneration:world.generation}))
    setSelectedIndividualId(null)
    if(world.inspectedIndividualId!==null)controllerRef.current?.send({type:'inspect',individualId:null})
  },[world,selectedIndividualId])

  return <div className="app-shell">
    <header className="topbar" aria-hidden={experimentOpen||(settingsOpen&&isNarrow)||undefined}>
      <div className="brand"><div className="mark" aria-hidden="true">∿</div><div><h1>Evolution Field Lab</h1><p>Shape an ecosystem. Watch selection unfold.</p></div></div>
      <div className="top-actions"><button ref={experimentToggleRef} className="experiment-toggle" onClick={()=>{setPlaying(false);setSettingsOpen(false);setExperimentOpen(true)}} aria-haspopup="dialog"><span aria-hidden="true">◫</span> Experiment lab</button><button ref={settingsToggleRef} className="settings-toggle" onClick={()=>setSettingsOpen(v=>!v)} aria-label={settingsOpen?'Close parameters':'Open parameters'} aria-expanded={settingsOpen} aria-controls="settings" aria-haspopup={isNarrow?'dialog':undefined}>
        <span aria-hidden="true">⚙</span> <span>Parameters</span>{dirty&&<><b aria-hidden="true">•</b><span className="sr-only">Unapplied parameter changes</span></>}
      </button></div>
    </header>
    <main aria-hidden={experimentOpen||undefined}>
      <section className="simulation-panel" aria-label="Simulation" aria-hidden={settingsOpen&&isNarrow||undefined}>
        <div className="arena-wrap">
          <ArenaCanvas world={world} revision={revision} selectedIndividualId={selectedIndividualId} onSelect={selectIndividual} arenaFocus={arenaFocus}/>
          <div className="arena-badge" style={{pointerEvents:'none'}}><strong>{arenaDayLabel}</strong><small>Generation {world.generation}</small><small>{world.config.ecologyMode==='energy-regrowth'?`${world.food.length} food across ${world.environment.patches.length} resource patches`:`${world.food.length} / ${Math.round(world.environment.foodBudget)} seasonal food`}</small>{showArenaQuickStart(world.ledger.length)&&ARENA_QUICK_START.map(line=><small key={line}>{line}</small>)}</div>
          <details className="arena-keys" style={{border:0,paddingTop:0,marginTop:0}} open={arenaKeysOpen||!isNarrow} onToggle={event=>{if(isNarrow)setArenaKeysOpen(event.currentTarget.open)}}>
            <summary className="state-key" aria-label={arenaKeysOpen?'Hide arena key':'Show arena key'} style={{display:isNarrow?'flex':'none',pointerEvents:'auto',touchAction:'manipulation',cursor:'pointer',listStyle:'none'}}>{arenaKeysOpen?'Hide key':'Show key'}</summary>
            <div className="state-key" role="group" aria-label="Creature action and overlay key"><strong>Outline = action · number = current count · body color = speed</strong>{world.config.ecologyMode==='energy-regrowth'&&<strong>{ARENA_PATCH_STOCK_KEY}</strong>}{selected&&<strong>{ARENA_SELECTED_OVERLAY_KEY}</strong>}{selected?.mode==='hunting'&&<strong>{ARENA_HUNT_CONTACT_KEY}</strong>}<label htmlFor="arena-focus" style={{pointerEvents:'auto',display:'inline-flex',alignItems:'center',gap:5,flexBasis:'100%',justifyContent:'flex-end',fontWeight:700}}><span>Focus</span><select id="arena-focus" aria-label="Focus creatures by current action" value={arenaFocus} onChange={event=>setArenaFocus(event.target.value as 'all'|CreatureState)} style={{pointerEvents:'auto',touchAction:'manipulation',minWidth:0,maxWidth:'170px',minHeight:'28px',fontSize:'10px',lineHeight:1.2,padding:'3px 5px',border:0,borderRadius:'5px',backgroundColor:'var(--paper)',color:'var(--ink)',colorScheme:'light dark'}}>{ARENA_FOCUS_OPTIONS.map(option=><option key={option.value} value={option.value}>{formatArenaFocusOption(option.value,option.value==='all'?living:stateCounts[option.value])}</option>)}</select></label><small style={{flexBasis:'100%',textAlign:'right',fontSize:'9px',lineHeight:1.35,color:arenaFocus==='all'?'#a7bbb2':'#f6dd83'}}>{formatArenaFocusDescription(arenaFocus,arenaFocusCount,living,selectedOutsideArenaFocus)}</small>{creatureStates.map(([state,metadata])=><span key={state}><i aria-hidden="true" style={{backgroundColor:metadata.color}}/><b>{stateCounts[state]}</b>{' '}{metadata.label}</span>)}</div>
            <div className="legend"><span>Body color = speed</span><i/><small>slower</small><small>faster</small></div>
          </details>
          {extinct&&<div className="extinct" role="status"><strong>Population extinct</strong><span>Use Founder migration to rescue this run, or adjust the parameters and restart.</span></div>}
        </div>
        {selected&&<Suspense fallback={<section className="inspector" aria-busy="true" aria-label={`Selected individual ${selected.individualId}`}><div className="inspector-head"><div><h2>Individual {selected.individualId}</h2><p>Opening individual details…</p></div><button type="button" onClick={()=>selectIndividual(null)} aria-label="Close individual inspector">×</button></div></section>}><CreatureInspector selected={selected} ecologyMode={world.config.ecologyMode} dayTime={world.dayTime} stateLabel={CREATURE_STATE_METADATA[selected.home?'safe':selected.mode].label} targetLabel={formatSelectedTarget(selected,world.creatures,world.food)} decisionTargetLabel={decisionTargetLabel} huntContactRule={ARENA_HUNT_CONTACT_KEY} onClose={()=>selectIndividual(null)}/></Suspense>}
        {terminalOutcome&&!selected&&<Suspense fallback={null}><TerminalOutcome outcome={terminalOutcome} onDismiss={()=>selectIndividual(null)}/></Suspense>}
        <div className="transport" role="group" aria-label="Playback controls">
          <button className="play" disabled={extinct} onClick={()=>setPlaying(v=>!v)} aria-label={extinct?'Playback unavailable: population extinct':playing?'Pause simulation':'Play simulation'}>{playing?'Ⅱ':'▶'}</button>
          <button onClick={nextAction} disabled={nextActionUnavailable||stepPending} aria-label={nextActionCopy.ariaLabel} title={nextActionCopy.title}>{nextActionCopy.buttonLabel}</button>
          <button onClick={finishGeneration} disabled={extinct} aria-label="Pause and finish the current generation">Finish generation</button>
          <div className="day-progress" role="progressbar" aria-label="Current generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={dayProgress} aria-valuetext={arenaDayLabel}><i style={{width:`${dayProgress}%`}}/></div>
          <label className="speed-select">Playback speed <select value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
          <button className="reset" onClick={reset}>{dirty?'Apply & restart':'Restart run'}</button>
        </div>
        <div className="interventions" role="status" aria-live="polite" aria-label="Observed action path">
          <span><strong>Observed path</strong><small>Latest manual step</small></span>
          <output>{observedPath}</output>
        </div>
        <div className="interventions" role="group" aria-label="Live ecological interventions">
          <span><strong>Live shocks</strong><small>No restart needed</small></span>
          <button onClick={()=>intervene('resource-bloom')} disabled={world.food.length>=MAX_FOOD} title={world.food.length>=MAX_FOOD?'Food is at the safety cap':'Add a deterministic pulse of food'}>Resource bloom</button>
          <button onClick={()=>intervene('drought')} disabled={!world.food.length} title={!world.food.length?'There is no food to remove':'Remove 40% of current food'}>Drought</button>
          <button onClick={()=>intervene('founder-migration')} disabled={living>=MAX_POPULATION} title={living>=MAX_POPULATION?'Population is at the safety cap':'Add up to eight genetically varied founders'}>Founder migration</button>
          <output aria-live="polite">{formatLatestWorldEvent(world.events.at(-1),world.generation)}</output>
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
          <Suspense fallback={<div className="ecology-line activity-line" role="group" aria-label="Live simulation pulse. Waiting for the next simulation update."><strong>Live pulse</strong><span>Waiting for the next simulation update.</span></div>}><LivePulse key={livePulseRun} world={world}/></Suspense>
          <div className="ecology-line" aria-label="Current model and energy statistics"><strong>{world.config.ecologyMode==='energy-regrowth'?'Ecological model':'Classic model'}</strong><span>{world.config.perceptionMode} perception</span><span>{world.config.predationMode} predation</span><span>mean energy <b>{stats.avgEnergy.toFixed(1)}</b></span><span>mean age <b>{stats.avgAge.toFixed(1)}</b></span></div>
          <GenerationForecast world={world}/>
          <GenerationAccounting world={world}/>
          <Suspense fallback={<section className="evolution-story generation-journal" aria-busy="true"><p className="journal-empty" role="status">Opening generation journal…</p></section>}><GenerationJournal ledgers={world.ledger} events={world.events} requestedGeneration={requestedGeneration} onRequestedGenerationChange={setRequestedGeneration}/></Suspense>
          <Suspense fallback={<section className="evolution-story" aria-busy="true"><p className="journal-empty" role="status">Opening population story…</p></section>}><PopulationStory lineage={lineage}/></Suspense>
          <Suspense fallback={<section className="evolution-story generation-journal" aria-busy="true"><p className="journal-empty" role="status">Opening insights…</p></section>}><InsightsPanel world={world} requestedGeneration={requestedGeneration} onSelectGeneration={setRequestedGeneration}/></Suspense>
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
          <NumberControl label={draft.predationMode==='contest'?'Contest size benchmark':'Predator size ratio'} value={draft.predatorRatio} min={1.05} max={2} step={.05} unit="×" onChange={v=>update('predatorRatio',v)}/>
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
        <details><summary>Rules of this ecosystem</summary><p>{draft.ecologyMode==='classic'?'One food brought home survives; two also produces one mutated offspring.':'Creatures survive by returning home with energy, retain part of it, pay to reproduce, age, and forage from patches that regrow during the generation.'} {draft.perceptionMode==='realistic'?'They react at intervals and can miss targets outside their view or behind obstacles.':'They sense every target inside their radius.'} {draft.predationMode==='contest'?`Hunters at least as large as their prey may attempt a contest. The ${draft.predatorRatio.toFixed(2)}× size benchmark sets the reference; raising it makes attacks harder. Speed, energy, aggression, and caution also shape the result.`:`Larger creatures instantly catch animals at least ${draft.predatorRatio.toFixed(2)}× smaller.`}</p></details>
        <button className="apply" onClick={()=>{reset();closeSettings()}} disabled={!dirty}>{dirty?'Apply parameters & restart':'No staged changes'}</button>
      </aside>
    </main>
    {experimentOpen&&<Suspense fallback={<div className="experiment-backdrop"><section className="experiment-panel" role="status">Opening Experiment Lab…</section></div>}><ExperimentPanel baseConfig={world.config} onClose={closeExperiment} onReplay={replayExperiment}/></Suspense>}
  </div>
}

export default App
