import { MAX_FOOD, MAX_HISTORY_POINTS, MAX_POPULATION } from './config'
import { END_CAUSES, type World } from './types'

type Check = (value: unknown) => boolean
const number: Check = value => typeof value === 'number' && Number.isFinite(value)
const range = (min: number, max: number): Check => value => number(value) && (value as number) >= min && (value as number) <= max
const normalized = range(0, 1)
// Broad arithmetic guard, well beyond energy attainable within safe generation counters.
const energy = range(-1e30, 1e30)
const count: Check = value => number(value) && Number.isSafeInteger(value) && (value as number) >= 0
const id: Check = value => count(value) && (value as number) > 0
const boolean: Check = value => typeof value === 'boolean'
const string: Check = value => typeof value === 'string' && value.length <= 10_000
const nullable = (check: Check): Check => value => value === null || check(value)
const optional = (check: Check): Check => value => value === undefined || check(value)
const enumeration = (...values: readonly string[]): Check => value => typeof value === 'string' && values.includes(value)
const array = (check: Check, max: number): Check => value => Array.isArray(value) && value.length <= max && value.every(check)
const record = (fields: Record<string, Check>): Check => value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.entries(fields).every(([key, check]) => check((value as Record<string, unknown>)[key]))
const fields = (keys: string, check: Check): Record<string, Check> => Object.fromEntries(keys.split(' ').map(key => [key, check]))
const traits = 'speed size sense aggression caution exploration'
const target = enumeration('food', 'prey', 'threat', 'home', 'memory', 'explore')
const mode = enumeration('exploring', 'foraging', 'hunting', 'fleeing', 'returning')
const perceptionMode = enumeration('perfect', 'realistic')
const intervention = enumeration('resource-bloom', 'drought', 'founder-migration')
const moments = record(fields('mean variance sd', nullable(number)))
const selection = record(fields(traits, moments))
const perceptionCounts = record(fields('total detected range fov occlusion detection', count))
const decision = record({
  chosen: target, reason: string,
  candidates: array(record({ type: target, mode, score: number, reason: string, targetId: nullable(id) }), 16),
  chosenTargetId: optional(nullable(id)), selectionBasis: optional(enumeration('best-utility', 'commitment', 'urgent-override')),
  decidedAt: optional(record({ generation: id, dayTime: number, reactionWindow: number })),
})
const creature = record({
  ...fields('id individualId lineageId birthGeneration', id), parentIndividualId: nullable(id), parentId: optional(id),
  ...fields('angle commitUntil wanderAngle wanderTurn reactionWindow attackCooldownUntil', number),
  ...fields('x y homeX homeY targetX targetY aggression caution exploration', normalized),
  ...fields('speed size', range(.3, 2.8)), sense: range(.035, .6), energy,
  // Ecological motion accelerates toward .055 * speed (maximum trait 2.8).
  // Leave a small rounding margin; classic motion is slower.
  ...fields('vx vy', range(-.155, .155)),
  ...fields('food age', count), ...fields('alive returning home', boolean), mode, targetType: nullable(target), targetId: nullable(id),
  memory: record({ ...fields('foodX foodY threatX threatY', nullable(normalized)), ...fields('foodUntil threatUntil', number) }),
  deathCause: nullable(enumeration('hunted', 'energy')), decisionSummary: optional(decision),
  perceptionDiagnostics: optional(record({ mode: perceptionMode, reactionWindow: number, creatures: perceptionCounts, food: perceptionCounts })),
})
const ledger = record({
  generation: id,
  ...fields('startPopulation foodAtStart foodProduced foodRemoved foodConsumed foodRemaining preyConsumed attackAttempts attackSuccesses attackFailures birthsEligible birthsAdmitted birthsCapped', count),
  ...fields('attackContested birthsImmature', optional(count)), attackAttemptBasis: optional(enumeration('claims', 'admitted')),
  outcomes: record(fields(END_CAUSES.join(' '), count)),
  selection: record(fields('start survivor reproducer', selection)), selectionByOutcome: record(fields(END_CAUSES.join(' '), selection)),
  inheritance: optional(record({ offspringCount: count, changedTraitValues: count, traits: record(fields(traits, record({ parentMean: nullable(number), offspringMean: nullable(number), changedCount: count }))) })),
})
const location: Check = value => Array.isArray(value) && value.length === 2 && value.every(item => number(item) && item >= 0 && item <= 1)
const activity = record({
  ...fields('sequence generation', id), day: number, tick: count, count, summary: string,
  kind: enumeration('food-collected', 'attack-success', 'attack-failure', 'energy-death', 'reached-home', 'natural-regrowth', 'intervention', 'generation-settlement'),
  location: optional(location), actorIds: optional(array(id, MAX_POPULATION * 2)), attackerId: optional(id), preyId: optional(id),
  contestChance: optional(value => number(value) && (value as number) >= 0 && (value as number) <= 1),
})

// Explicit schemas also validate collections that happen to be empty in a fresh world.
// Numbers describing continuous engine state stay finite without imposing config ranges:
// energy can be negative and the accumulated RNG state is not restricted to uint32.
export const validWorldStructure: Check = record({
  generation: id, dayTime: number, tickIndex: count, rngState: number,
  ...fields('nextId nextIndividualId nextLineageId', id),
  ...fields('dayHunted dayFoodProduced dayFoodRemoved dayFoodConsumed dayPreyConsumed dayAttackAttempts dayAttackSuccesses dayAttackFailures dayAttackContested generationFoodStart activityDropped activitySequence', count),
  inspectedIndividualId: nullable(id), lastInspectedOutcome: nullable(record({ individualId: id, generation: id, cause: enumeration('hunted', 'energy', 'unfed', 'late', 'aged') })),
  creatures: array(creature, MAX_POPULATION),
  food: array(record({ id, x: normalized, y: normalized, patchId: nullable(id), energy }), MAX_FOOD),
  environment: record({
    foodBudget: number, targetFood: number,
    patches: array(record({ id, x: normalized, y: normalized, stock: count, accumulator: number, spawnSequence: count, qualityBias: optional(number) }), 12),
    obstacles: array(record({ id, x: normalized, y: normalized, radius: normalized }), 12),
  }),
  history: array(record({ ...fields('generation population', count), ...fields('avgSpeed avgSize avgSense avgAggression avgCaution avgExploration sdSpeed sdSize sdSense sdAggression sdCaution sdExploration avgEnergy avgAge', nullable(number)) }), MAX_HISTORY_POINTS),
  ledger: array(ledger, MAX_HISTORY_POINTS),
  events: array(record({ generation: id, day: number, kind: intervention, summary: string, count, sequence: optional(id) }), 60),
  activity: array(activity, 24), individualActivity: optional(array(activity, 480)), individualActivityDropped: optional(count),
  lastReport: record(fields('survived born starved hunted energy unfed late aged capped', count)),
})

/** Entity IDs share one allocator; individual and lineage identities have separate allocators. */
export function validWorldIdentities(world: World): boolean {
  const entities = [...world.creatures, ...world.food, ...world.environment.patches, ...world.environment.obstacles]
  if (new Set(entities.map(entity => entity.id)).size !== entities.length) return false
  if (new Set(world.creatures.map(creature => creature.individualId)).size !== world.creatures.length) return false
  const entityIds = entities.map(entity => entity.id)
  const individualIds: number[] = []
  const lineageIds: number[] = []
  const retain = (ids: number[], value: number | null | undefined) => { if (value != null) ids.push(value) }
  for (const creature of world.creatures) {
    individualIds.push(creature.individualId)
    retain(individualIds, creature.parentIndividualId)
    retain(individualIds, creature.parentId)
    lineageIds.push(creature.lineageId)
    retain(entityIds, creature.targetId)
    retain(entityIds, creature.decisionSummary?.chosenTargetId)
    for (const candidate of creature.decisionSummary?.candidates ?? []) retain(entityIds, candidate.targetId)
  }
  for (const food of world.food) retain(entityIds, food.patchId)
  retain(individualIds, world.lastInspectedOutcome?.individualId)
  for (const entry of [...world.activity, ...world.individualActivity ?? []]) {
    individualIds.push(...entry.actorIds ?? [])
    retain(individualIds, entry.attackerId)
    retain(individualIds, entry.preyId)
  }
  // inspectedIndividualId may be an arbitrary UI selection, not an allocated identity.
  return entityIds.every(id => id < world.nextId)
    && individualIds.every(id => id < world.nextIndividualId)
    && lineageIds.every(id => id < world.nextLineageId)
}
