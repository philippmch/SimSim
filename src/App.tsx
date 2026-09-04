import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ARENA_FOCUS_OPTIONS, ARENA_HUNT_CONTACT_KEY, ARENA_PATCH_QUALITY_KEY, ARENA_PATCH_STOCK_KEY, ARENA_SELECTED_OVERLAY_KEY, arenaPlaybackStatus, CREATURE_STATE_METADATA, formatArenaDayProgress, formatArenaFocusDescription, formatArenaFocusOption, formatArenaPlaybackDetail, formatObservedPath, formatSelectedTarget, showArenaQuickStart } from './components/ArenaCanvasModel'
import type { ArenaPlaybackStatus, CreatureState } from './components/ArenaCanvasModel'
import { createWorld, getLineageAnalytics, getModeCounts, getStats } from './simulation/engine'
import { MAX_FOOD,MAX_FOUNDER_MIGRATION_BATCH,MAX_POPULATION, sanitizeConfig } from './simulation/config'
import { createController } from './simulation/controller'
import type { SimulationController,SimulationSnapshotMeta } from './simulation/controller'
import { experimentUrl,loadInitialConfig,persistExperiment } from './simulation/share'
import type { Config,InterventionKind,LastInspectedOutcome, World } from './simulation/types'
import type {StepActivityEvidence} from './components/ObservedStepStory'
import type {CreatureInspectorActionControls} from './components/CreatureInspector'
import DashboardNavigation, { DASHBOARD_SECTION_IDS, DASHBOARD_SECTION_SCROLL_STYLE, openDashboardSection } from './components/DashboardNavigation'

const ExperimentPanel=lazy(()=>import('./components/ExperimentPanel').then(module=>({default:module.ExperimentPanel})))
const ArenaCanvas=lazy(()=>import('./components/ArenaCanvasRenderer').then(module=>({default:module.ArenaCanvas})))
const ArenaActivitySpotlightKey=lazy(()=>import('./components/ArenaCanvasRenderer').then(module=>({default:module.ArenaActivitySpotlightKey})))
const GenerationJournal=lazy(()=>import('./components/GenerationJournal'))
const InsightsPanel=lazy(()=>import('./components/InsightsPanel'))
const LivePulse=lazy(()=>import('./components/LivePulse'))
const TerminalOutcome=lazy(()=>import('./components/TerminalOutcome'))
const CreatureInspector=lazy(()=>import('./components/CreatureInspector'))
const PopulationStory=lazy(()=>import('./components/PopulationStory'))
const GenerationHandoff=lazy(()=>import('./components/GenerationHandoff'))
const GenerationAccounting=lazy(()=>import('./components/GenerationAccounting'))
const SimulationActivity=lazy(()=>import('./components/SimulationActivity'))
const ObservedStepStory=lazy(()=>import('./components/ObservedStepStory'))
const FirstGenerationGuide=lazy(()=>import('./components/ObservedStepStory').then(module=>({default:module.FirstGenerationGuide})))
const InterventionFeed=lazy(()=>import('./components/InterventionFeed'))
const ParametersPanel=lazy(()=>import('./components/ParametersPanel'))
const ResourcePatchInspector=lazy(()=>import('./components/ResourcePatchInspector'))
const creatureStates=Object.entries(CREATURE_STATE_METADATA) as [CreatureState,(typeof CREATURE_STATE_METADATA)[CreatureState]][]

/** Reserve enough short-viewport room for the complete wrapped transport rail. */
export const COMPACT_TRANSPORT_QUERY = '(max-width: 720px)'
export const NARROW_ARENA_VIEWPORT_STYLE = {
  height: 'min(58svh, calc(100svh - 204px))',
  minHeight: 'min(390px, calc(100svh - 204px))',
} as const

export function ArenaViewport({ compact, children }: { compact: boolean; children?: ReactNode }) {
  return <div className="arena-wrap" style={compact ? NARROW_ARENA_VIEWPORT_STYLE : undefined}>{children}</div>
}

const copyConfig=(c:Config):Config=>({...c})

export const INITIAL_OBSERVED_PATH='Inspect a creature, then choose Next action to observe its perception and decision path.'

export interface ManualStepStoryState{
  visible:boolean
  observedPath:string
  evidence:StepActivityEvidence|null
}

export type ManualStepStoryTransition=
  | {type:'next-action'}
  | {type:'step-acknowledged';observedPath:string;evidence:StepActivityEvidence|null}
  | {type:'step-interrupted'}
  | {type:'generation-snapshot';previousGeneration:number;nextGeneration:number;finishAcknowledged?:boolean}
  | {type:'reset'}

export function initialManualStepStoryState():ManualStepStoryState{
  return{visible:false,observedPath:INITIAL_OBSERVED_PATH,evidence:null}
}

/** A delivered generation transition invalidates narration captured in the old cohort. */
export function isManualStepStoryGenerationBoundary(previousGeneration:unknown,nextGeneration:unknown):boolean{
  return typeof previousGeneration==='number'&&typeof nextGeneration==='number'&&Number.isSafeInteger(previousGeneration)&&Number.isSafeInteger(nextGeneration)&&nextGeneration>previousGeneration
}

export interface ManualStepStorySnapshotInput{
  previousGeneration:number
  nextGeneration:number
  finishAcknowledged:boolean
  stepAcknowledged:boolean
  stepObservedPath?:string
  stepEvidence?:StepActivityEvidence|null
}

/** Resolve one delivered snapshot before applying it, so a boundary wins over a step acknowledgement. */
export function resolveManualStepStoryTransition(input:ManualStepStorySnapshotInput):ManualStepStoryTransition|null{
  const boundary=isManualStepStoryGenerationBoundary(input.previousGeneration,input.nextGeneration)||input.finishAcknowledged
  if(boundary)return{type:'generation-snapshot',previousGeneration:input.previousGeneration,nextGeneration:input.nextGeneration,finishAcknowledged:input.finishAcknowledged}
  if(input.stepAcknowledged)return{type:'step-acknowledged',observedPath:input.stepObservedPath??'Observed path unavailable; retry Next action.',evidence:input.stepEvidence??null}
  return null
}

/** Keep manual-step visibility/evidence changes explicit and independent of React closure timing. */
export function transitionManualStepStoryState(state:ManualStepStoryState,transition:ManualStepStoryTransition):ManualStepStoryState{
  if(transition.type==='next-action')return{visible:true,observedPath:'Next action pending…',evidence:null}
  if(transition.type==='step-acknowledged')return{visible:true,observedPath:transition.observedPath,evidence:transition.evidence}
  if(transition.type==='step-interrupted')return{visible:true,observedPath:'Manual step interrupted; choose Next action to retry.',evidence:null}
  if(transition.type==='reset')return initialManualStepStoryState()
  if(isManualStepStoryGenerationBoundary(transition.previousGeneration,transition.nextGeneration)||transition.finishAcknowledged===true)return{visible:false,observedPath:INITIAL_OBSERVED_PATH,evidence:null}
  return state
}

/** Activity telemetry is an additive snapshot field; its presence selects the
 * modern single story while older snapshots retain the intervention fallback. */
export function hasOwnActivityField(value:unknown):boolean{
  if(value===null||(typeof value!=='object'&&typeof value!=='function'))return false
  try{return Object.prototype.hasOwnProperty.call(value,'activity')}catch{return false}
}

export function GenerationAccountingFallback(){
  return <><div className="ecology-line activity-line" aria-busy="true"><strong>Resource pressure</strong><span>Loading resource pressure…</span></div><div className="ecology-line activity-line" aria-busy="true"><strong>Generation accounting</strong><span>Loading generation accounting…</span></div></>
}

export function GenerationHandoffFallback(){
  return <div className="interventions" role="group" aria-label="Generation handoff" aria-busy="true">
    <span><strong>Generation handoff</strong><small>Opening current state, settlement preview, and latest recorded result…</small></span>
    <span style={{ flex: '1 1 100%', whiteSpace: 'normal', color: 'var(--muted)' }}>Finish generation remains available above; the handoff will appear as soon as it loads.</span>
  </div>
}

export function ParametersPanelFallback(){
  return <p className="action-status" role="status" aria-busy="true">Opening parameter controls…</p>
}

export function SimulationActivityFallback(){
  return <div className="interventions" role="group" aria-label="What happened" aria-busy="true"><span><strong>What happened</strong><small>Opening retained run moments…</small></span></div>
}

export function ResourcePatchInspectorFallback(){
  return <section className="inspector" aria-label="Selected resource patch" aria-busy="true"><div className="inspector-head"><div><h2>Resource patch</h2><p>Opening live patch details…</p></div></div></section>
}

export function ObservedStepStoryFallback({observedPath}:{observedPath:string}){
  return <div className="interventions" role="group" aria-label="Latest manual action" aria-busy="true"><span><strong>Observed path</strong><small>Opening step details…</small></span><output role="status" aria-live="polite" aria-atomic="true">{observedPath}</output></div>
}

export interface SelectedInspectorShellProps {
  selected: Pick<World['creatures'][number], 'individualId'|'lineageId'|'parentIndividualId'|'birthGeneration'>
  actionControls: CreatureInspectorActionControls
  onClose: () => void
  children: ReactNode
}

/** Keep selection chrome and actions mounted while dense details load lazily. */
export function SelectedInspectorShell({selected,actionControls,onClose,children}:SelectedInspectorShellProps){
  return <section className="inspector" aria-label={`Selected individual ${selected.individualId}`}>
    <div className="inspector-head"><div><h2>Individual {selected.individualId}</h2><p>Lineage {selected.lineageId} · parent {selected.parentIndividualId??'founder'} · born generation {selected.birthGeneration}</p></div><button type="button" onClick={onClose} aria-label="Close individual inspector">×</button></div>
    <div className="interventions" role="group" aria-label="Continue simulation from selected individual details" style={{margin:'10px 0 0',alignItems:'stretch'}}>
      <span><strong>Continue observing</strong><small>Same simulation controls as above</small></span>
      <button type="button" onClick={actionControls.nextAction} disabled={actionControls.nextActionDisabled} aria-label={actionControls.nextActionAriaLabel} title={actionControls.nextActionTitle}>{actionControls.nextActionLabel}</button>
      <button type="button" onClick={actionControls.finishGeneration} disabled={actionControls.finishGenerationDisabled} aria-label={actionControls.finishGenerationAriaLabel} title={actionControls.finishGenerationTitle}>{actionControls.finishGenerationLabel??'Finish generation'}</button>
    </div>
    <Suspense fallback={<p className="utility-breakdown" aria-busy="true"><strong>Individual details</strong><span style={{display:'block',marginLeft:0}}>Opening individual details…</span></p>}>{children}</Suspense>
  </section>
}

export function InterventionFeedFallback(){
  return <div className="interventions" role="group" aria-label="Recent shocks" aria-busy="true"><span><strong style={{fontSize:12}}>Recent shocks</strong><small style={{fontSize:10}}>Opening recorded shocks…</small></span></div>
}

/** Keep the above-fold arena footprint and explain the short renderer load. */
export function ArenaCanvasFallback(){
  return <div className="arena" data-arena-canvas-fallback="true" role="status" aria-label="Live simulation arena" aria-busy="true" style={{width:'100%',height:'100%',display:'grid',placeItems:'center',boxSizing:'border-box',padding:'24px',background:'linear-gradient(135deg,#234c3c,#183228)',color:'#d9e5dd',textAlign:'center'}}><span style={{display:'grid',gap:'5px',maxWidth:'260px'}}><strong>Opening live arena…</strong><small style={{color:'#a7bbb2'}}>Creature positions and action paths will appear shortly.</small></span></div>
}

export interface SimulationEventStoryProps {
  world: World
  selectedIndividualId?: number | null
  onShowIndividual?: (individualId:number)=>void
  suppressAnnouncementSequence?:number|null
}

export function SimulationEventStory({world,selectedIndividualId,onShowIndividual,suppressAnnouncementSequence}:SimulationEventStoryProps){
  return hasOwnActivityField(world)
    ? <Suspense fallback={<SimulationActivityFallback/>}><SimulationActivity world={world} selectedIndividualId={selectedIndividualId} onShowIndividual={onShowIndividual} suppressAnnouncementSequence={suppressAnnouncementSequence}/></Suspense>
    : <Suspense fallback={<InterventionFeedFallback/>}><InterventionFeed events={world.events}/></Suspense>
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

export function stepActivityAnnouncementSequence(evidence:StepActivityEvidence|null):number|null{
  const window=evidence?.window
  return window&&!window.sequenceReset&&window.recordedCount>0&&window.recordedCount===window.endSequence-window.startSequence&&evidence.activity.some(entry=>entry.sequence===window.endSequence)?window.endSequence:null
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

export interface SettlementReviewNavigationOptions {
  onSelectGeneration:(generation:number)=>void
  loadReviewHelper?:()=>Promise<()=>boolean|Promise<boolean>>
  fallbackNavigate?:()=>boolean|Promise<boolean>
}

/**
 * Select a settlement before loading the journal's exact review focus helper.
 * The dynamic import keeps Charts out of startup; the stable section jump is
 * a safe fallback if that lazy helper cannot load or complete.
 */
export async function reviewSettlementAndNavigate(generation:unknown,options:SettlementReviewNavigationOptions):Promise<boolean>{
  if(typeof generation!=='number'||!Number.isSafeInteger(generation)||generation<1||generation>=Number.MAX_SAFE_INTEGER)return false
  options.onSelectGeneration(generation)
  const loadReviewHelper=options.loadReviewHelper??(async()=>{
    const module=await import('./components/Charts')
    return module.openGenerationJournalReview
  })
  try{
    const openReview=await loadReviewHelper()
    if(typeof openReview==='function'&&await openReview())return true
  }catch{/* Fall back to the stable section target. */}
  const fallbackNavigate=options.fallbackNavigate??(()=>openDashboardSection(DASHBOARD_SECTION_IDS.generationJournal))
  try{return Boolean(await fallbackNavigate())}catch{return false}
}

export function PlaybackPhaseStatus({status,detail,playing,suppressed=false}:{status:ArenaPlaybackStatus;detail:string;playing:boolean;suppressed?:boolean}){
  return <span id="playback-phase-status" className="sr-only" role="status" aria-live="polite" aria-atomic="true">{suppressed?'':formatPlaybackPhaseAnnouncement(status,detail,playing)}</span>
}

export type PendingSimulationCommandKind='step'|'finish'
export interface PendingSimulationCommand {kind:PendingSimulationCommandKind;id:number}

/** Both transport commands share one in-flight slot; this guard is synchronous. */
export function canStartSimulationCommand(pending:PendingSimulationCommand|null):boolean{return pending===null}

/** A command clears only on its own acknowledgement, never on a stale/wrong-kind event. */
export function simulationCommandAcknowledged(pending:PendingSimulationCommand|null,meta:SimulationSnapshotMeta|undefined):boolean{
  if(!pending)return false
  return pending.kind==='step'?meta?.stepId===pending.id:meta?.finishId===pending.id
}

export interface NextActionCopyInput {
  extinct: boolean
  hasActiveCreatures: boolean
  pending: boolean
  pendingCommand?: PendingSimulationCommandKind
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
  if (input.pending && input.pendingCommand === 'finish') return {
    buttonLabel: 'Finishing generation…',
    ariaLabel: 'Finish generation pending; wait for the current cohort to settle',
    title: 'Finish generation is in progress; wait for settlement before starting another action.',
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

/** Keep the primary step control compact enough to share the first mobile row. */
export function formatCompactNextActionLabel(input: NextActionCopyInput): string {
  if (input.extinct) return 'Extinct'
  if (input.pending && input.pendingCommand === 'finish') return 'Finishing…'
  if (!input.hasActiveCreatures) return 'No actions'
  const selected = input.selectedIsActive && input.selectedIndividualId !== null && Number.isFinite(input.selectedIndividualId)
  if (input.pending) return selected ? 'Advancing selected…' : 'Advancing…'
  return selected ? 'Next selected' : 'Next action'
}

export interface SelectedInspectorFocusInput {
  requestedIndividualId: number | null
  selectedIndividualId: number | null
  inspectorRendered: boolean
}

/** Focus only a matching inspector requested by an intentional selection. */
export function shouldFocusSelectedInspector(input: SelectedInspectorFocusInput): boolean {
  return input.inspectorRendered
    && input.requestedIndividualId !== null
    && input.requestedIndividualId === input.selectedIndividualId
}

export interface ResourcePatchInspectorFocusInput {
  requestedPatchId: number | null
  selectedPatchId: number | null
  inspectorRendered: boolean
}

/** Focus patch details once, only after an intentional matching selection. */
export function shouldFocusResourcePatchInspector(input: ResourcePatchInspectorFocusInput): boolean {
  return input.inspectorRendered
    && input.requestedPatchId !== null
    && input.requestedPatchId === input.selectedPatchId
}

export type ArenaInspectionRequest =
  | { kind: 'creature'; individualId: number | null }
  | { kind: 'patch'; patchId: number | null }

export interface ArenaInspectionTransitionInput {
  request: ArenaInspectionRequest
  validPatchIds: ReadonlyArray<number>
  currentSelectedIndividualId: number | null
  workerInspectedIndividualId: number | null
}

export interface ArenaInspectionTransition {
  selectedIndividualId: number | null
  selectedPatchId: number | null
  workerCommand: { type: 'inspect'; individualId: number | null } | null
}

/** Keep local inspection state exclusive and emit at most one worker command. */
export function resolveArenaInspectionTransition(input: ArenaInspectionTransitionInput): ArenaInspectionTransition {
  if (input.request.kind === 'creature') {
    return {
      selectedIndividualId: input.request.individualId,
      selectedPatchId: null,
      workerCommand: { type: 'inspect', individualId: input.request.individualId },
    }
  }
  const requestedPatchId = input.request.patchId
  const selectedPatchId = requestedPatchId !== null
    && Number.isSafeInteger(requestedPatchId)
    && input.validPatchIds.includes(requestedPatchId)
    ? requestedPatchId
    : null
  const shouldClearWorker = selectedPatchId !== null
    || input.currentSelectedIndividualId !== null
    || input.workerInspectedIndividualId !== null
  return {
    selectedIndividualId: null,
    selectedPatchId,
    workerCommand: shouldClearWorker ? { type: 'inspect', individualId: null } : null,
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
const requestedSettlementRevealGeneration=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<Number.MAX_SAFE_INTEGER?value:null

export function resolveAcknowledgedFinishGeneration(pendingFinishId:number|null,meta:SimulationSnapshotMeta|undefined,ledgers:World['ledger']){
  if(pendingFinishId===null||meta?.finishId!==pendingFinishId)return null
  return requestedSettlementRevealGeneration(ledgers.at(-1)?.generation)
}

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
  const [compactTransport,setCompactTransport]=useState(()=>window.matchMedia(COMPACT_TRANSPORT_QUERY).matches)
  const [arenaKeysOpen,setArenaKeysOpen]=useState(()=>!window.matchMedia('(max-width: 1050px)').matches)
  const settingsToggleRef=useRef<HTMLButtonElement>(null)
  const experimentToggleRef=useRef<HTMLButtonElement>(null)
  const settingsRef=useRef<HTMLElement>(null)
  const settingsCloseRef=useRef<HTMLButtonElement>(null)
  const selectedInspectorRef=useRef<HTMLDivElement>(null)
  const selectedPatchInspectorRef=useRef<HTMLDivElement>(null)
  const terminalOutcomeRef=useRef<HTMLDivElement>(null)
  const selectedInspectorFocusRequestRef=useRef<number|null>(null)
  const selectedPatchInspectorFocusRequestRef=useRef<number|null>(null)
  const terminalOutcomeFocusRequestRef=useRef<number|null>(null)
  const selectedIndividualIdRef=useRef<number|null>(null)
  const activityFocusRequestRef=useRef(0)
  const [actionStatus,setActionStatus]=useState('')
  const suppressPlaybackAnnouncementRef=useRef(false)
  const [manualStepStory,setManualStepStory]=useState<ManualStepStoryState>(()=>initialManualStepStoryState())
  const deliveredGenerationRef=useRef(world.generation)
  const [pendingCommand,setPendingCommand]=useState<PendingSimulationCommand|null>(null)
  const pendingCommandRef=useRef<PendingSimulationCommand|null>(null)
  const pendingPulseResetRef=useRef(false)
  const nextStepIdRef=useRef(0)
  const nextFinishIdRef=useRef(0)
  const [runtimeMode,setRuntimeMode]=useState<'worker'|'fallback'>('worker')
  const [selectedIndividualId,setSelectedIndividualId]=useState<number|null>(null)
  const [selectedPatchId,setSelectedPatchId]=useState<number|null>(null)
  selectedIndividualIdRef.current=selectedIndividualId
  const [arenaFocus,setArenaFocus]=useState<'all'|CreatureState>('all')
  const [requestedGeneration,setRequestedGeneration]=useState<number|null>(null)
  const [generationRevealRequest,setGenerationRevealRequest]=useState<number|null>(null)
  const observedPath=manualStepStory.observedPath
  const stepActivityEvidence=manualStepStory.evidence
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
  const selectedPatch=world.environment.patches.find(patch=>patch.id===selectedPatchId)
  const decisionTargetLabel=selected?.decisionSummary
    ? formatSelectedTarget({targetType:selected.decisionSummary.chosen,targetId:selected.decisionSummary.chosenTargetId??(selected.decisionSummary.chosen===selected.targetType?selected.targetId:null)},world.creatures,world.food)
    : undefined
  const selectedArenaState=selected?(selected.home?'safe':selected.mode):null
  const selectedOutsideArenaFocus=arenaFocus!=='all'&&selectedArenaState!==null&&selectedArenaState!==arenaFocus
  const activeCreatures=world.creatures.filter(c=>c.alive&&!c.home).length
  const arenaStatus=arenaPlaybackStatus({playing,populationCount:world.creatures.length,activeCount:activeCreatures})
  const arenaDetail=formatArenaPlaybackDetail({status:arenaStatus,populationCount:world.creatures.length,livingCount:living})
  const nextActionInput:NextActionCopyInput={extinct,hasActiveCreatures,pending:pendingCommand!==null,pendingCommand:pendingCommand?.kind,selectedIndividualId,selectedIsActive:Boolean(selected&&!selected.home),livingCreatures:living},nextActionCopy=formatNextActionCopy(nextActionInput)
  const stepAnnouncementSequence=stepActivityAnnouncementSequence(stepActivityEvidence)
  const arenaDayLabel=formatArenaDayProgress(world.dayTime,world.config.dayLength,arenaStatus)
  const dayProgress=Math.max(0,Math.min(100,Math.round(world.dayTime/world.config.dayLength*100)))
  const founderMigrationCopy=formatFounderMigrationCopy({livingCreatures:living,liveConfig:world.config})
  const closeSettings=useCallback(()=>setSettingsOpen(false),[])
  const closeExperiment=useCallback(()=>{setExperimentOpen(false);requestAnimationFrame(()=>experimentToggleRef.current?.focus())},[])
  const replayExperiment=useCallback((config:Config)=>{setDraft(sanitizeConfig(config));setActionStatus('Control seed staged. Choose Apply & restart to replay it live.');setExperimentOpen(false);requestAnimationFrame(()=>experimentToggleRef.current?.focus())},[])
  const [terminalOutcome,setTerminalOutcome]=useState<LastInspectedOutcome|null>(null)
  const reset=useCallback(()=>{suppressPlaybackAnnouncementRef.current=false;pendingCommandRef.current=null;setPendingCommand(null);selectedInspectorFocusRequestRef.current=null;selectedPatchInspectorFocusRequestRef.current=null;terminalOutcomeFocusRequestRef.current=null;activityFocusRequestRef.current++;const clean=sanitizeConfig(draft);deliveredGenerationRef.current=1;setDraft(clean);setSelectedIndividualId(null);setSelectedPatchId(null);setTerminalOutcome(null);setRequestedGeneration(null);setGenerationRevealRequest(null);setManualStepStory(()=>initialManualStepStoryState());persistExperiment(clean,(()=>{try{return localStorage}catch{return null}})());try{history.replaceState(null,'',experimentUrl(clean,location.href))}catch{/* URL unavailable */}const controller=controllerRef.current;if(controller){pendingPulseResetRef.current=true;controller.send({type:'reset',config:clean})}setPlaying(false);setActionStatus('Experiment applied and restarted.')},[draft])
  const applyParameters=useCallback(()=>{reset();closeSettings()},[reset,closeSettings])
  const rememberSelectedInspectorFocus=()=>{const individualId=selectedIndividualIdRef.current;terminalOutcomeFocusRequestRef.current=individualId!==null&&Boolean(selectedInspectorRef.current?.contains(document.activeElement))?individualId:null}
  const finishGeneration=()=>{const controller=controllerRef.current;if(!controller||extinct||!canStartSimulationCommand(pendingCommandRef.current))return;rememberSelectedInspectorFocus();suppressPlaybackAnnouncementRef.current=false;const finishId=++nextFinishIdRef.current;const pending:{kind:'finish';id:number}={kind:'finish',id:finishId};pendingCommandRef.current=pending;setPendingCommand(pending);setPlaying(false);controller.send({type:'finish',finishId})}
  const nextAction=()=>{const controller=controllerRef.current;if(!controller||extinct||nextActionUnavailable||!canStartSimulationCommand(pendingCommandRef.current))return;rememberSelectedInspectorFocus();suppressPlaybackAnnouncementRef.current=false;const stepId=++nextStepIdRef.current;const pending:{kind:'step';id:number}={kind:'step',id:stepId};pendingCommandRef.current=pending;setPendingCommand(pending);setManualStepStory(state=>transitionManualStepStoryState(state,{type:'next-action'}));setPlaying(false);controller.send({type:'step',stepId})}
  const selectIndividual=(individualId:number|null)=>{const transition=resolveArenaInspectionTransition({request:{kind:'creature',individualId},validPatchIds:world.environment.patches.map(patch=>patch.id),currentSelectedIndividualId:selectedIndividualId,workerInspectedIndividualId:world.inspectedIndividualId});activityFocusRequestRef.current++;selectedInspectorFocusRequestRef.current=transition.selectedIndividualId;selectedPatchInspectorFocusRequestRef.current=null;terminalOutcomeFocusRequestRef.current=null;setTerminalOutcome(null);setSelectedPatchId(transition.selectedPatchId);setSelectedIndividualId(transition.selectedIndividualId);if(transition.workerCommand)controllerRef.current?.send(transition.workerCommand)}
  const selectPatch=(patchId:number|null)=>{const transition=resolveArenaInspectionTransition({request:{kind:'patch',patchId},validPatchIds:world.environment.patches.map(patch=>patch.id),currentSelectedIndividualId:selectedIndividualId,workerInspectedIndividualId:world.inspectedIndividualId});activityFocusRequestRef.current++;selectedInspectorFocusRequestRef.current=null;selectedPatchInspectorFocusRequestRef.current=transition.selectedPatchId;terminalOutcomeFocusRequestRef.current=null;setTerminalOutcome(null);setSelectedIndividualId(transition.selectedIndividualId);setSelectedPatchId(transition.selectedPatchId);if(transition.workerCommand)controllerRef.current?.send(transition.workerCommand)}
  const focusArenaInspectionControl=()=>{const target=document.getElementById('arena-creature-picker') as HTMLSelectElement|null;if(!target)return;try{target.closest('.arena-wrap')?.scrollIntoView({block:'center',inline:'nearest'})}catch{/* A legacy browser may not support options. */}try{target.focus({preventScroll:true})}catch{target.focus()}}
  const restoreArenaInspectionFocus=()=>typeof window.requestAnimationFrame==='function'?window.requestAnimationFrame(focusArenaInspectionControl):focusArenaInspectionControl()
  const closeSelectedPatch=()=>{selectPatch(null);restoreArenaInspectionFocus()}
  const showActivityIndividual=(individualId:number)=>{if(!Number.isSafeInteger(individualId)||individualId<1||!world.creatures.some(creature=>creature.alive&&creature.individualId===individualId))return;selectedInspectorFocusRequestRef.current=null;selectedPatchInspectorFocusRequestRef.current=null;activityFocusRequestRef.current++;const request=activityFocusRequestRef.current;setTerminalOutcome(null);setSelectedPatchId(null);setSelectedIndividualId(individualId);setArenaFocus('all');controllerRef.current?.send({type:'inspect',individualId});const focusArena=()=>{if(activityFocusRequestRef.current!==request)return;focusArenaInspectionControl()};if(typeof window.requestAnimationFrame==='function')window.requestAnimationFrame(focusArena);else focusArena()}
  const intervene=(kind:InterventionKind)=>{suppressPlaybackAnnouncementRef.current=false;controllerRef.current?.send({type:'intervene',kind});setActionStatus(kind==='resource-bloom'?'Resource bloom released.':kind==='drought'?'Drought applied.':'Founder migration released.')}
  const reviewSettlement=useCallback((generation:number)=>{void reviewSettlementAndNavigate(generation,{onSelectGeneration:setRequestedGeneration})},[])
  const clearGenerationReveal=useCallback((generation:number)=>setGenerationRevealRequest(current=>current===generation?null:current),[])
  const closeSelected=()=>{selectIndividual(null);restoreArenaInspectionFocus()}
  const cancelTerminalFocusTransfer=(target:EventTarget)=>{if(terminalOutcomeFocusRequestRef.current!==null&&(!(target instanceof Node)||!selectedInspectorRef.current?.contains(target)))terminalOutcomeFocusRequestRef.current=null}
  const finishPending=pendingCommand?.kind==='finish'
  const finishGenerationAriaLabel=finishPending?'Finishing generation; wait for the current cohort to settle':'Pause and finish the current generation'
  const finishGenerationTitle=finishPending?'Finish generation is in progress; wait for settlement.':'Pause and finish the current generation'
  const actionControls:CreatureInspectorActionControls={nextAction,finishGeneration,nextActionLabel:formatCompactNextActionLabel(nextActionInput),nextActionAriaLabel:nextActionCopy.ariaLabel,nextActionTitle:nextActionCopy.title,nextActionDisabled:nextActionUnavailable||pendingCommand!==null,finishGenerationDisabled:extinct||pendingCommand!==null,finishGenerationLabel:finishPending?'Finishing…':'Finish generation',finishGenerationAriaLabel,finishGenerationTitle}

  const handleSnapshot=useCallback((nextWorld:World,meta?:SimulationSnapshotMeta)=>{
    const pending=pendingCommandRef.current
    const acknowledged=simulationCommandAcknowledged(pending,meta)
    const focusedIndividualId=selectedIndividualIdRef.current
    const previousGeneration=deliveredGenerationRef.current
    const finishAcknowledged=pending?.kind==='finish'&&acknowledged
    const stepAcknowledged=pending?.kind==='step'&&acknowledged
    const stepResult=stepAcknowledged?meta?.stepResult:undefined
    const stepObservedPath=stepAcknowledged?(stepResult?(meta?.stepContext?formatObservedPath(nextWorld,stepResult,meta.stepContext):'Observed path unavailable; retry Next action.'):'Observed path unavailable; retry Next action.'):undefined
    const stepEvidence=stepAcknowledged&&stepResult?{activity:nextWorld.activity,window:stepResult.activity}:null
    const storyTransition=resolveManualStepStoryTransition({previousGeneration,nextGeneration:nextWorld.generation,finishAcknowledged:finishAcknowledged===true,stepAcknowledged:stepAcknowledged===true,stepObservedPath,stepEvidence})
    deliveredGenerationRef.current=nextWorld.generation
    if(!pending&&focusedIndividualId!==null&&selectedInspectorRef.current?.contains(document.activeElement))terminalOutcomeFocusRequestRef.current=focusedIndividualId
    const requestedFocusId=terminalOutcomeFocusRequestRef.current
    if(requestedFocusId!==null&&nextWorld.creatures.some(creature=>creature.alive&&creature.individualId===requestedFocusId)&&(!pending||acknowledged))terminalOutcomeFocusRequestRef.current=null
    setWorld(nextWorld)
    setRevision(n=>n+1)
    if(storyTransition)setManualStepStory(state=>transitionManualStepStoryState(state,storyTransition))
    if(pending&&acknowledged){
      if(controllerRef.current?.mode==='fallback')queueMicrotask(()=>{if(pendingCommandRef.current===pending)pendingCommandRef.current=null})
      else pendingCommandRef.current=null
      setPendingCommand(null)
      if(pending.kind==='finish')setGenerationRevealRequest(resolveAcknowledgedFinishGeneration(pending.id,meta,nextWorld.ledger))
      else if(stepResult){
        const stoppedWithoutActive=stepResult.stop==='no-active'
        suppressPlaybackAnnouncementRef.current=stoppedWithoutActive
        setActionStatus(stoppedWithoutActive?'':formatStepCompletion(nextWorld,meta!))
      }
    }
    if(pendingPulseResetRef.current){pendingPulseResetRef.current=false;setLivePulseRun(n=>n+1)}
  },[])
  const handleFallback=useCallback(()=>{suppressPlaybackAnnouncementRef.current=false;const interrupted=pendingCommandRef.current;pendingCommandRef.current=null;setPendingCommand(null);if(interrupted?.kind==='step'){setManualStepStory(state=>transitionManualStepStoryState(state,{type:'step-interrupted'}));setActionStatus('Step interrupted; retry Next action.')}else if(interrupted?.kind==='finish'){setActionStatus('Finish generation interrupted; retry Finish generation.')}setRuntimeMode('fallback')},[])

  useEffect(()=>{const controller=createController(initialRef.current,handleSnapshot,handleFallback);controllerRef.current=controller;setRuntimeMode(controller.mode);return()=>{controller.dispose();controllerRef.current=null}},[handleSnapshot,handleFallback])

  useEffect(()=>{
    const query=window.matchMedia('(max-width: 1050px)')
    const compactQuery=window.matchMedia(COMPACT_TRANSPORT_QUERY)
    const change=()=>{setIsNarrow(query.matches);setArenaKeysOpen(!query.matches)}
    const compactChange=()=>setCompactTransport(compactQuery.matches)
    query.addEventListener('change',change)
    compactQuery.addEventListener('change',compactChange)
    return()=>{query.removeEventListener('change',change);compactQuery.removeEventListener('change',compactChange)}
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
    if(!shouldFocusSelectedInspector({requestedIndividualId:selectedInspectorFocusRequestRef.current,selectedIndividualId,inspectorRendered:Boolean(selected)}))return
    selectedInspectorFocusRequestRef.current=null
    selectedInspectorRef.current?.focus()
  },[selected,selectedIndividualId])
  useEffect(()=>{
    if(!shouldFocusResourcePatchInspector({requestedPatchId:selectedPatchInspectorFocusRequestRef.current,selectedPatchId,inspectorRendered:Boolean(selectedPatch)}))return
    selectedPatchInspectorFocusRequestRef.current=null
    selectedPatchInspectorRef.current?.focus()
  },[selectedPatch,selectedPatchId])
  useEffect(()=>{
    if(selectedIndividualId===null||world.creatures.some(creature=>creature.alive&&creature.individualId===selectedIndividualId))return
    activityFocusRequestRef.current++
    selectedInspectorFocusRequestRef.current=null
    const outcome=resolveTerminalOutcome({selectedIndividualId,creatures:world.creatures,recordedOutcome:world.lastInspectedOutcome,currentGeneration:world.generation})
    if(!outcome)terminalOutcomeFocusRequestRef.current=null
    setTerminalOutcome(outcome)
    setSelectedIndividualId(null)
    if(world.inspectedIndividualId!==null)controllerRef.current?.send({type:'inspect',individualId:null})
  },[world,selectedIndividualId])
  useEffect(()=>{
    if(selectedPatchId===null||world.environment.patches.some(patch=>patch.id===selectedPatchId))return
    selectedPatchInspectorFocusRequestRef.current=null
    setSelectedPatchId(null)
  },[world,selectedPatchId])
  useEffect(()=>{
    if(!terminalOutcome||terminalOutcomeFocusRequestRef.current!==terminalOutcome.individualId)return
    terminalOutcomeFocusRequestRef.current=null
    terminalOutcomeRef.current?.focus()
  },[terminalOutcome])

  return <div className="app-shell" onFocusCapture={event=>cancelTerminalFocusTransfer(event.target)}>
    <header className="topbar" aria-hidden={experimentOpen||(settingsOpen&&isNarrow)||undefined}>
      <div className="brand"><div className="mark" aria-hidden="true">∿</div><div><h1>Evolution Field Lab</h1><p>Shape an ecosystem. Watch selection unfold.</p></div></div>
      <div className="top-actions"><button ref={experimentToggleRef} className="experiment-toggle" onClick={()=>{setPlaying(false);setSettingsOpen(false);setExperimentOpen(true)}} aria-haspopup="dialog"><span aria-hidden="true">◫</span> Experiment lab</button><button ref={settingsToggleRef} className="settings-toggle" onClick={()=>{setSettingsPanelRequested(true);setSettingsOpen(v=>!v)}} aria-label={settingsOpen?'Close parameters':'Open parameters'} aria-expanded={settingsOpen} aria-controls="settings" aria-haspopup={isNarrow?'dialog':undefined}>
        <span aria-hidden="true">⚙</span> <span>Parameters</span>{dirty&&<><b aria-hidden="true">•</b><span className="sr-only">Unapplied parameter changes</span></>}
      </button></div>
    </header>
    <main aria-hidden={experimentOpen||undefined}>
      <section className="simulation-panel" aria-label="Simulation" aria-hidden={settingsOpen&&isNarrow||undefined}>
        <ArenaViewport compact={compactTransport}>
          <Suspense fallback={<ArenaCanvasFallback/>}><ArenaCanvas world={world} revision={revision} selectedIndividualId={selectedIndividualId} onSelect={selectIndividual} selectedPatchId={selectedPatchId} onSelectPatch={selectPatch} arenaFocus={arenaFocus} playbackStatus={arenaStatus} playbackDetail={arenaDetail}/></Suspense>
          <div className="arena-badge" style={{pointerEvents:'none'}}><strong>{arenaDayLabel}</strong><small>Generation {world.generation}</small><small>{world.config.ecologyMode==='energy-regrowth'?`${world.food.length} current food across ${world.environment.patches.length} resource patches`:`${world.food.length} current food`}</small>{showArenaQuickStart(world.ledger.length)&&<Suspense fallback={null}><FirstGenerationGuide playbackStatus={arenaStatus} selection={selectedPatchId!==null?'patch':selectedIndividualId!==null?'creature':'none'} stepState={pendingCommand?.kind==='finish'?'finishing':pendingCommand?.kind==='step'?'pending':stepActivityEvidence?'observed':'ready'}/></Suspense>}</div>
          <PlaybackPhaseStatus status={arenaStatus} detail={arenaDetail} playing={playing} suppressed={suppressPlaybackAnnouncementRef.current}/>
          <details className="arena-keys" style={{border:0,paddingTop:0,marginTop:0}} open={arenaKeysOpen||!isNarrow} onToggle={event=>{if(isNarrow)setArenaKeysOpen(event.currentTarget.open)}}>
            <summary className="state-key" aria-label={arenaKeysOpen?'Hide arena key':'Show arena key'} style={{display:isNarrow?'flex':'none',pointerEvents:'auto',touchAction:'manipulation',cursor:'pointer',listStyle:'none'}}>{arenaKeysOpen?'Hide key':'Show key'}</summary>
            <div className="state-key" role="group" aria-label="Creature action and overlay key"><strong>Outline = action · number = current count · body color = speed</strong><Suspense fallback={null}><ArenaActivitySpotlightKey world={world}/></Suspense>{world.config.ecologyMode==='energy-regrowth'&&<><strong>{ARENA_PATCH_STOCK_KEY}</strong><strong>{ARENA_PATCH_QUALITY_KEY}</strong></>}{selected&&<strong>{ARENA_SELECTED_OVERLAY_KEY}</strong>}{selected?.mode==='hunting'&&<strong>{ARENA_HUNT_CONTACT_KEY}</strong>}<label htmlFor="arena-focus" style={{pointerEvents:'auto',display:'inline-flex',alignItems:'center',gap:5,flexBasis:'100%',justifyContent:'flex-end',fontWeight:700}}><span>Focus</span><select id="arena-focus" aria-label="Focus creatures by current action" value={arenaFocus} onChange={event=>setArenaFocus(event.target.value as 'all'|CreatureState)} style={{pointerEvents:'auto',touchAction:'manipulation',minWidth:0,maxWidth:'170px',minHeight:isNarrow?'44px':'28px',fontSize:'10px',lineHeight:1.2,padding:'3px 5px',border:0,borderRadius:'5px',backgroundColor:'var(--paper)',color:'var(--ink)',colorScheme:'light dark'}}>{ARENA_FOCUS_OPTIONS.map(option=><option key={option.value} value={option.value}>{formatArenaFocusOption(option.value,option.value==='all'?living:stateCounts[option.value])}</option>)}</select></label><small style={{flexBasis:'100%',textAlign:'right',fontSize:'9px',lineHeight:1.35,color:arenaFocus==='all'?'#a7bbb2':'#f6dd83'}}>{formatArenaFocusDescription(arenaFocus,arenaFocusCount,living,selectedOutsideArenaFocus)}</small>{creatureStates.map(([state,metadata])=><span key={state}><i aria-hidden="true" style={{backgroundColor:metadata.color}}/><b>{stateCounts[state]}</b>{' '}{metadata.label}</span>)}</div>
            <div className="legend"><span>Body color = speed</span><i/><small>slower</small><small>faster</small></div>
          </details>
          {extinct&&<div className="extinct" role="status"><strong>Population extinct</strong><span>Use Founder migration to rescue this run, or adjust the parameters and restart.</span></div>}
        </ArenaViewport>
        <div className="transport" role="group" aria-label="Playback controls">
          <button className="play" disabled={extinct} onClick={()=>{suppressPlaybackAnnouncementRef.current=false;setPlaying(v=>!v)}} aria-label={formatPlaybackControlLabel(arenaStatus,playing)}>{playing?'Ⅱ':'▶'}</button>
          <button onClick={actionControls.nextAction} disabled={actionControls.nextActionDisabled} aria-label={actionControls.nextActionAriaLabel} title={actionControls.nextActionTitle}>{isNarrow?actionControls.nextActionLabel:nextActionCopy.buttonLabel}</button>
          <button onClick={actionControls.finishGeneration} disabled={actionControls.finishGenerationDisabled} aria-label={actionControls.finishGenerationAriaLabel} title={actionControls.finishGenerationTitle}>{actionControls.finishGenerationLabel}</button>
          <div className="day-progress" role="progressbar" aria-label="Current generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={dayProgress} aria-valuetext={arenaDayLabel}><i style={{width:`${dayProgress}%`}}/></div>
          <label className="speed-select">Playback speed <select value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
          <button className="reset" onClick={reset}>{dirty?'Apply & restart':'Restart run'}</button>
        </div>
        {selectedPatch&&<div ref={selectedPatchInspectorRef} className="inspector-focus-target" tabIndex={-1} aria-label="Selected resource patch details" style={{scrollMarginTop:'84px'}}><Suspense fallback={<ResourcePatchInspectorFallback/>}><ResourcePatchInspector world={world} selectedPatchId={selectedPatchId} onClose={closeSelectedPatch}/></Suspense></div>}
        {manualStepStory.visible&&<Suspense fallback={<ObservedStepStoryFallback observedPath={observedPath}/>}><ObservedStepStory observedPath={observedPath} evidence={stepActivityEvidence}/></Suspense>}
        <SimulationEventStory world={world} selectedIndividualId={selectedIndividualId} onShowIndividual={showActivityIndividual} suppressAnnouncementSequence={stepAnnouncementSequence}/>
        {selected&&<div ref={selectedInspectorRef} className="inspector-focus-target" tabIndex={-1} aria-label={`Selected individual ${selected.individualId} details`} style={{scrollMarginTop:'84px'}}><SelectedInspectorShell selected={selected} actionControls={actionControls} onClose={closeSelected}><CreatureInspector embedded selected={selected} world={world} ecologyMode={world.config.ecologyMode} dayTime={world.dayTime} stateLabel={CREATURE_STATE_METADATA[selected.home?'safe':selected.mode].label} targetLabel={formatSelectedTarget(selected,world.creatures,world.food)} decisionTargetLabel={decisionTargetLabel} huntContactRule={ARENA_HUNT_CONTACT_KEY} onClose={closeSelected}/></SelectedInspectorShell></div>}
        {terminalOutcome&&!selected&&<div ref={terminalOutcomeRef} className="inspector-focus-target" tabIndex={-1} aria-label={`Individual ${terminalOutcome.individualId} terminal outcome focus target`} style={{scrollMarginTop:'84px'}}><Suspense fallback={null}><TerminalOutcome outcome={terminalOutcome} onDismiss={()=>selectIndividual(null)}/></Suspense></div>}
        <Suspense fallback={<GenerationHandoffFallback/>}><GenerationHandoff world={world} playbackStatus={arenaStatus} playing={playing} onReviewGeneration={reviewSettlement} revealGeneration={generationRevealRequest} onRevealComplete={clearGenerationReveal}/></Suspense>
        {arenaStatus==='Awaiting settlement'&&<div className="pending" aria-label="Settlement status">{arenaDetail}</div>}
        <div className="interventions" role="group" aria-label="Live ecological interventions">
          <span><strong>Live shocks</strong><small>No restart needed</small></span>
          <button onClick={()=>intervene('resource-bloom')} disabled={world.food.length>=MAX_FOOD} title={world.food.length>=MAX_FOOD?'Food is at the safety cap':'Add a deterministic pulse of food'}>Resource bloom</button>
          <button onClick={()=>intervene('drought')} disabled={!world.food.length} title={!world.food.length?'There is no food to remove':'Remove 40% of current food'}>Drought</button>
          <button onClick={()=>intervene('founder-migration')} disabled={founderMigrationCopy.available===0} title={founderMigrationCopy.title} aria-label={founderMigrationCopy.ariaLabel}>{founderMigrationCopy.buttonLabel}</button>
        </div>
        {dirty&&<div className="pending" role="status">Changes are staged and will take effect when you choose <strong>Apply &amp; restart</strong>.</div>}

        <DashboardNavigation/>

        <div className="dashboard">
          <section id={DASHBOARD_SECTION_IDS.liveOverview} tabIndex={-1} className="dashboard" aria-label="Live statistics" style={DASHBOARD_SECTION_SCROLL_STYLE}>
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
          <Suspense fallback={<GenerationAccountingFallback/>}><GenerationAccounting world={world} globalFoodCap={MAX_FOOD}/></Suspense>
          </section>
          <section id={DASHBOARD_SECTION_IDS.generationJournal} tabIndex={-1} aria-label="Generation journal review" style={DASHBOARD_SECTION_SCROLL_STYLE}><Suspense fallback={<div className="evolution-story generation-journal" aria-busy="true"><p className="journal-empty" role="status">Opening generation journal…</p></div>}><GenerationJournal ledgers={world.ledger} events={world.events} requestedGeneration={requestedGeneration} onRequestedGenerationChange={setRequestedGeneration}/></Suspense></section>
          <section id={DASHBOARD_SECTION_IDS.populationLineages} tabIndex={-1} aria-label="Population & lineages" style={DASHBOARD_SECTION_SCROLL_STYLE}><Suspense fallback={<div className="evolution-story" aria-busy="true"><p className="journal-empty" role="status">Opening population story…</p></div>}><PopulationStory lineage={lineage}/></Suspense></section>
          <section id={DASHBOARD_SECTION_IDS.insightsCharts} tabIndex={-1} aria-label="Insights & charts" style={DASHBOARD_SECTION_SCROLL_STYLE}><Suspense fallback={<div className="evolution-story generation-journal" aria-busy="true"><p className="journal-empty" role="status">Opening insights…</p></div>}><InsightsPanel world={world} requestedGeneration={requestedGeneration} onSelectGeneration={setRequestedGeneration}/></Suspense></section>
        </div>
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
