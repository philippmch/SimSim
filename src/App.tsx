import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ARENA_FOCUS_OPTIONS, ARENA_HUNT_CONTACT_KEY, ARENA_PATCH_STOCK_KEY, ARENA_QUICK_START, ARENA_SELECTED_OVERLAY_KEY, ArenaCanvas, arenaPlaybackStatus, CREATURE_STATE_METADATA, formatArenaDayProgress, formatArenaFocusDescription, formatArenaFocusOption, formatArenaPlaybackDetail, formatObservedPath, formatSelectedTarget, showArenaQuickStart } from './components/ArenaCanvas'
import type { ArenaPlaybackStatus, CreatureState } from './components/ArenaCanvas'
import { GenerationForecast } from './components/GenerationForecast'
import { createWorld, formatLatestWorldEvent, getLineageAnalytics, getModeCounts, getStats } from './simulation/engine'
import { MAX_FOOD,MAX_FOUNDER_MIGRATION_BATCH,MAX_POPULATION, sanitizeConfig } from './simulation/config'
import { createController } from './simulation/controller'
import type { SimulationController,SimulationSnapshotMeta } from './simulation/controller'
import { experimentUrl,loadInitialConfig,persistExperiment } from './simulation/share'
import type { Config,InterventionKind,LastInspectedOutcome, World } from './simulation/types'

const ExperimentPanel=lazy(()=>import('./components/ExperimentPanel').then(module=>({default:module.ExperimentPanel})))
const GenerationJournal=lazy(()=>import('./components/GenerationJournal'))
const InsightsPanel=lazy(()=>import('./components/InsightsPanel'))
const LivePulse=lazy(()=>import('./components/LivePulse'))
const TerminalOutcome=lazy(()=>import('./components/TerminalOutcome'))
const CreatureInspector=lazy(()=>import('./components/CreatureInspector'))
const PopulationStory=lazy(()=>import('./components/PopulationStory'))
const GenerationAccounting=lazy(()=>import('./components/GenerationAccounting'))
const ParametersPanel=lazy(()=>import('./components/ParametersPanel'))
const creatureStates=Object.entries(CREATURE_STATE_METADATA) as [CreatureState,(typeof CREATURE_STATE_METADATA)[CreatureState]][]

const copyConfig=(c:Config):Config=>({...c})

export function GenerationAccountingFallback(){
  return <><div className="ecology-line activity-line" aria-busy="true"><strong>Resource pressure</strong><span>Loading resource pressure…</span></div><div className="ecology-line activity-line" aria-busy="true"><strong>Generation accounting</strong><span>Loading generation accounting…</span></div></>
}

export function ParametersPanelFallback(){
  return <p className="action-status" role="status" aria-busy="true">Opening parameter controls…</p>
}

export function formatStepCompletion(world:World,meta:SimulationSnapshotMeta){
  const result=meta.stepResult
  if(!result)return''
  if(result.stop==='generation-boundary')return`Generation ${world.generation} started.`
  if(result.stop==='selected-inactive')return'Selected creature is no longer active; other active creatures remain.'
  if(result.stop==='no-active'){
    const livingCount=world.creatures.filter(creature=>creature.alive).length
    const status=arenaPlaybackStatus({playing:false,populationCount:world.creatures.length,activeCount:0})
    return formatArenaPlaybackDetail({status,populationCount:world.creatures.length,livingCount})
  }
  if(result.stop==='bounded')return'Reaction window bound reached.'
  return'Next action beat reached.'
}

export function formatPlaybackControlLabel(status:ArenaPlaybackStatus,playing:boolean):string{
  if(status==='Extinct')return'Playback unavailable: population extinct'
  if(status==='Awaiting settlement')return playing?'Pause playback before settlement':'Resume playback toward settlement'
  return playing?'Pause simulation':'Play simulation'
}

export function formatPlaybackPhaseAnnouncement(status:ArenaPlaybackStatus,detail:string,playing:boolean):string{
  if(status==='Extinct')return''
  if(status==='Awaiting settlement')return`${detail} ${playing?'Playback continues toward automatic settlement.':'Playback is paused before settlement.'}`
  return detail
}

export function PlaybackPhaseStatus({status,detail,playing,suppressed=false}:{status:ArenaPlaybackStatus;detail:string;playing:boolean;suppressed?:boolean}){
  return <span id="playback-phase-status" className="sr-only" role="status" aria-live="polite" aria-atomic="true">{suppressed?'':formatPlaybackPhaseAnnouncement(status,detail,playing)}</span>
}

export interface NextActionCopyInput {
  extinct: boolean
  hasActiveCreatures: boolean
  pending: boolean
  selectedIndividualId: number | null
  selectedIsActive: boolean
  livingCreatures: number
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
    ariaLabel: 'Next action unavailable during awaiting settlement; use Finish generation to settle this cohort',
    title: input.livingCreatures === 0
      ? 'All creatures in this generation are dead and awaiting settlement. Use Finish generation to record it, or use Founder migration to rescue the run.'
      : 'No active creature actions remain; use Finish generation to settle this cohort.',
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

export interface FounderMigrationCopyInput {
  livingCreatures: number
  liveConfig: Pick<Config, 'founderPhysicalVariation' | 'founderBehaviorVariation'>
}

export interface FounderMigrationCopy {
  available: number
  buttonLabel: string
  ariaLabel: string
  title: string
}

function clampFounderLivingCount(value: number): number {
  if (!Number.isFinite(value)) return MAX_POPULATION
  return Math.max(0, Math.min(MAX_POPULATION, Math.ceil(value)))
}

export function formatFounderMigrationCopy(input: FounderMigrationCopyInput): FounderMigrationCopy {
  const living = clampFounderLivingCount(input.livingCreatures)
  const available = Math.max(0, Math.min(MAX_FOUNDER_MIGRATION_BATCH, MAX_POPULATION - living))
  const clonal = input.liveConfig.founderPhysicalVariation === 0 && input.liveConfig.founderBehaviorVariation === 0
  const noun = available === 1 ? 'founder' : 'founders'
  const founderDescription = clonal ? `clonal ${noun}` : `${noun} with configured trait variation`
  const population = `population is at ${living}/${MAX_POPULATION}`
  if (available === 0) {
    return {
      available,
      buttonLabel: 'Founder migration (full)',
      ariaLabel: `Founder migration unavailable: ${population}; no ${founderDescription} can be added.`,
      title: `Population is at ${living}/${MAX_POPULATION}; no ${founderDescription} can be added.`,
    }
  }
  const description = `Add up to ${available} ${founderDescription}; ${population}.`
  return {
    available,
    buttonLabel: `Founder migration (up to ${available})`,
    ariaLabel: `Founder migration: ${description}`,
    title: description,
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

function App(){
  const initialRef=useRef<Config>(loadInitialConfig(window.location.search,(()=>{try{return window.localStorage}catch{return null}})()))
  const [draft,setDraft]=useState<Config>(()=>copyConfig(initialRef.current))
  const [world,setWorld]=useState<World>(()=>createWorld(initialRef.current))
  const controllerRef=useRef<SimulationController|null>(null)
  const [playing,setPlaying]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [speed,setSpeed]=useState(1),[revision,setRevision]=useState(0),[livePulseRun,setLivePulseRun]=useState(0)
  const [settingsOpen,setSettingsOpen]=useState(false)
  const [settingsPanelRequested,setSettingsPanelRequested]=useState(false)
  const [experimentOpen,setExperimentOpen]=useState(false)
  const [isNarrow,setIsNarrow]=useState(()=>window.matchMedia('(max-width: 1050px)').matches)
  const [arenaKeysOpen,setArenaKeysOpen]=useState(()=>!window.matchMedia('(max-width: 1050px)').matches)
  const settingsToggleRef=useRef<HTMLButtonElement>(null)
  const experimentToggleRef=useRef<HTMLButtonElement>(null)
  const settingsRef=useRef<HTMLElement>(null)
  const settingsCloseRef=useRef<HTMLButtonElement>(null)
  const [actionStatus,setActionStatus]=useState('')
  const suppressPlaybackAnnouncementRef=useRef(false)
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
  const activeCreatures=world.creatures.filter(c=>c.alive&&!c.home).length
  const arenaStatus=arenaPlaybackStatus({playing,populationCount:world.creatures.length,activeCount:activeCreatures})
  const arenaDetail=formatArenaPlaybackDetail({status:arenaStatus,populationCount:world.creatures.length,livingCount:living})
  const nextActionCopy=formatNextActionCopy({extinct,hasActiveCreatures,pending:stepPending,selectedIndividualId,selectedIsActive:Boolean(selected&&!selected.home),livingCreatures:living})
  const arenaDayLabel=formatArenaDayProgress(world.dayTime,world.config.dayLength,arenaStatus)
  const dayProgress=Math.max(0,Math.min(100,Math.round(world.dayTime/world.config.dayLength*100)))
  const founderMigrationCopy=formatFounderMigrationCopy({livingCreatures:living,liveConfig:world.config})
  const closeSettings=useCallback(()=>setSettingsOpen(false),[])
  const closeExperiment=useCallback(()=>{setExperimentOpen(false);requestAnimationFrame(()=>experimentToggleRef.current?.focus())},[])
  const replayExperiment=useCallback((config:Config)=>{setDraft(sanitizeConfig(config));setActionStatus('Control seed staged. Choose Apply & restart to replay it live.');setExperimentOpen(false);requestAnimationFrame(()=>experimentToggleRef.current?.focus())},[])
  const [terminalOutcome,setTerminalOutcome]=useState<LastInspectedOutcome|null>(null)
  const reset=useCallback(()=>{suppressPlaybackAnnouncementRef.current=false;pendingStepRef.current=null;setStepPending(false);const clean=sanitizeConfig(draft);setDraft(clean);setSelectedIndividualId(null);setTerminalOutcome(null);setRequestedGeneration(null);setObservedPath('Inspect a creature, then choose Next action to observe its perception and decision path.');persistExperiment(clean,(()=>{try{return localStorage}catch{return null}})());try{history.replaceState(null,'',experimentUrl(clean,location.href))}catch{/* URL unavailable */}const controller=controllerRef.current;if(controller){pendingPulseResetRef.current=true;controller.send({type:'reset',config:clean})}setPlaying(false);setActionStatus('Experiment applied and restarted.')},[draft])
  const applyParameters=useCallback(()=>{reset();closeSettings()},[reset,closeSettings])
  const finishGeneration=()=>{suppressPlaybackAnnouncementRef.current=false;const interrupted=pendingStepRef.current!==null;pendingStepRef.current=null;setStepPending(false);if(interrupted)setObservedPath('Manual step interrupted; choose Next action to retry.');setPlaying(false);controllerRef.current?.send({type:'finish'})}
  const nextAction=()=>{const controller=controllerRef.current;if(!controller||stepPending||pendingStepRef.current!==null)return;suppressPlaybackAnnouncementRef.current=false;const stepId=++nextStepIdRef.current;pendingStepRef.current=stepId;setStepPending(true);setObservedPath('Next action pending…');setPlaying(false);controller.send({type:'step',stepId})}
  const selectIndividual=(individualId:number|null)=>{setTerminalOutcome(null);setSelectedIndividualId(individualId);controllerRef.current?.send({type:'inspect',individualId})}
  const intervene=(kind:InterventionKind)=>{suppressPlaybackAnnouncementRef.current=false;controllerRef.current?.send({type:'intervene',kind});setActionStatus(kind==='resource-bloom'?'Resource bloom released.':kind==='drought'?'Drought applied.':'Founder migration released.')}

  const handleSnapshot=useCallback((nextWorld:World,meta?:SimulationSnapshotMeta)=>{setWorld(nextWorld);setRevision(n=>n+1);if(pendingPulseResetRef.current){pendingPulseResetRef.current=false;setLivePulseRun(n=>n+1)}if(pendingStepRef.current!==null&&meta?.stepResult&&meta.stepId===pendingStepRef.current){pendingStepRef.current=null;setStepPending(false);const stoppedWithoutActive=meta.stepResult.stop==='no-active';suppressPlaybackAnnouncementRef.current=stoppedWithoutActive;if(meta.stepContext)setObservedPath(formatObservedPath(nextWorld,meta.stepResult,meta.stepContext));else setObservedPath('Observed path unavailable; retry Next action.');setActionStatus(stoppedWithoutActive?'':formatStepCompletion(nextWorld,meta))}},[])
  const handleFallback=useCallback(()=>{suppressPlaybackAnnouncementRef.current=false;const interrupted=pendingStepRef.current!==null;pendingStepRef.current=null;setStepPending(false);if(interrupted){setObservedPath('Manual step interrupted; choose Next action to retry.');setActionStatus('Step interrupted; retry Next action.')}setRuntimeMode('fallback')},[])

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
      <div className="top-actions"><button ref={experimentToggleRef} className="experiment-toggle" onClick={()=>{setPlaying(false);setSettingsOpen(false);setExperimentOpen(true)}} aria-haspopup="dialog"><span aria-hidden="true">◫</span> Experiment lab</button><button ref={settingsToggleRef} className="settings-toggle" onClick={()=>{setSettingsPanelRequested(true);setSettingsOpen(v=>!v)}} aria-label={settingsOpen?'Close parameters':'Open parameters'} aria-expanded={settingsOpen} aria-controls="settings" aria-haspopup={isNarrow?'dialog':undefined}>
        <span aria-hidden="true">⚙</span> <span>Parameters</span>{dirty&&<><b aria-hidden="true">•</b><span className="sr-only">Unapplied parameter changes</span></>}
      </button></div>
    </header>
    <main aria-hidden={experimentOpen||undefined}>
      <section className="simulation-panel" aria-label="Simulation" aria-hidden={settingsOpen&&isNarrow||undefined}>
        <div className="arena-wrap">
          <ArenaCanvas world={world} revision={revision} selectedIndividualId={selectedIndividualId} onSelect={selectIndividual} arenaFocus={arenaFocus} playbackStatus={arenaStatus} playbackDetail={arenaDetail}/>
          <div className="arena-badge" style={{pointerEvents:'none'}}><strong>{arenaDayLabel}</strong><small>Generation {world.generation}</small><small>{world.config.ecologyMode==='energy-regrowth'?`${world.food.length} current food across ${world.environment.patches.length} resource patches`:`${world.food.length} current food`}</small>{showArenaQuickStart(world.ledger.length)&&ARENA_QUICK_START.map(line=><small key={line}>{line}</small>)}</div>
          <PlaybackPhaseStatus status={arenaStatus} detail={arenaDetail} playing={playing} suppressed={suppressPlaybackAnnouncementRef.current}/>
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
          <button className="play" disabled={extinct} onClick={()=>{suppressPlaybackAnnouncementRef.current=false;setPlaying(v=>!v)}} aria-label={formatPlaybackControlLabel(arenaStatus,playing)}>{playing?'Ⅱ':'▶'}</button>
          <button onClick={nextAction} disabled={nextActionUnavailable||stepPending} aria-label={nextActionCopy.ariaLabel} title={nextActionCopy.title}>{nextActionCopy.buttonLabel}</button>
          <button onClick={finishGeneration} disabled={extinct} aria-label="Pause and finish the current generation">Finish generation</button>
          <div className="day-progress" role="progressbar" aria-label="Current generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={dayProgress} aria-valuetext={arenaDayLabel}><i style={{width:`${dayProgress}%`}}/></div>
          <label className="speed-select">Playback speed <select value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
          <button className="reset" onClick={reset}>{dirty?'Apply & restart':'Restart run'}</button>
        </div>
        {arenaStatus==='Awaiting settlement'&&<div className="pending" aria-label="Settlement status">{arenaDetail}</div>}
        <div className="interventions" role="status" aria-live="polite" aria-label="Observed action path">
          <span><strong>Observed path</strong><small>Latest manual step</small></span>
          <output>{observedPath}</output>
        </div>
        <div className="interventions" role="group" aria-label="Live ecological interventions">
          <span><strong>Live shocks</strong><small>No restart needed</small></span>
          <button onClick={()=>intervene('resource-bloom')} disabled={world.food.length>=MAX_FOOD} title={world.food.length>=MAX_FOOD?'Food is at the safety cap':'Add a deterministic pulse of food'}>Resource bloom</button>
          <button onClick={()=>intervene('drought')} disabled={!world.food.length} title={!world.food.length?'There is no food to remove':'Remove 40% of current food'}>Drought</button>
          <button onClick={()=>intervene('founder-migration')} disabled={founderMigrationCopy.available===0} title={founderMigrationCopy.title} aria-label={founderMigrationCopy.ariaLabel}>{founderMigrationCopy.buttonLabel}</button>
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
          <GenerationForecast world={world} playbackStatus={arenaStatus}/>
          <Suspense fallback={<GenerationAccountingFallback/>}><GenerationAccounting world={world} globalFoodCap={MAX_FOOD}/></Suspense>
          <section id="generation-journal" tabIndex={-1} aria-label="Generation journal review"><Suspense fallback={<div className="evolution-story generation-journal" aria-busy="true"><p className="journal-empty" role="status">Opening generation journal…</p></div>}><GenerationJournal ledgers={world.ledger} events={world.events} requestedGeneration={requestedGeneration} onRequestedGenerationChange={setRequestedGeneration}/></Suspense></section>
          <Suspense fallback={<section className="evolution-story" aria-busy="true"><p className="journal-empty" role="status">Opening population story…</p></section>}><PopulationStory lineage={lineage}/></Suspense>
          <Suspense fallback={<section className="evolution-story generation-journal" aria-busy="true"><p className="journal-empty" role="status">Opening insights…</p></section>}><InsightsPanel world={world} requestedGeneration={requestedGeneration} onSelectGeneration={setRequestedGeneration}/></Suspense>
        </section>
      </section>
      {settingsOpen&&isNarrow&&<div className="settings-backdrop" aria-hidden="true" onMouseDown={closeSettings}/>}
      <aside ref={settingsRef} id="settings" className={`settings ${settingsOpen?'open':''}`} role={isNarrow?'dialog':'region'} aria-modal={isNarrow&&settingsOpen||undefined} aria-labelledby="settings-title">
        <div className="settings-head"><div><h2 id="settings-title">Experiment parameters</h2><p>Edits are staged until restart</p></div><button ref={settingsCloseRef} onClick={closeSettings} aria-label="Close parameters">×</button></div>
        {settingsPanelRequested&&<Suspense fallback={<ParametersPanelFallback/>}><ParametersPanel draft={draft} liveConfig={world.config} dirty={dirty} actionStatus={actionStatus} runtimeMode={runtimeMode} setDraft={setDraft} onStatusChange={setActionStatus} onApply={applyParameters}/></Suspense>}
      </aside>
    </main>
    {experimentOpen&&<Suspense fallback={<div className="experiment-backdrop"><section className="experiment-panel" role="status">Opening Experiment Lab…</section></div>}><ExperimentPanel baseConfig={world.config} onClose={closeExperiment} onReplay={replayExperiment}/></Suspense>}
  </div>
}

export default App
