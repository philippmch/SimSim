import type { World, WorldActivityEntry } from './types'

/** Separate from the short arena review trail; shared across all individuals. */
export const MAX_INDIVIDUAL_ACTIVITY = 480
const validActor = (id: unknown) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0
const hasActor = (entry: WorldActivityEntry) => validActor(entry.attackerId) || validActor(entry.preyId) || (Array.isArray(entry.actorIds) && entry.actorIds.some(validActor))

/** Called once for each newly produced event, before the short activity trail evicts it. */
export function retainIndividualActivity(world: World, entry: WorldActivityEntry): void {
  if (!Array.isArray(world.individualActivity)) {
    // An older checkpoint can preserve the actor records still available at migration time.
    world.individualActivity = (Array.isArray(world.activity) ? world.activity.filter(hasActor) : []).slice(-MAX_INDIVIDUAL_ACTIVITY)
  }
  if (!hasActor(entry)) return
  world.individualActivity.push({ ...entry, ...(entry.actorIds ? { actorIds: [...entry.actorIds] } : {}), ...(entry.location ? { location: [...entry.location] as [number, number] } : {}) })
  const excess = Math.max(0, world.individualActivity.length - MAX_INDIVIDUAL_ACTIVITY)
  if (excess) world.individualActivity.splice(0, excess)
  // Missing legacy counters remain unknown; zero would imply a complete archive.
  if (typeof world.individualActivityDropped === 'number' && Number.isSafeInteger(world.individualActivityDropped) && world.individualActivityDropped >= 0) {
    world.individualActivityDropped = Math.min(Number.MAX_SAFE_INTEGER, world.individualActivityDropped + excess)
  }
}
