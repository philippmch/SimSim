import { describe, expect, it } from 'vitest'
import { defaultConfig } from './config'
import { createWorld } from './engine'
import { MAX_INDIVIDUAL_ACTIVITY, retainIndividualActivity } from './individualHistory'
import type { World, WorldActivityEntry } from './types'

const event = (sequence: number): WorldActivityEntry => ({ sequence, generation: Math.ceil(sequence / 40), tick: sequence, day: 1, kind: 'food-collected', summary: 'Food', count: 1, actorIds: [7], location: [.2, .3] })

describe('individual event archive', () => {
  it('retains actor events across generations, bounds memory, and counts evictions', () => {
    const world = createWorld(defaultConfig)
    world.individualActivity = []
    world.individualActivityDropped = 0
    for (let sequence = 1; sequence <= MAX_INDIVIDUAL_ACTIVITY + 12; sequence++) retainIndividualActivity(world, event(sequence))
    expect(world.individualActivity).toHaveLength(MAX_INDIVIDUAL_ACTIVITY)
    expect(world.individualActivity[0].sequence).toBe(13)
    expect(world.individualActivity.at(-1)?.sequence).toBe(492)
    expect(world.individualActivityDropped).toBe(12)
    const count = world.individualActivity.length
    retainIndividualActivity(world, { ...event(493), actorIds: [], kind: 'natural-regrowth' })
    expect(world.individualActivity).toHaveLength(count)
    expect(world.individualActivityDropped).toBe(12)
  })

  it('retains explicit attack roles without generic actors and copies mutable event coordinates', () => {
    const world = createWorld(defaultConfig)
    world.individualActivity = []
    const entry: WorldActivityEntry = { ...event(1), actorIds: [], attackerId: 7, preyId: 8 }
    retainIndividualActivity(world, entry)
    entry.location![0] = .9
    entry.actorIds!.push(99)
    expect(world.individualActivity[0]).toMatchObject({ attackerId: 7, preyId: 8, actorIds: [], location: [.2, .3] })
  })

  it('migrates available legacy records without inventing archive completeness', () => {
    const world = createWorld(defaultConfig)
    delete world.individualActivity
    delete world.individualActivityDropped
    world.activity = [event(1), { ...event(2), actorIds: [] }]
    retainIndividualActivity(world, event(3))
    expect((world as World).individualActivity?.map(entry => entry.sequence)).toEqual([1, 3])
    expect(world.individualActivityDropped).toBeUndefined()
  })
})
