import type { NextActionContext, NextActionResult } from '../simulation/scheduler'
import { patchQualityMultiplier } from '../simulation/patchQuality'
import type { DecisionSummary, Mode, TargetType, World } from '../simulation/types'

export type CreatureState = 'safe'|Mode
export type ArenaFocus = 'all'|CreatureState

export type ArenaPlaybackStatus = 'Running'|'Paused'|'Awaiting settlement'|'Extinct'

export interface ArenaPlaybackStatusInput {
  playing: boolean
  populationCount: number
  activeCount: number
}

export interface ArenaPlaybackDetailInput {
  status: ArenaPlaybackStatus
  populationCount: number
  livingCount: number
}

export const ARENA_PATCH_STOCK_KEY = 'Full inner rings = patch stock capacity; colored arcs = current food stock.'
export const ARENA_PATCH_QUALITY_KEY = 'Tinted halo, dashed ring, and label = quality multiplier; greener/brighter patches regrow faster and their food carries more energy.'
export const ARENA_SELECTED_OVERLAY_KEY = 'Selected: gold ring = focus · gold area = sight · dashed path = held destination captured at last decision · endpoint: solid dot = target still present (not current position), × = target gone at its last-known held location, diamond = waypoint · colored rings = memory · dotted rings = kin. Held decisions can persist between reaction windows.'
export const ARENA_HUNT_CONTACT_KEY = 'Hunts resolve against the nearest eligible prey at contact, which may differ from the dashed held destination.'
export const ARENA_FOCUS_TARGET_PATH_KEY = 'Active matches show dashed held destinations captured at last decision: solid dot = target still present (not current position), × = target gone at its last-known held location, diamond = waypoint. Held decisions can persist between reaction windows.'
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

/** The visual meaning of a held destination endpoint. Threats intentionally
 * resolve to a waypoint: their target coordinates are an escape point, not
 * the threat's current location. */
export type ArenaHeldPathEndpointKind = 'none'|'live-food'|'live-prey'|'last-known-food'|'last-known-prey'|'waypoint'

export interface ArenaHeldPathEndpointInput {
  targetType: TargetType | null
  targetId: number | null
  targetX: number
  targetY: number
}

export type ArenaHeldPathCreature = Pick<World['creatures'][number], 'id'|'individualId'|'alive'>
export type ArenaHeldPathFood = Pick<World['food'][number], 'id'>

/** Classify a path endpoint using only current world facts and finite path data. */
export function classifyArenaHeldPathEndpoint(
  target: ArenaHeldPathEndpointInput,
  creatures: ReadonlyArray<ArenaHeldPathCreature> = [],
  food: ReadonlyArray<ArenaHeldPathFood> = [],
): ArenaHeldPathEndpointKind {
  if (target.targetType === null || !Number.isFinite(target.targetX) || !Number.isFinite(target.targetY)) return 'none'
  if (target.targetType === 'home' || target.targetType === 'memory' || target.targetType === 'explore' || target.targetType === 'threat') return 'waypoint'
  if (target.targetType === 'food') return target.targetId !== null && food.some(item => item.id === target.targetId) ? 'live-food' : 'last-known-food'
  return target.targetId !== null && creatures.some(creature => creature.id === target.targetId && creature.alive) ? 'live-prey' : 'last-known-prey'
}

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

export function arenaPlaybackStatus(input: ArenaPlaybackStatusInput): ArenaPlaybackStatus {
  const populationCount = Number.isFinite(input.populationCount) ? Math.max(0, input.populationCount) : 0
  const activeCount = Number.isFinite(input.activeCount) ? Math.max(0, input.activeCount) : 0
  if (populationCount === 0) return 'Extinct'
  if (activeCount === 0) return 'Awaiting settlement'
  return input.playing ? 'Running' : 'Paused'
}

export function formatArenaPlaybackDetail(input: ArenaPlaybackDetailInput): string {
  const populationCount = Number.isFinite(input.populationCount) ? Math.max(0, Math.trunc(input.populationCount)) : 0
  const livingCount = Number.isFinite(input.livingCount) ? Math.max(0, Math.trunc(input.livingCount)) : 0
  if (input.status === 'Extinct' || populationCount === 0) return 'Extinct. The last settlement produced no creatures. Use Founder migration to rescue this run or restart.'
  if (input.status === 'Awaiting settlement') {
    return livingCount > 0
      ? 'Awaiting settlement. No active creature actions remain; all living creatures are home. Finish generation to settle this cohort.'
      : 'Awaiting settlement. All creatures in this generation are dead, but the generation has not been recorded yet. Finish generation to record it, or use Founder migration to rescue the run.'
  }
  return input.status === 'Running'
    ? 'Running. Active creature actions are being simulated.'
    : 'Paused. Resume playback to continue active creature actions.'
}

export function formatArenaDayProgress(dayTime: number, dayLength: number, status: ArenaPlaybackStatus): string {
  const current = Number.isFinite(dayTime) ? Math.max(0, dayTime) : 0
  const duration = Number.isFinite(dayLength) ? Math.max(.1, dayLength) : .1
  return `Day ${current.toFixed(1)} / ${duration.toFixed(1)} · ${status}`
}

export interface ArenaSelectedTargetInput {
  targetType: TargetType | null
  targetId: number | null
  targetX?: number
  targetY?: number
}

type ArenaTargetCreature = Pick<World['creatures'][number], 'id' | 'individualId' | 'alive'>
type ArenaTargetFood = Pick<World['food'][number], 'id'> & { energy?: unknown }

export function formatSelectedTarget(
  target: ArenaSelectedTargetInput,
  creatures: ReadonlyArray<ArenaTargetCreature>,
  food: ReadonlyArray<ArenaTargetFood> = [],
): string {
  const heldLocationShown=Number.isFinite(target.targetX)&&Number.isFinite(target.targetY)
  const unavailableEntity=(kind:string)=>heldLocationShown?`${kind} target gone · held location shown`:`${kind} target · current status unavailable`
  if (target.targetType === null) return 'None'
  if (target.targetType === 'home') return 'Home location'
  if (target.targetType === 'memory') return 'Remembered location'
  if (target.targetType === 'explore') return 'Exploration waypoint'
  if (target.targetType === 'food') {
    const targetFood = target.targetId === null ? undefined : food.find(item => item.id === target.targetId)
    if (!targetFood) return unavailableEntity('Food')
    const energy = targetFood.energy
    if (typeof energy !== 'number' || !Number.isFinite(energy)) return 'Food item'
    const formattedEnergy = Math.max(0, energy).toFixed(Number.isInteger(energy) ? 0 : 1)
    return `Food item · ${formattedEnergy} energy`
  }
  if (target.targetType === 'threat') {
    const targetCreature = target.targetId === null ? undefined : creatures.find(creature => creature.id === target.targetId && creature.alive)
    return targetCreature
      ? heldLocationShown ? `Threat · Individual ${targetCreature.individualId} · path ends at an escape waypoint` : `Threat · Individual ${targetCreature.individualId}`
      : heldLocationShown ? 'Threat target gone · path ends at an escape waypoint' : 'Threat target · current status unavailable'
  }
  if (target.targetId === null) return unavailableEntity('Prey')
  const targetCreature = creatures.find(creature => creature.id === target.targetId && creature.alive)
  return targetCreature ? `Prey · Individual ${targetCreature.individualId}` : unavailableEntity('Prey')
}

function observedCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value!)) : 0
}

function observedQuantity(value: number | undefined, singular: string, plural = `${singular}s`): string {
  const count = observedCount(value)
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Keep maturity commentary tied to a complete, safe survivor partition. A
 * missing or contradictory optional field must not be presented as zero.
 */
function observedMaturityClause(ledger: World['ledger'][number], survivors: number): string {
  const eligible = ledger.birthsEligible
  const immature = (ledger as World['ledger'][number] & { birthsImmature?: unknown }).birthsImmature
  const admitted = ledger.birthsAdmitted
  const capped = ledger.birthsCapped
  if (typeof eligible !== 'number' || !Number.isSafeInteger(eligible) || eligible < 0
    || typeof immature !== 'number' || !Number.isSafeInteger(immature) || immature <= 0
    || typeof admitted !== 'number' || !Number.isSafeInteger(admitted) || admitted < 0
    || typeof capped !== 'number' || !Number.isSafeInteger(capped) || capped < 0
    || eligible < admitted || eligible > survivors || eligible !== admitted + capped) return ''
  const belowThreshold = survivors - eligible - immature
  if (!Number.isSafeInteger(belowThreshold) || belowThreshold < 0) return ''
  return `${immature} energy-ready ${immature === 1 ? 'survivor waited' : 'survivors waited'} for maturity`
}

function observedDecisionLabel(target: TargetType): string {
  return target === 'food' ? 'food' : target === 'prey' ? 'prey' : target === 'threat' ? 'danger' : target === 'home' ? 'home' : target === 'memory' ? 'remembered food' : 'exploration'
}

export function formatObservedDecisionMetadata(decision:Pick<DecisionSummary,'selectionBasis'|'decidedAt'>):string{
  const basis=decision.selectionBasis==='best-utility'
    ? 'basis: highest relative utility'
    : decision.selectionBasis==='commitment'
      ? 'basis: target commitment'
      : decision.selectionBasis==='urgent-override'
        ? 'basis: urgent safety override'
        : ''
  const provenance=decision.decidedAt
  const captured=provenance&&Number.isInteger(provenance.generation)&&provenance.generation>=1&&Number.isFinite(provenance.dayTime)&&provenance.dayTime>=0&&Number.isInteger(provenance.reactionWindow)&&provenance.reactionWindow>=0
    ? `captured Generation ${provenance.generation} · day ${provenance.dayTime.toFixed(2)} · reaction window ${provenance.reactionWindow}`
    : ''
  return [basis,captured].filter(Boolean).join(' · ')
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
    ? `decision recorded as ${observedDecisionLabel(decision.chosen)} (reason noted: ${typeof decision.reason==='string'&&decision.reason.trim()?decision.reason:'not provided'})${formatObservedDecisionMetadata(decision)?` · ${formatObservedDecisionMetadata(decision)}`:''}`
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
  const maturity = observedMaturityClause(ledger, survivors)
  return `Generation ${ledger.generation} recorded ${observedQuantity(ledger.foodConsumed, 'food item')} consumed, ${observedQuantity(ledger.attackAttempts, 'attack attempt')}, ${observedQuantity(ledger.attackSuccesses, 'attack success', 'attack successes')}, ${observedQuantity(survivors, 'survivor')}, and ${observedQuantity(births, 'birth')}${maturity ? `; ${maturity}` : ''} → exact next population: ${nextPopulation}.`
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
    const status = arenaPlaybackStatus({ playing: false, populationCount: world.creatures.length, activeCount: 0 })
    const aggregate = formatArenaPlaybackDetail({ status, populationCount: world.creatures.length, livingCount: living.length })
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
  /** Optional v6 telemetry. Omitted values keep legacy hand-authored worlds quiet. */
  patchQualityVariation?: number
  patchQualityRange?: readonly [number, number]
  hasSelectedCreature: boolean
  hasSelectedPatch?: boolean
  selectedIsHunting?: boolean
  focus?: ArenaFocus
  focusCount?: number
  selectedOutsideFocus?: boolean
  playbackStatus?: ArenaPlaybackStatus
  playbackDetail?: string
}

/**
 * Keep the arena's quality language bounded even when it is asked to describe
 * a retained or hand-authored world with malformed optional telemetry. The
 * simulation's quality bias is normalized to [-1, 1], while contrast is a
 * 0–1 control and represents a 0–2× multiplier range at its maximum.
 */
export function arenaPatchQualityMultiplier(bias: unknown, variation: unknown): number {
  return patchQualityMultiplier(bias, variation)
}

export function arenaPatchQualityRange(
  patches: ReadonlyArray<Pick<World['environment']['patches'][number], 'qualityBias'>>,
  variation: unknown,
): readonly [number, number] | undefined {
  if (typeof variation !== 'number' || !Number.isFinite(variation)) return undefined
  const safeVariation = Math.max(0, Math.min(1, variation))
  if (safeVariation === 0) return [1, 1]
  const values = patches.map(patch => arenaPatchQualityMultiplier(patch.qualityBias, safeVariation)).filter(Number.isFinite)
  if (!values.length) return undefined
  return [Math.max(0, Math.min(2, Math.min(...values))), Math.max(0, Math.min(2, Math.max(...values)))]
}

function formatArenaQualityMultiplier(value: number): string {
  return `${Math.max(0, Math.min(2, value)).toFixed(2)}×`
}

export function formatArenaPatchQualityDescription(
  ecologyMode: World['config']['ecologyMode'],
  variation: unknown,
  range?: readonly [number, number],
): string {
  if (ecologyMode !== 'energy-regrowth' || typeof variation !== 'number' || !Number.isFinite(variation)) return ''
  const safeVariation = Math.max(0, Math.min(1, variation))
  if (safeVariation === 0) return 'Patch quality is uniform at 1.00×; stock rings show capacity and arcs show current food.'
  const safeRange = Array.isArray(range) && range.length === 2 && range.every(value => typeof value === 'number' && Number.isFinite(value))
    ? [Math.max(0, Math.min(2, Math.min(range[0], range[1]))), Math.max(0, Math.min(2, Math.max(range[0], range[1])))] as const
    : undefined
  if (safeRange && safeRange[0] === safeRange[1]) return `Patch quality is uniform at ${formatArenaQualityMultiplier(safeRange[0])}; configured contrast can matter when multiple patches have different intrinsic quality.`
  const boundedRange = safeRange
    ? `Patch quality currently ranges from ${formatArenaQualityMultiplier(safeRange[0])} to ${formatArenaQualityMultiplier(safeRange[1])}. `
    : 'Patch quality contrast is active within a bounded multiplier range. '
  return `${boundedRange}Greener/brighter patches regrow faster; food from richer patches carries more energy.`
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
  const qualityDescription = formatArenaPatchQualityDescription(input.ecologyMode, input.patchQualityVariation, input.patchQualityRange)
  const focusDescription = formatArenaFocusDescription(input.focus ?? 'all',input.focusCount,input.livingCreatures,input.selectedOutsideFocus)
  const allFocusPathDescription = input.focus === 'all' ? ' Choose an action focus to reveal dashed held destinations captured at the last decision for active matches; decisions can persist between reaction windows.' : ''
  const selectionHint = input.hasSelectedCreature || input.hasSelectedPatch
    ? ''
    : 'Select a creature to reveal its focus, sight, target, memory, and same-lineage overlays, or select a resource patch to inspect its live food and production.'
  const playbackDescription = input.playbackDetail
    || (input.playbackStatus ? `Playback status: ${input.playbackStatus}.` : '')
  return `Simulation arena, generation ${input.generation}, ${input.livingCreatures} living creatures: ${input.stateSummary}. ${playbackDescription ? `${playbackDescription} ` : ''}${resourceLabel}. ${qualityDescription ? `${qualityDescription} ` : ''}${input.obstacleCount} obstacles. ${overlayDescription ? `${overlayDescription} ` : ''}${focusDescription}${allFocusPathDescription} ${selectionHint} Creature body color shows speed and the bright body outline shows its current action. Click a creature or resource patch, or use the Inspect selector.`
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

/** Map the normalized speed trait to the body gradient used by the arena and charts. */
export function speedColor(speed: number) {
  const t=Math.max(0,Math.min(1,(speed-.55)/1.15))
  const hue=175+(54-175)*t
  return `hsl(${hue} 58% ${42+t*14}%)`
}
