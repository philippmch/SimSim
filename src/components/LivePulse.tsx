import { useEffect, useReducer } from 'react'
import type { Creature, Config, World } from '../simulation/types'

/** Counters that are reset when a generation ends. Keep these labels tied to the engine fields. */
export const LIVE_PULSE_COUNTER_KEYS = [
  'dayFoodProduced',
  'dayFoodRemoved',
  'dayFoodConsumed',
  'dayPreyConsumed',
  'dayAttackAttempts',
  'dayAttackSuccesses',
  'dayAttackFailures',
  'dayAttackContested',
] as const

export type LivePulseCounterKey = (typeof LIVE_PULSE_COUNTER_KEYS)[number]
export const LIVE_PULSE_STATES = ['safe', 'exploring', 'foraging', 'hunting', 'fleeing', 'returning'] as const
export type LivePulseState = (typeof LIVE_PULSE_STATES)[number]

/**
 * The pulse only needs a small, stable view of a world. Making optional the
 * telemetry counters lets it read snapshots produced by older saved worlds.
 */
export type LivePulseWorld = {
  generation: number
  dayTime: number
  tickIndex: number
  config: Partial<Config>
  creatures: readonly LivePulseCreature[]
} & Partial<Record<LivePulseCounterKey, number>>

export type LivePulseCreature = Pick<Creature, 'individualId' | 'alive' | 'home' | 'mode' | 'deathCause'>

export type LivePulseStatus = 'baseline' | 'boundary' | 'same-generation'

export type LivePulseCounterDeltas = Record<LivePulseCounterKey, number | null>
export type LivePulseStateChanges = Record<LivePulseState, number>

export interface LivePulseSummary {
  status: LivePulseStatus
  generation: number
  previousGeneration: number | null
  elapsedSeconds: number | null
  counterDeltas: LivePulseCounterDeltas
  deaths: number
  huntedDeaths: number
  energyDeaths: number
  otherDeaths: number
  reachedHome: number
  foundersArrived: number
  stateChanges: LivePulseStateChanges
}

export interface LivePulseTrailEntry {
  sequence: number
  generation: number | null
  dayTime: number | null
  tickIndex: number | null
  text: string
}

export type LivePulseTrailAction =
  | { type: 'snapshot', summary: LivePulseSummary, dayTime: unknown, tickIndex: unknown }
  | { type: 'reset' }

export const MAX_LIVE_PULSE_TRAIL_ENTRIES = 5

/** New snapshots own the bounded key-moment story; older snapshots use this
 * aggregate trail as a compatibility fallback. Presence matters even when the
 * engine buffer is empty, so the two stories never duplicate each other. */
export function hasWorldActivityTelemetry(world: unknown): boolean {
  if (world === null || (typeof world !== 'object' && typeof world !== 'function')) return false
  try {
    return Object.prototype.hasOwnProperty.call(world, 'activity')
  } catch {
    return false
  }
}

export function shouldRenderLivePulseTrail(world: unknown, trail: readonly LivePulseTrailEntry[]): boolean {
  return !hasWorldActivityTelemetry(world) && trail.length > 0
}

const COUNTER_LABELS: Record<LivePulseCounterKey, (count: number) => string> = {
  dayFoodProduced: () => 'food added/grown',
  dayFoodRemoved: () => 'food removed',
  dayFoodConsumed: () => 'food eaten',
  dayPreyConsumed: () => 'prey consumed',
  dayAttackAttempts: count => count === 1 ? 'attack attempt' : 'attack attempts',
  dayAttackSuccesses: count => count === 1 ? 'attack success' : 'attack successes',
  dayAttackFailures: count => count === 1 ? 'attack failure' : 'attack failures',
  dayAttackContested: count => `contested same-prey ${count === 1 ? 'claim' : 'claims'}`,
}

const STATE_LABELS: Record<LivePulseState, string> = {
  safe: 'safe at home',
  exploring: 'exploring',
  foraging: 'finding food',
  hunting: 'hunting prey',
  fleeing: 'fleeing danger',
  returning: 'going home',
}

const COUNTER_FORMAT_ORDER = LIVE_PULSE_COUNTER_KEYS
const STATE_FORMAT_ORDER = LIVE_PULSE_STATES
const MAX_STATE_CLAUSES = 3
const MAX_EVENT_CLAUSES = 12

function emptyCounterDeltas(): LivePulseCounterDeltas {
  return Object.fromEntries(LIVE_PULSE_COUNTER_KEYS.map(key => [key, null])) as LivePulseCounterDeltas
}

function emptyStateChanges(): LivePulseStateChanges {
  return Object.fromEntries(LIVE_PULSE_STATES.map(state => [state, 0])) as LivePulseStateChanges
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function counterDelta(current: unknown, previous: unknown): number | null {
  if (!finiteNumber(current) || !finiteNumber(previous)) return null
  const delta = current - previous
  return Number.isFinite(delta) && delta >= 0 ? delta : null
}

function configRecord(config: unknown): Record<string, unknown> {
  return config !== null && typeof config === 'object' ? config as Record<string, unknown> : {}
}

function configValuesDiffer(previous: LivePulseWorld, current: LivePulseWorld): boolean {
  const previousConfig = configRecord(previous.config)
  const currentConfig = configRecord(current.config)
  const keys = new Set([...Object.keys(previousConfig), ...Object.keys(currentConfig)])
  for (const key of keys) {
    if (!Object.is(previousConfig[key], currentConfig[key])) return true
  }
  return false
}

function creaturesOf(world: LivePulseWorld): readonly LivePulseCreature[] {
  return Array.isArray(world.creatures) ? world.creatures : []
}

function creatureMap(world: LivePulseWorld): Map<number, LivePulseCreature> {
  const result = new Map<number, LivePulseCreature>()
  for (const creature of creaturesOf(world)) {
    if (finiteNumber(creature?.individualId)) result.set(creature.individualId, creature)
  }
  return result
}

function stateFor(creature: LivePulseCreature): LivePulseState | null {
  if (creature.home) return 'safe'
  return LIVE_PULSE_STATES.includes(creature.mode as LivePulseState) ? creature.mode as LivePulseState : null
}

function initialCursor(world: LivePulseWorld): boolean {
  return world.generation === 1 && world.tickIndex === 0 && world.dayTime === 0
}

function initialSummary(status: 'baseline' | 'boundary', generation: number, previousGeneration: number | null): LivePulseSummary {
  return {
    status,
    generation,
    previousGeneration,
    elapsedSeconds: null,
    counterDeltas: emptyCounterDeltas(),
    deaths: 0,
    huntedDeaths: 0,
    energyDeaths: 0,
    otherDeaths: 0,
    reachedHome: 0,
    foundersArrived: 0,
    stateChanges: emptyStateChanges(),
  }
}

function validGeneration(value: unknown): value is number {
  return finiteNumber(value)
}

/** Derive bounded, descriptive changes between two delivered simulation snapshots. */
export function deriveLivePulse(previous: LivePulseWorld | null | undefined, current: LivePulseWorld): LivePulseSummary {
  const generation = validGeneration(current.generation) ? current.generation : 0
  if (!previous || !validGeneration(previous.generation) || !validGeneration(current.generation) || configValuesDiffer(previous, current)) {
    return initialSummary('baseline', generation, previous && validGeneration(previous.generation) ? previous.generation : null)
  }
  if (initialCursor(current) && !initialCursor(previous)) {
    return initialSummary('baseline', generation, previous.generation)
  }
  if (previous.generation !== current.generation) {
    return initialSummary('boundary', generation, previous.generation)
  }

  const counterDeltas = emptyCounterDeltas()
  for (const key of LIVE_PULSE_COUNTER_KEYS) counterDeltas[key] = counterDelta(current[key], previous[key])
  const elapsedSeconds = counterDelta(current.dayTime, previous.dayTime)
  const previousCreatures = creatureMap(previous)
  const currentCreatures = creatureMap(current)
  const stateChanges = emptyStateChanges()
  let deaths = 0
  let huntedDeaths = 0
  let energyDeaths = 0
  let otherDeaths = 0
  let reachedHome = 0
  let foundersArrived = 0

  for (const [individualId, currentCreature] of currentCreatures) {
    const previousCreature = previousCreatures.get(individualId)
    if (!previousCreature) {
      foundersArrived++
      continue
    }
    if (previousCreature.alive && !currentCreature.alive) {
      deaths++
      if (currentCreature.deathCause === 'hunted') huntedDeaths++
      else if (currentCreature.deathCause === 'energy') energyDeaths++
      else otherDeaths++
      continue
    }
    if (!previousCreature.alive || !currentCreature.alive) continue
    if (!previousCreature.home && currentCreature.home) {
      reachedHome++
      continue
    }
    const previousState = stateFor(previousCreature)
    const currentState = stateFor(currentCreature)
    if (previousState && currentState && previousState !== currentState) stateChanges[currentState]++
  }

  return {
    status: 'same-generation',
    generation,
    previousGeneration: previous.generation,
    elapsedSeconds,
    counterDeltas,
    deaths,
    huntedDeaths,
    energyDeaths,
    otherDeaths,
    reachedHome,
    foundersArrived,
    stateChanges,
  }
}

function countText(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded || value)
}

function formatSeconds(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null
  const precision = value < .1 ? 3 : 2
  return `${value.toFixed(precision)} s simulated`
}

function formatStateChange(count: number, state: LivePulseState): string {
  return `${countText(count, 'creature')} shifted to ${STATE_LABELS[state]}`
}

function positiveFinite(value: unknown): value is number {
  return finiteNumber(value) && value > 0
}

function discreteEventParts(summary: LivePulseSummary): string[] {
  const events: string[] = []
  const counterDeltas = summary.counterDeltas !== null && typeof summary.counterDeltas === 'object'
    ? summary.counterDeltas as Partial<LivePulseCounterDeltas>
    : {}
  for (const key of COUNTER_FORMAT_ORDER) {
    const delta = counterDeltas[key]
    if (positiveFinite(delta)) {
      const displayCount = Number(formatNumber(delta))
      events.push(`+${formatNumber(delta)} ${COUNTER_LABELS[key](displayCount)}`)
    }
  }
  if (positiveFinite(summary.deaths)) {
    const huntedDeaths = positiveFinite(summary.huntedDeaths) ? summary.huntedDeaths : 0
    const energyDeaths = positiveFinite(summary.energyDeaths) ? summary.energyDeaths : 0
    const otherDeaths = positiveFinite(summary.otherDeaths) ? summary.otherDeaths : 0
    if (huntedDeaths > 0) events.push(countText(huntedDeaths, 'hunted death'))
    if (energyDeaths > 0) events.push(countText(energyDeaths, 'energy death'))
    const classifiedDeaths = huntedDeaths + energyDeaths + otherDeaths
    const unclassified = Math.max(otherDeaths, summary.deaths - classifiedDeaths)
    if (unclassified > 0) events.push(countText(unclassified, 'creature death'))
  }
  if (positiveFinite(summary.reachedHome)) events.push(countText(summary.reachedHome, 'creature reached home', 'creatures reached home'))
  if (positiveFinite(summary.foundersArrived)) events.push(countText(summary.foundersArrived, 'founder arrived', 'founders arrived'))
  return events
}

function formatLivePulseParts(summary: LivePulseSummary): string[] {
  if (summary.status === 'baseline') return ['Waiting for the next simulation update.']
  if (summary.status === 'boundary') return [`Generation ${summary.previousGeneration ?? '?'} ended → Generation ${summary.generation} started; interval counters reset.`]

  const parts: string[] = ['Since last update']
  const seconds = formatSeconds(summary.elapsedSeconds)
  if (seconds) parts.push(seconds)
  const events = discreteEventParts(summary)

  const stateEntries = STATE_FORMAT_ORDER.filter(state => summary.stateChanges[state] > 0)
  const visibleStates = stateEntries.slice(0, MAX_STATE_CLAUSES)
  for (const state of visibleStates) events.push(formatStateChange(summary.stateChanges[state], state))
  if (stateEntries.length > MAX_STATE_CLAUSES) {
    const remaining = stateEntries.slice(MAX_STATE_CLAUSES).reduce((sum, state) => sum + summary.stateChanges[state], 0)
    events.push(countText(remaining, 'creature shifted to another action', 'creatures shifted to other actions'))
  }

  if (!events.length) {
    if (summary.elapsedSeconds === 0) return [...parts, 'No simulated time elapsed', 'no discrete events recorded.']
    if (summary.elapsedSeconds !== null && summary.elapsedSeconds > 0) return [...parts, 'Movement continues', 'no discrete events recorded.']
    return [...parts, 'No discrete events recorded.']
  }
  if (events.length <= MAX_EVENT_CLAUSES) return [...parts, ...events]
  const visibleEvents = events.slice(0, MAX_EVENT_CLAUSES - 1)
  const omitted = events.length - visibleEvents.length
  return [...parts, ...visibleEvents, countText(omitted, 'additional update', 'additional updates')]
}

/** Format the pulse as deterministic, compact prose suitable for visual and assistive output. */
export function formatLivePulse(summary: LivePulseSummary): string {
  return formatLivePulseParts(summary).join(' · ')
}

function trailEventText(summary: LivePulseSummary): string | null {
  if (summary.status === 'boundary') {
    return `Generation ${finiteNumber(summary.previousGeneration) ? summary.previousGeneration : '?'} ended → Generation ${finiteNumber(summary.generation) ? summary.generation : '?'} started`
  }
  if (summary.status !== 'same-generation') return null
  const resources: string[] = []
  const hunts: string[] = []
  const population: string[] = []
  const counterDeltas = summary.counterDeltas !== null && typeof summary.counterDeltas === 'object'
    ? summary.counterDeltas as Partial<LivePulseCounterDeltas>
    : {}
  for (const key of COUNTER_FORMAT_ORDER) {
    const delta = counterDeltas[key]
    if (!positiveFinite(delta)) continue
    const event = `+${formatNumber(delta)} ${COUNTER_LABELS[key](Number(formatNumber(delta)))}`
    if (key === 'dayFoodProduced' || key === 'dayFoodRemoved' || key === 'dayFoodConsumed') resources.push(event)
    else hunts.push(event)
  }
  if (positiveFinite(summary.deaths)) {
    const huntedDeaths = positiveFinite(summary.huntedDeaths) ? summary.huntedDeaths : 0
    const energyDeaths = positiveFinite(summary.energyDeaths) ? summary.energyDeaths : 0
    const otherDeaths = positiveFinite(summary.otherDeaths) ? summary.otherDeaths : 0
    if (huntedDeaths > 0) population.push(countText(huntedDeaths, 'hunted death'))
    if (energyDeaths > 0) population.push(countText(energyDeaths, 'energy death'))
    const classifiedDeaths = huntedDeaths + energyDeaths + otherDeaths
    const unclassified = Math.max(otherDeaths, summary.deaths - classifiedDeaths)
    if (unclassified > 0) population.push(countText(unclassified, 'creature death'))
  }
  if (positiveFinite(summary.reachedHome)) population.push(countText(summary.reachedHome, 'creature reached home', 'creatures reached home'))
  if (positiveFinite(summary.foundersArrived)) population.push(countText(summary.foundersArrived, 'founder arrived', 'founders arrived'))
  const families = [
    resources.length ? `Resources: ${resources.join(', ')}` : null,
    hunts.length ? `Hunts: ${hunts.join(', ')}` : null,
    population.length ? `Population: ${population.join(', ')}` : null,
  ].filter((family): family is string => family !== null)
  return families.length ? families.join(' · ') : null
}

/** Retain only noteworthy simulation intervals; baseline/reset actions deliberately clear prior context. */
export function reduceLivePulseTrail(state: readonly LivePulseTrailEntry[], action: LivePulseTrailAction): readonly LivePulseTrailEntry[] {
  if (action.type === 'reset' || action.summary.status === 'baseline') return []
  const text = trailEventText(action.summary)
  if (!text) return state
  const latestSequence = state.reduce((latest, entry) => positiveFinite(entry?.sequence) ? Math.max(latest, entry.sequence) : latest, 0)
  const entry: LivePulseTrailEntry = {
    sequence: latestSequence + 1,
    generation: finiteNumber(action.summary.generation) ? action.summary.generation : null,
    dayTime: finiteNumber(action.dayTime) && action.dayTime >= 0 ? action.dayTime : null,
    tickIndex: finiteNumber(action.tickIndex) && action.tickIndex >= 0 ? action.tickIndex : null,
    text,
  }
  return [entry, ...state].slice(0, MAX_LIVE_PULSE_TRAIL_ENTRIES)
}

export function formatLivePulseTrailEntry(entry: LivePulseTrailEntry): string {
  const generation = finiteNumber(entry.generation) ? formatNumber(entry.generation) : '?'
  const day = finiteNumber(entry.dayTime) && entry.dayTime >= 0 ? entry.dayTime.toFixed(2) : '?'
  return `Generation ${generation} · day ${day} · ${entry.text}`
}

interface LivePulseViewState {
  world: LivePulseWorld
  summary: LivePulseSummary
  trail: readonly LivePulseTrailEntry[]
}

function initialViewState(world: LivePulseWorld): LivePulseViewState {
  return { world, summary: deriveLivePulse(null, world), trail: [] }
}

function advanceViewState(state: LivePulseViewState, world: LivePulseWorld): LivePulseViewState {
  if (state.world === world) return state
  const summary = deriveLivePulse(state.world, world)
  const trail = reduceLivePulseTrail(state.trail, { type: 'snapshot', summary, dayTime: world.dayTime, tickIndex: world.tickIndex })
  return { world, summary, trail }
}

export function LivePulse({ world }: { world: World }) {
  const [view, advance] = useReducer(advanceViewState, world, initialViewState)
  useEffect(() => {
    advance(world)
  }, [world])

  const { summary, trail } = view
  const text = formatLivePulse(summary)
  const parts = formatLivePulseParts(summary)
  const trailTexts = trail.map(formatLivePulseTrailEntry)
  return <>
    <div className="ecology-line activity-line" role="group" aria-label={`Live simulation pulse. ${text}`}>
      <strong>Live pulse</strong>
      {parts.map((part, index) => <span key={`${index}-${part}`}>{part}</span>)}
    </div>
    {shouldRenderLivePulseTrail(world, trail) && <div className="ecology-line activity-line" role="group" aria-label="Recent simulation activity, newest first">
      <strong>Recent activity</strong>
      <ol aria-label="Recent simulation activity, newest first" style={{ flex: '1 1 100%', minWidth: 0, margin: 0, padding: 0, listStyle: 'none' }}>
        {trail.map((entry, index) => <li key={entry.sequence} style={{ minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{trailTexts[index]}</li>)}
      </ol>
    </div>}
  </>
}

export default LivePulse
