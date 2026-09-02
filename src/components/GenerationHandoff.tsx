import type { CSSProperties, ReactNode } from 'react'
import type { World } from '../simulation/types'
import type { ArenaPlaybackStatus } from './ArenaCanvasModel'
import { GenerationForecast } from './GenerationForecast'
import RecordedGenerationHandoff from './RecordedGenerationHandoff'

interface RecordLike {
  [key: string]: unknown
}

function record(value: unknown): RecordLike | null {
  return value !== null && typeof value === 'object' ? value as RecordLike : null
}

function read(value: unknown, key: string): unknown {
  const source = record(value)
  if (!source) return undefined
  try {
    return source[key]
  } catch {
    return undefined
  }
}

function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function safeGeneration(value: unknown): number | null {
  const generation = safeCount(value)
  return generation !== null && generation >= 1 && generation < Number.MAX_SAFE_INTEGER ? generation : null
}

function safeFiniteNonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function formatNextGeneration(value: unknown): string {
  const generation = safeGeneration(value)
  return generation === null ? 'the next generation' : `Generation ${generation + 1}`
}

export function formatGenerationHandoffDay(dayTime: unknown, dayLength: unknown): string {
  const current = safeFiniteNonnegative(dayTime)
  const duration = safeFiniteNonnegative(dayLength)
  if (current === null || duration === null || duration <= 0 || current > duration) return 'Day progress unavailable'
  return `Day ${current.toFixed(1)} / ${duration.toFixed(1)}`
}

export function formatGenerationHandoffPopulation(living: unknown, total: unknown): string {
  const livingCount = safeCount(living)
  const totalCount = safeCount(total)
  if (livingCount === null || totalCount === null || livingCount > totalCount) return 'Living population unavailable'
  return `${livingCount} living · ${totalCount} in cohort`
}

export function formatGenerationHandoffPhase(status: ArenaPlaybackStatus, playing = false): string {
  if (status === 'Running') return 'Running'
  if (status === 'Paused') return 'Paused'
  if (status === 'Awaiting settlement') return playing ? 'Awaiting settlement · playback running' : 'Awaiting settlement · playback paused'
  return 'Extinct'
}

function countCreatures(world: unknown): { living: number | null; total: number | null; active: number | null } {
  const creatures = read(world, 'creatures')
  if (!Array.isArray(creatures)) return { living: null, total: null, active: null }
  let living = 0
  let active = 0
  let livingKnown = true
  let activeKnown = true
  for (const creature of creatures) {
    const alive = read(creature, 'alive')
    if (typeof alive !== 'boolean') {
      livingKnown = false
      activeKnown = false
      continue
    }
    if (alive) {
      living += 1
      const home = read(creature, 'home')
      if (typeof home !== 'boolean') activeKnown = false
      else if (!home) active += 1
    }
  }
  return { living: livingKnown ? safeCount(living) : null, total: safeCount(creatures.length), active: activeKnown ? safeCount(active) : null }
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function safePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function safeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isForecastWorld(world: unknown): world is World {
  const source = record(world)
  const config = read(world, 'config')
  const creatures = read(world, 'creatures')
  const generation = read(world, 'generation')
  const seed = read(config, 'seed')
  const mode = read(config, 'ecologyMode')
  const startingEnergy = read(config, 'startingEnergy')
  const energyRetention = read(config, 'energyRetention')
  const reproductionEnergyCost = read(config, 'reproductionEnergyCost')
  const offspringEnergy = read(config, 'offspringEnergy')
  const maxAge = read(config, 'maxAge')
  if (!source || Array.isArray(world) || !record(config) || Array.isArray(config) || !Array.isArray(creatures) ||
      safeGeneration(generation) === null || !safePositiveInteger(seed) ||
      (mode !== 'classic' && mode !== 'energy-regrowth') || !finiteNonnegative(startingEnergy) ||
      !finiteNonnegative(energyRetention) || energyRetention > 1 || !finiteNonnegative(reproductionEnergyCost) ||
      !finiteNonnegative(offspringEnergy) || !safePositiveInteger(maxAge)) return false
  return creatures.every(creature => {
    const item = record(creature)
    if (!item || Array.isArray(creature) || !safePositiveInteger(read(item, 'id')) || !safePositiveInteger(read(item, 'individualId')) ||
        typeof read(item, 'alive') !== 'boolean' || typeof read(item, 'home') !== 'boolean' ||
        !finiteNonnegative(read(item, 'food')) || typeof read(item, 'energy') !== 'number' || !Number.isFinite(read(item, 'energy')) ||
        !safeNonnegativeInteger(read(item, 'age'))) return false
    const deathCause = read(item, 'deathCause')
    return deathCause === null || deathCause === 'hunted' || deathCause === 'energy'
  })
}

export interface GenerationHandoffProps {
  world: World | unknown
  playbackStatus: ArenaPlaybackStatus
  playing?: boolean
  /** Pass null when a malformed legacy snapshot cannot support a forecast. */
  forecast?: ReactNode
  onReviewGeneration: (generation: number) => void
  /** Set only for an explicit Finish generation request; autoplay leaves this null. */
  revealGeneration?: number | null
  /** Called only after the matching actual lane has been scrolled successfully. */
  onRevealComplete?: (generation: number) => void
}

const currentLaneStyle: CSSProperties = {
  flex: '1 1 270px',
  minWidth: 0,
  borderLeft: '3px dashed var(--accent)',
  paddingLeft: '9px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
}

const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', minWidth: 0 }
const detailStyle: CSSProperties = { color: 'var(--muted)', lineHeight: 1.45, whiteSpace: 'normal' }

function CurrentStateLane({
  world,
  playbackStatus,
  playing,
  living,
  total,
  active,
}: {
  world: World | unknown
  playbackStatus: ArenaPlaybackStatus
  playing: boolean
  living: number | null
  total: number | null
  active: number | null
}) {
  const generation = safeGeneration(read(world, 'generation'))
  const dayLength = read(read(world, 'config'), 'dayLength')
  const dayTime = read(world, 'dayTime')
  const phase = formatGenerationHandoffPhase(playbackStatus, playing)
  const population = formatGenerationHandoffPopulation(living, total)

  let detail: string
  if (playbackStatus === 'Awaiting settlement') {
    const generationText = generation === null ? 'This cohort' : `Generation ${generation}`
    const reason = living === null || active === null
      ? 'current activity counts are unavailable'
      : living === 0
        ? 'all creatures are dead'
        : active === 0
          ? 'all living creatures are home'
          : 'no active creature actions remain'
    detail = `${generationText} is ready to settle because ${reason}. Finish generation records it and starts ${formatNextGeneration(generation)}.`
  } else if (playbackStatus === 'Extinct') {
    detail = 'No living cohort remains in the arena. Use Founder migration in Live shocks below to rescue this run, or Restart run above to begin again.'
  } else if (active === null || living === null) {
    detail = 'Choose Next action to advance a decision beat, or Finish generation to record the current cohort.'
  } else if (active > 0) {
    detail = 'Choose Next action to inspect the next decision beat, or Finish generation to record the cohort when ready.'
  } else if (living > 0) {
    detail = 'All living creatures are home. Finish generation to record this cohort.'
  } else {
    detail = 'No living creatures remain in this cohort. Finish generation to record its outcomes.'
  }

  return <div data-handoff-kind="current" style={currentLaneStyle}>
    <span style={labelStyle}><strong>Current state</strong><small>{generation === null ? 'Generation unavailable' : `Generation ${generation}`} · {phase}</small></span>
    <span style={detailStyle}>{formatGenerationHandoffDay(dayTime, dayLength)} · {population}</span>
    <span style={detailStyle}>{detail}</span>
  </div>
}

export function GenerationHandoff({
  world,
  playbackStatus,
  playing = false,
  forecast,
  onReviewGeneration,
  revealGeneration,
  onRevealComplete,
}: GenerationHandoffProps) {
  const { living, total, active } = countCreatures(world)
  const ledgers = read(world, 'ledger')
  const hasRecords = Array.isArray(ledgers) && ledgers.length > 0
  const forecastNode = forecast === undefined
    ? isForecastWorld(world) ? <GenerationForecast world={world} playbackStatus={playbackStatus}/> : null
    : forecast
  const currentContext = playbackStatus === 'Extinct' ? 'No current cohort' : 'Current cohort'
  const forecastContext = forecastNode ? playbackStatus === 'Extinct' ? 'no settlement preview' : 'if settled now' : null
  const comparisonContext = [currentContext, forecastContext, hasRecords ? 'previous recorded result' : 'no recorded result yet'].filter(Boolean).join(' · ')
  return <div className="interventions" role="group" aria-label="Generation handoff" style={{ alignItems: 'stretch', flexWrap: 'wrap', gap: '8px 14px' }}>
    <span style={{ flex: '1 1 100%', minWidth: 0, marginRight: 0, whiteSpace: 'normal' }}><strong style={{ fontSize: 12 }}>Generation handoff</strong><small>{comparisonContext}</small></span>
    <CurrentStateLane world={world} playbackStatus={playbackStatus} playing={playing} living={living} total={total} active={active}/>
    {forecastNode}
    {hasRecords && <RecordedGenerationHandoff ledgers={ledgers} onReviewGeneration={onReviewGeneration} revealGeneration={revealGeneration} onRevealComplete={onRevealComplete}/>}
  </div>
}

export default GenerationHandoff
