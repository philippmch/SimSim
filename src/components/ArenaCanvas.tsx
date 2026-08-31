import { useEffect, useRef } from 'react'
import type React from 'react'
import type { NextActionContext, NextActionResult } from '../simulation/scheduler'
import { MAX_POPULATION } from '../simulation/config'
import type { Mode, TargetType, World } from '../simulation/types'

interface Props { world: World; revision: number;selectedIndividualId:number|null;onSelect:(individualId:number|null)=>void;arenaFocus:ArenaFocus }

export type CreatureState = 'safe'|Mode
export type ArenaFocus = 'all'|CreatureState

export type ArenaPlaybackStatus = 'Running'|'Paused'|'Extinct'

export const ARENA_PATCH_STOCK_KEY = 'Patch arcs = current food stock.'
export const ARENA_SELECTED_OVERLAY_KEY = 'Selected: gold ring = focus; gold area = sight; dash = target; colored rings = memory; dotted rings = kin.'
export const ARENA_HUNT_CONTACT_KEY = 'Hunts resolve against the nearest eligible prey at contact, which may differ from the dashed pursuit target.'
export const ARENA_FOCUS_TARGET_PATH_KEY = 'Active matches with a held target show dashed paths; decisions can persist between reaction windows.'
export const ARENA_SAFE_FOCUS_TARGET_PATH_KEY = 'Safe-at-home creatures have no active target paths.'
export const ARENA_QUICK_START = [
  'Try this: pause → inspect a creature → finish generation.',
  'Then change one parameter and restart to compare.',
] as const

export const ARENA_FOCUS_LABELS = {
  all:'All creatures',
  safe:'Safe at home',
  exploring:'Exploring',
  foraging:'Finding food',
  hunting:'Hunting prey',
  fleeing:'Fleeing danger',
  returning:'Going home',
} as const satisfies Record<ArenaFocus,string>

export const ARENA_FOCUS_OPTIONS = [
  {value:'all',label:ARENA_FOCUS_LABELS.all},
  {value:'safe',label:ARENA_FOCUS_LABELS.safe},
  {value:'exploring',label:ARENA_FOCUS_LABELS.exploring},
  {value:'foraging',label:ARENA_FOCUS_LABELS.foraging},
  {value:'hunting',label:ARENA_FOCUS_LABELS.hunting},
  {value:'fleeing',label:ARENA_FOCUS_LABELS.fleeing},
  {value:'returning',label:ARENA_FOCUS_LABELS.returning},
] as const

export const ARENA_FOCUS_DIM_ALPHA = .24

export function arenaCreatureAlpha(focus: ArenaFocus, state: CreatureState, selected = false): number {
  return focus === 'all' || selected || focus === state ? 1 : ARENA_FOCUS_DIM_ALPHA
}

export type ArenaTargetPathCreature = Pick<World['creatures'][number], 'individualId' | 'x' | 'y' | 'alive' | 'home' | 'mode' | 'targetType' | 'targetX' | 'targetY'>

/** Whether a creature has a safe-to-draw held-target path in the current action focus. */
export function arenaTargetPathEligible(focus: ArenaFocus, creature: ArenaTargetPathCreature, selectedIndividualId: number | null = null): boolean {
  if (focus === 'all' || !creature.alive || creature.home || creature.targetType === null) return false
  if (selectedIndividualId !== null && creature.individualId === selectedIndividualId) return false
  if ((creature.home ? 'safe' : creature.mode) !== focus) return false
  return [creature.x, creature.y, creature.targetX, creature.targetY].every(Number.isFinite)
}

export function arenaLineageRingAlpha(): number {
  return 1
}

export function formatArenaFocusDescription(focus: ArenaFocus, matchingCount?: number, livingCount?: number, selectedNonMatch=false): string {
  const counted=Number.isFinite(matchingCount)&&Number.isFinite(livingCount)
  if(focus==='all')return counted?`All living creatures are shown (${Math.max(0,Math.trunc(livingCount!))}).`:'All creatures are shown.'
  const pathDescription=focus==='safe'?ARENA_SAFE_FOCUS_TARGET_PATH_KEY:ARENA_FOCUS_TARGET_PATH_KEY
  if(!counted)return`Focus: ${ARENA_FOCUS_LABELS[focus]}; other creatures are dimmed. ${pathDescription}`
  const total=Math.max(0,Math.trunc(livingCount!)),matching=Math.min(total,Math.max(0,Math.trunc(matchingCount!))),kept=selectedNonMatch&&matching<total?1:0,dimmed=total-matching-kept
  const summary=`Focus: ${ARENA_FOCUS_LABELS[focus]}; ${matching} ${matching===1?'creature matches':'creatures match'} and ${dimmed} ${dimmed===1?'other is':'others are'} dimmed.`
  return `${kept?`${summary} The selected creature stays highlighted.`:summary} ${pathDescription}`
}

export function formatArenaFocusOption(focus: ArenaFocus, count: number): string {
  return `${ARENA_FOCUS_LABELS[focus]} (${Math.max(0, Math.trunc(count))})`
}

export function showArenaQuickStart(completedGenerations: number): boolean {
  return completedGenerations === 0
}

export function arenaPlaybackStatus(playing: boolean, extinct: boolean): ArenaPlaybackStatus {
  return extinct ? 'Extinct' : playing ? 'Running' : 'Paused'
}

export function formatArenaDayProgress(dayTime: number, dayLength: number, status: ArenaPlaybackStatus): string {
  const current = Number.isFinite(dayTime) ? Math.max(0, dayTime) : 0
  const duration = Number.isFinite(dayLength) ? Math.max(.1, dayLength) : .1
  return `Day ${current.toFixed(1)} / ${duration.toFixed(1)} · ${status}`
}

export interface ArenaSelectedTargetInput {
  targetType: TargetType | null
  targetId: number | null
}

type ArenaTargetCreature = Pick<World['creatures'][number], 'id' | 'individualId' | 'alive'>
type ArenaTargetFood = Pick<World['food'][number], 'id'>

export function formatSelectedTarget(
  target: ArenaSelectedTargetInput,
  creatures: ReadonlyArray<ArenaTargetCreature>,
  food: ReadonlyArray<ArenaTargetFood> = [],
): string {
  if (target.targetType === null) return 'None'
  if (target.targetType === 'home') return 'Home location'
  if (target.targetType === 'memory') return 'Remembered location'
  if (target.targetType === 'explore') return 'Exploration waypoint'
  if (target.targetId === null) return `${target.targetType === 'food' ? 'Food' : target.targetType === 'prey' ? 'Prey' : 'Threat'} · unavailable`
  if (target.targetType === 'food') return food.some(item => item.id === target.targetId) ? 'Food item' : 'Food · unavailable'
  const targetCreature = creatures.find(creature => creature.id === target.targetId && creature.alive)
  const kind = target.targetType === 'prey' ? 'Prey' : 'Threat'
  return targetCreature ? `${kind} · Individual ${targetCreature.individualId}` : `${kind} · unavailable`
}

function observedCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value!)) : 0
}

function observedQuantity(value: number | undefined, singular: string, plural = `${singular}s`): string {
  const count = observedCount(value)
  return `${count} ${count === 1 ? singular : plural}`
}

function observedDecisionLabel(target: TargetType): string {
  return target === 'food' ? 'food' : target === 'prey' ? 'prey' : target === 'threat' ? 'danger' : target === 'home' ? 'home' : target === 'memory' ? 'remembered food' : 'exploration'
}

function observedActionLabel(creature: World['creatures'][number]): string {
  return CREATURE_STATE_METADATA[creature.home ? 'safe' : creature.mode].label
}

function inspectedCreature(world: World, individualId: number | null): World['creatures'][number] | undefined {
  return individualId === null
    ? undefined
    : world.creatures.find(creature => creature.individualId === individualId)
}

function formatObservedCreaturePath(world: World, context: NextActionContext): string {
  const inspected = inspectedCreature(world, context.selectedIndividualId)
  if (!inspected) return 'Inspect a creature, then choose Next action to observe its perception and decision path.'
  if (!inspected.alive) return 'The inspected creature is no longer living; inspect an active creature to observe a decision path.'

  const perception = inspected.perceptionDiagnostics
  const decision = inspected.decisionSummary
  if (inspected.home && !perception && !decision) return 'The inspected creature is home; no active decision path was recorded for this step.'
  const perceptionText = perception
    ? `perception recorded ${observedCount(perception.creatures.detected)}/${observedCount(perception.creatures.total)} creatures and ${observedCount(perception.food.detected)}/${observedCount(perception.food.total)} food`
    : 'perception telemetry is unavailable'
  const decisionText = decision
    ? `decision recorded as ${observedDecisionLabel(decision.chosen)} (reason noted: ${decision.reason.trim() || 'not provided'})`
    : 'decision telemetry is unavailable'
  const target = formatSelectedTarget(inspected, world.creatures, world.food)
  const arrival = inspected.home ? ' It reached home during this step.' : ''
  return `Inspected ${inspected.home ? 'creature now home' : 'active creature'}: ${perceptionText} → ${decisionText} → current action: ${observedActionLabel(inspected)} · target: ${target}.${arrival}`
}

function formatObservedGenerationBoundary(world: World): string {
  const ledger = world.ledger.at(-1)
  if (!ledger) return `Generation boundary reached; no generation ledger is available. Generation ${world.generation} is ready.`
  const survivors = observedCount(ledger.outcomes?.survived)
  const births = observedCount(ledger.birthsAdmitted)
  const nextPopulation = survivors + births
  return `Generation ${ledger.generation} recorded ${observedQuantity(ledger.foodConsumed, 'food item')} consumed, ${observedQuantity(ledger.attackAttempts, 'attack attempt')}, ${observedQuantity(ledger.attackSuccesses, 'attack success', 'attack successes')}, ${observedQuantity(survivors, 'survivor')}, and ${observedQuantity(births, 'birth')} → exact next population: ${nextPopulation}.`
}

/**
 * Summarize one manual action step using only telemetry and ledger facts present
 * in the resulting world. The wording is intentionally observational: it
 * describes recorded perception, decisions, and outcomes without claiming why
 * the population changed.
 */
export function formatObservedPath(world: World, result: NextActionResult, context: NextActionContext): string {
  if (result.stop === 'generation-boundary') return `Observed path: ${formatObservedGenerationBoundary(world)}`
  const inspected = inspectedCreature(world, context.selectedIndividualId)
  if (result.stop === 'selected-inactive') {
    const outcome = !inspected
      ? 'became unavailable'
      : !inspected.alive
        ? 'died'
        : inspected.home
          ? 'reached home'
          : 'is no longer active'
    return `Observed path: The selected creature ${outcome}; other active creatures remain. The manual step stopped for this selection.`
  }
  if (context.selectedIndividualId !== null && !context.selectedWasActive) {
    return inspected?.home
      ? 'Observed path: The inspected creature was already home at step start; no new decision path was observed.'
      : 'Observed path: The selected creature was not active at step start; no new decision path was observed.'
  }
  if (result.stop === 'no-active') {
    const living = world.creatures.filter(creature => creature.alive)
    const aggregate = living.length
      ? `No active creatures remain; ${observedQuantity(living.length, 'living creature')} ${living.length === 1 ? 'is' : 'are'} home.`
      : 'No active creatures remain; the population is extinct.'
    if (context.selectedWasActive) {
      if (!inspected) return `Observed path: The selected creature became unavailable. ${aggregate}`
      if (!inspected.alive) return `Observed path: The selected creature died. ${aggregate}`
      if (inspected.home) {
        const selectedOutcome = inspected.perceptionDiagnostics || inspected.decisionSummary
          ? formatObservedCreaturePath(world, context)
          : 'The selected creature reached home during this step.'
        return `Observed path: ${selectedOutcome} ${aggregate}`
      }
    }
    return `Observed path: ${aggregate}`
  }
  const prefix = result.stop === 'bounded'
    ? `Observed path: Step stopped at the ${observedQuantity(result.ticks, 'tick')} reaction-window bound. `
    : 'Observed path: '
  return `${prefix}${formatObservedCreaturePath(world, context)}`
}

export interface ArenaAccessibleDescriptionInput {
  generation: number
  livingCreatures: number
  stateSummary: string
  foodCount: number
  patchCount: number
  foodBudget: number
  obstacleCount: number
  ecologyMode: World['config']['ecologyMode']
  hasSelectedCreature: boolean
  selectedIsHunting?: boolean
  focus?: ArenaFocus
  focusCount?: number
  selectedOutsideFocus?: boolean
}

export function formatArenaOverlayDescription(
  ecologyMode: World['config']['ecologyMode'],
  hasSelectedCreature: boolean,
  selectedIsHunting = false,
): string {
  const descriptions: string[] = []
  if (ecologyMode === 'energy-regrowth') descriptions.push(ARENA_PATCH_STOCK_KEY)
  if (hasSelectedCreature) {
    descriptions.push(ARENA_SELECTED_OVERLAY_KEY)
    if (selectedIsHunting) descriptions.push(ARENA_HUNT_CONTACT_KEY)
  }
  return descriptions.join(' ')
}

export function formatArenaAccessibleDescription(input: ArenaAccessibleDescriptionInput): string {
  const resourceLabel = input.ecologyMode === 'energy-regrowth'
    ? `${input.foodCount} food items distributed across ${input.patchCount} resource patches`
    : `${input.foodCount} food remaining from a ${Math.round(input.foodBudget)}-item generation pulse across ${input.patchCount} patches`
  const overlayDescription = formatArenaOverlayDescription(input.ecologyMode, input.hasSelectedCreature, input.selectedIsHunting)
  const focusDescription = formatArenaFocusDescription(input.focus ?? 'all',input.focusCount,input.livingCreatures,input.selectedOutsideFocus)
  const allFocusPathDescription = input.focus === 'all' ? ' Choose an action focus to reveal dashed current held-target paths for active matches; decisions can persist between reaction windows.' : ''
  const selectionHint = input.hasSelectedCreature
    ? ''
    : 'Select a creature to reveal its focus, sight, target, memory, and same-lineage overlays.'
  return `Simulation arena, generation ${input.generation}, ${input.livingCreatures} living creatures: ${input.stateSummary}. ${resourceLabel}. ${input.obstacleCount} obstacles. ${overlayDescription ? `${overlayDescription} ` : ''}${focusDescription}${allFocusPathDescription} ${selectionHint} Creature body color shows speed and the bright body outline shows its current action. Click a creature or use the Inspect creature selector to select it.`
}

export function formatArenaSelectionStatus(selectedIndividualId: number | null): string {
  return selectedIndividualId === null
    ? 'Creature inspection cleared. No creature selected.'
    : `Individual ${selectedIndividualId} selected for inspection.`
}

export const CREATURE_STATE_METADATA = {
  safe:{label:'Safe at home',color:'#f8fafc'},
  exploring:{label:'Exploring',color:'#38bdf8'},
  foraging:{label:'Finding food',color:'#fde047'},
  hunting:{label:'Hunting prey',color:'#fb7185'},
  fleeing:{label:'Fleeing danger',color:'#c084fc'},
  returning:{label:'Going home',color:'#4ade80'}
} as const satisfies Record<CreatureState,{label:string;color:string}>

export const ARENA_COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export interface ArenaCanvasPalette {
  fieldStart: string
  fieldEnd: string
  fieldBorder: string
  fieldGrid: string
  patchHaloStart: string
  patchHaloEnd: string
  patchRing: string
  sightFill: string
  sightStroke: string
  targetLine: string
  memoryFood: string
  memoryThreat: string
  obstacleShadow: string
  obstacleStart: string
  obstacleEnd: string
  obstacleStroke: string
  foodShadow: string
  foodStart: string
  foodMiddle: string
  foodEnd: string
  creatureShadow: string
  creatureEdge: string
  creatureHighlight: string
  creatureBodyEnd: string
  creatureEye: string
  creatureFoodLabel: string
  selectedRing: string
  lineageRing: string
  progressTrack: string
  progressFill: string
}

export const ARENA_LIGHT_PALETTE: ArenaCanvasPalette = {
  fieldStart:'#e8eee4',
  fieldEnd:'#dce7d8',
  fieldBorder:'rgba(47,78,65,.18)',
  fieldGrid:'rgba(37,75,62,.22)',
  patchHaloStart:'rgba(183,190,88,.16)',
  patchHaloEnd:'rgba(183,190,88,0)',
  patchRing:'rgba(171,183,78,.7)',
  sightFill:'rgba(227,188,63,.10)',
  sightStroke:'rgba(227,188,63,.7)',
  targetLine:'rgba(242,201,76,.6)',
  memoryFood:'#d5bb43',
  memoryThreat:'#bd6651',
  obstacleShadow:'rgba(28,48,39,.16)',
  obstacleStart:'#93a594',
  obstacleEnd:'#526b5d',
  obstacleStroke:'rgba(32,53,44,.3)',
  foodShadow:'rgba(31,55,38,.18)',
  foodStart:'#e9d77d',
  foodMiddle:'#a2b95d',
  foodEnd:'#5f7133',
  creatureShadow:'rgba(22,38,30,.16)',
  creatureEdge:'rgba(12,29,23,.82)',
  creatureHighlight:'rgba(255,255,255,.35)',
  creatureBodyEnd:'#304b35',
  creatureEye:'#132019',
  creatureFoodLabel:'#f2d45d',
  selectedRing:'#f2c94c',
  lineageRing:'rgba(242,201,76,.46)',
  progressTrack:'rgba(16,34,28,.16)',
  progressFill:'#d9b940',
}

export const ARENA_DARK_PALETTE: ArenaCanvasPalette = {
  fieldStart:'#14251e',
  fieldEnd:'#1c3428',
  fieldBorder:'rgba(185,222,201,.25)',
  fieldGrid:'rgba(185,222,201,.18)',
  patchHaloStart:'rgba(205,216,100,.18)',
  patchHaloEnd:'rgba(205,216,100,0)',
  patchRing:'rgba(205,216,100,.82)',
  sightFill:'rgba(245,211,83,.13)',
  sightStroke:'rgba(249,216,91,.84)',
  targetLine:'rgba(255,222,97,.78)',
  memoryFood:'#ead35a',
  memoryThreat:'#ed8f79',
  obstacleShadow:'rgba(0,0,0,.46)',
  obstacleStart:'#759482',
  obstacleEnd:'#3b5a4a',
  obstacleStroke:'rgba(202,231,213,.31)',
  foodShadow:'rgba(0,0,0,.44)',
  foodStart:'#f3e29a',
  foodMiddle:'#bfd575',
  foodEnd:'#718d46',
  creatureShadow:'rgba(0,0,0,.5)',
  creatureEdge:'rgba(1,10,7,.9)',
  creatureHighlight:'rgba(255,255,255,.4)',
  creatureBodyEnd:'#54755d',
  creatureEye:'#e6f4ea',
  creatureFoodLabel:'#f6dc68',
  selectedRing:'#f8d65d',
  lineageRing:'rgba(255,220,98,.62)',
  progressTrack:'rgba(219,239,225,.22)',
  progressFill:'#eed25a',
}

export function arenaCanvasPalette(darkMode: boolean): ArenaCanvasPalette {
  return darkMode ? ARENA_DARK_PALETTE : ARENA_LIGHT_PALETTE
}

export interface ArenaColorSchemeQuery {
  readonly matches: boolean
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
  addListener?: (listener: () => void) => void
  removeListener?: (listener: () => void) => void
}

export function listenToArenaColorScheme(
  query: ArenaColorSchemeQuery,
  cachedDarkMode: boolean,
  onChange: (darkMode: boolean) => void,
): () => void {
  const handleChange = () => onChange(query.matches)
  if (query.matches !== cachedDarkMode) onChange(query.matches)
  if (typeof query.addEventListener === 'function' && typeof query.removeEventListener === 'function') {
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener!('change', handleChange)
  }
  if (typeof query.addListener === 'function' && typeof query.removeListener === 'function') {
    query.addListener(handleChange)
    return () => query.removeListener!(handleChange)
  }
  return () => {}
}

function readArenaDarkMode(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(ARENA_COLOR_SCHEME_QUERY).matches
    : false
}

function speedColor(speed: number) {
  const t=Math.max(0,Math.min(1,(speed-.55)/1.15))
  const hue=175+(54-175)*t
  return `hsl(${hue} 58% ${42+t*14}%)`
}

export function ArenaCanvas({world,revision,selectedIndividualId,onSelect,arenaFocus}:Props) {
  const ref=useRef<HTMLCanvasElement>(null)
  const drawRef=useRef<()=>void>(()=>{})
  const darkModeRef=useRef<boolean | null>(null)
  if(darkModeRef.current===null)darkModeRef.current=readArenaDarkMode()
  useEffect(()=>{
    const canvas=ref.current
    if(!canvas) return
    const draw=()=>{
      const rect=canvas.getBoundingClientRect(), dpr=Math.min(2,window.devicePixelRatio||1)
      if(canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){
        canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr)
      }
      const ctx=canvas.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0)
      const w=rect.width,h=rect.height,pad=Math.max(20,Math.min(w,h)*.055),palette=arenaCanvasPalette(darkModeRef.current??false)
      ctx.clearRect(0,0,w,h)
      const grad=ctx.createLinearGradient(0,0,w,h);grad.addColorStop(0,palette.fieldStart);grad.addColorStop(1,palette.fieldEnd)
      ctx.fillStyle=grad;ctx.beginPath();ctx.roundRect(pad,pad,w-pad*2,h-pad*2,Math.min(34,w*.05));ctx.fill()
      ctx.strokeStyle=palette.fieldBorder;ctx.lineWidth=1;ctx.stroke()
      ctx.save();ctx.setLineDash([4,8]);ctx.strokeStyle=palette.fieldGrid;ctx.strokeRect(pad+10,pad+10,w-pad*2-20,h-pad*2-20);ctx.restore()
      const sx=(x:number)=>pad+x*(w-pad*2), sy=(y:number)=>pad+y*(h-pad*2)
      const renderableCreatures=world.creatures.filter(c=>c.alive).slice(0,MAX_POPULATION)
      if(arenaFocus!=='all')for(const c of renderableCreatures)if(arenaTargetPathEligible(arenaFocus,c,selectedIndividualId)){
        const fromX=sx(c.x),fromY=sy(c.y),targetX=sx(c.targetX),targetY=sy(c.targetY)
        const color=CREATURE_STATE_METADATA[arenaFocus].color
        ctx.save();ctx.globalAlpha=.52;ctx.strokeStyle=color;ctx.lineWidth=1.25;ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(fromX,fromY);ctx.lineTo(targetX,targetY);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=color;ctx.beginPath();ctx.arc(targetX,targetY,Math.max(2.5,Math.min(w,h)*.009),0,Math.PI*2);ctx.fill();ctx.restore()
      }
      const selected=world.creatures.find(creature=>creature.individualId===selectedIndividualId&&creature.alive)
      if(selected){
        const x=sx(selected.x),y=sy(selected.y),rx=selected.sense*(w-pad*2),ry=selected.sense*(h-pad*2),half=world.config.fieldOfView/360*Math.PI
        ctx.save();ctx.fillStyle=palette.sightFill;ctx.strokeStyle=palette.sightStroke;ctx.lineWidth=1.25;ctx.setLineDash([5,5]);ctx.beginPath()
        if(world.config.perceptionMode==='realistic'&&world.config.fieldOfView<359.9){ctx.moveTo(x,y);ctx.ellipse(x,y,rx,ry,0,selected.angle-half,selected.angle+half);ctx.closePath()}else ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2)
        ctx.fill();ctx.stroke();ctx.restore()
        if(selected.targetType){ctx.save();ctx.strokeStyle=palette.targetLine;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(sx(selected.targetX),sy(selected.targetY));ctx.stroke();ctx.restore()}
        for(const memory of [{x:selected.memory.foodX,y:selected.memory.foodY,color:palette.memoryFood},{x:selected.memory.threatX,y:selected.memory.threatY,color:palette.memoryThreat}])if(memory.x!==null&&memory.y!==null){ctx.save();ctx.strokeStyle=memory.color;ctx.lineWidth=1.5;ctx.setLineDash([2,3]);ctx.beginPath();ctx.arc(sx(memory.x),sy(memory.y),7,0,Math.PI*2);ctx.stroke();ctx.restore()}
      }
      for(const patch of world.environment.patches){
        const x=sx(patch.x),y=sy(patch.y),r=Math.max(24,Math.min(w,h)*world.config.foodPatchSpread*.72)
        const halo=ctx.createRadialGradient(x,y,0,x,y,r);halo.addColorStop(0,palette.patchHaloStart);halo.addColorStop(1,palette.patchHaloEnd)
        ctx.fillStyle=halo;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()
        if(world.config.ecologyMode==='energy-regrowth'){const stock=Math.max(0,Math.min(1,patch.stock/Math.max(1,world.config.patchCapacity)));ctx.strokeStyle=palette.patchRing;ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,Math.max(8,r*.32),-Math.PI/2,-Math.PI/2+Math.PI*2*stock);ctx.stroke()}
      }
      for(const obstacle of world.environment.obstacles){
        const x=sx(obstacle.x),y=sy(obstacle.y),r=obstacle.radius*Math.min(w-pad*2,h-pad*2)
        ctx.fillStyle=palette.obstacleShadow;ctx.beginPath();ctx.ellipse(x+2,y+r*.72,r*1.04,r*.36,0,0,Math.PI*2);ctx.fill()
        const rock=ctx.createRadialGradient(x-r*.25,y-r*.3,2,x,y,r);rock.addColorStop(0,palette.obstacleStart);rock.addColorStop(1,palette.obstacleEnd)
        ctx.fillStyle=rock;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle=palette.obstacleStroke;ctx.stroke()
      }
      for(const f of world.food){
        const x=sx(f.x),y=sy(f.y),r=Math.max(3.5,Math.min(w,h)*.008)
        ctx.fillStyle=palette.foodShadow;ctx.beginPath();ctx.ellipse(x+1,y+r*.9,r*1.2,r*.38,0,0,Math.PI*2);ctx.fill()
        const g=ctx.createRadialGradient(x-r*.25,y-r*.35,1,x,y,r);g.addColorStop(0,palette.foodStart);g.addColorStop(.4,palette.foodMiddle);g.addColorStop(1,palette.foodEnd)
        ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()
      }
      const sorted=renderableCreatures.sort((a,b)=>a.y-b.y)
      for(const c of sorted){
        const x=sx(c.x),y=sy(c.y),base=Math.max(7,Math.min(w,h)*.017*c.size), height=base*1.55
        const stateKey=c.home?'safe':c.mode
        const state=CREATURE_STATE_METADATA[stateKey]
        ctx.save();ctx.globalAlpha=arenaCreatureAlpha(arenaFocus,stateKey,c.individualId===selectedIndividualId)
        ctx.fillStyle=palette.creatureShadow;ctx.beginPath();ctx.ellipse(x,y+base*.46,base*.9,base*.3,0,0,Math.PI*2);ctx.fill()
        if(selected&&c.individualId!==selected.individualId&&c.lineageId===selected.lineageId){ctx.save();ctx.globalAlpha=arenaLineageRingAlpha();ctx.strokeStyle=palette.lineageRing;ctx.lineWidth=1.5;ctx.setLineDash([2,3]);ctx.beginPath();ctx.arc(x,y-height*.35,base*1.35,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.restore()}
        if(c.individualId===selectedIndividualId){ctx.strokeStyle=palette.selectedRing;ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y-height*.35,base*1.5,0,Math.PI*2);ctx.stroke()}
        const orientation=Math.hypot(c.vx,c.vy)>.001?Math.atan2(c.vy,c.vx):c.angle
        ctx.save();ctx.translate(x,y);ctx.rotate(orientation+Math.PI/2)
        const g=ctx.createLinearGradient(-base,-height,base,base*.45);g.addColorStop(0,palette.creatureHighlight);g.addColorStop(.25,speedColor(c.speed));g.addColorStop(1,palette.creatureBodyEnd)
        const bodyPath=()=>{ctx.beginPath();ctx.moveTo(-base*.78,base*.35);ctx.bezierCurveTo(-base*1.05,-height*.18,-base*.56,-height,0,-height);ctx.bezierCurveTo(base*.56,-height,base*1.05,-height*.18,base*.78,base*.35);ctx.quadraticCurveTo(0,base*.65,-base*.78,base*.35);ctx.closePath()}
        ctx.fillStyle=g;bodyPath();ctx.fill()
        ctx.lineJoin='round';ctx.strokeStyle=palette.creatureEdge;ctx.lineWidth=4.8;bodyPath();ctx.stroke()
        ctx.strokeStyle=state.color;ctx.lineWidth=2.6;bodyPath();ctx.stroke()
        const look=Math.cos(c.angle)*base*.1
        ctx.fillStyle=palette.creatureEye;ctx.beginPath();ctx.arc(-base*.25+look,-height*.55,Math.max(1.2,base*.075),0,Math.PI*2);ctx.arc(base*.25+look,-height*.55,Math.max(1.2,base*.075),0,Math.PI*2);ctx.fill()
        if(c.food>0){ctx.fillStyle=palette.creatureFoodLabel;ctx.font=`600 ${Math.max(8,base*.55)}px system-ui`;ctx.textAlign='center';ctx.fillText(String(c.food),0,base*.15)}
        ctx.restore()
        ctx.restore()
      }
      const pct=Math.min(1,world.dayTime/world.config.dayLength)
      ctx.fillStyle=palette.progressTrack;ctx.fillRect(pad,pad-9,w-pad*2,3)
      ctx.fillStyle=palette.progressFill;ctx.fillRect(pad,pad-9,(w-pad*2)*pct,3)
    }
    drawRef.current=draw;draw()
  },[world,revision,selectedIndividualId,arenaFocus])
  useEffect(()=>{
    const query=typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(ARENA_COLOR_SCHEME_QUERY)
      : null
    if(!query)return
    return listenToArenaColorScheme(query, darkModeRef.current??false, darkMode=>{
      if(darkMode===darkModeRef.current)return
      darkModeRef.current=darkMode
      drawRef.current()
    })
  },[])
  useEffect(()=>{const canvas=ref.current;if(!canvas||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>drawRef.current());observer.observe(canvas);return()=>observer.disconnect()},[])
  const chooseAt=(event:React.MouseEvent<HTMLCanvasElement>)=>{const canvas=ref.current;if(!canvas)return;const rect=canvas.getBoundingClientRect(),pad=Math.max(20,Math.min(rect.width,rect.height)*.055),x=(event.clientX-rect.left-pad)/(rect.width-pad*2),y=(event.clientY-rect.top-pad)/(rect.height-pad*2);let best:World['creatures'][number]|undefined,bestD=.05;for(const c of world.creatures.filter(c=>c.alive)){const d=Math.hypot(c.x-x,c.y-y);if(d<bestD){best=c;bestD=d}}onSelect(best?.individualId??null)}
  const livingCreatures=world.creatures.filter(c=>c.alive)
  const selected=world.creatures.find(creature=>creature.individualId===selectedIndividualId&&creature.alive)
  const stateCounts:Record<CreatureState,number>={safe:0,exploring:0,foraging:0,hunting:0,fleeing:0,returning:0}
  for(const creature of livingCreatures)stateCounts[creature.home?'safe':creature.mode]++
  const stateSummary=(Object.entries(CREATURE_STATE_METADATA) as [CreatureState,(typeof CREATURE_STATE_METADATA)[CreatureState]][]).map(([state,metadata])=>`${stateCounts[state]} ${metadata.label.toLowerCase()}`).join(', ')
  const selectedState=selected?(selected.home?'safe':selected.mode):null
  const accessibleDescription=formatArenaAccessibleDescription({generation:world.generation,livingCreatures:livingCreatures.length,stateSummary,foodCount:world.food.length,patchCount:world.environment.patches.length,foodBudget:world.environment.foodBudget,obstacleCount:world.environment.obstacles.length,ecologyMode:world.config.ecologyMode,hasSelectedCreature:Boolean(selected),selectedIsHunting:selected?.mode==='hunting',focus:arenaFocus,focusCount:arenaFocus==='all'?livingCreatures.length:stateCounts[arenaFocus],selectedOutsideFocus:arenaFocus!=='all'&&selectedState!==null&&selectedState!==arenaFocus})
  return <><canvas ref={ref} className="arena" role="img" onClick={chooseAt} aria-label={accessibleDescription}>
    Natural selection simulation arena. Live counts are available in the statistics region.
  </canvas><label className="creature-picker" htmlFor="arena-creature-picker">Inspect creature <select id="arena-creature-picker" aria-describedby="arena-creature-picker-help" value={selectedIndividualId??''} onChange={e=>onSelect(e.target.value?Number(e.target.value):null)} style={{background:'var(--paper)',color:'var(--ink)',colorScheme:'light dark'}}><option value="">No creature selected</option>{livingCreatures.sort((a,b)=>a.individualId-b.individualId).map(c=><option key={c.individualId} value={c.individualId}>Individual {c.individualId}, lineage {c.lineageId}, {CREATURE_STATE_METADATA[c.home?'safe':c.mode].label}</option>)}</select></label><span id="arena-creature-picker-help" className="sr-only">Choose a living creature to inspect its current behavior. Choose No creature selected to clear inspection.</span><span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{formatArenaSelectionStatus(selectedIndividualId)}</span></>
}

export { speedColor }
