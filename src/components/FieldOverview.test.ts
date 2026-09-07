import { describe, expect, it } from 'vitest'
import { createWorld, defaultConfig } from '../simulation/engine'
import { describeField } from './FieldOverview'

describe('live field explanation', () => {
  it('uses living creatures only and does not infer scarcity or motivations from food counts', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 4 })
    world.creatures[0].alive = false
    world.creatures.slice(1).forEach(c => { c.mode = 'foraging' })
    world.food = []
    expect(describeField(world)).toBe('Most creatures are looking for food. There is no food on the ground right now.')
  })
  it('does not call a minority most when the others are resting', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 4 })
    world.creatures.slice(1).forEach(c => { c.home = true })
    expect(describeField(world)).toContain('1 creature is exploring')
  })
  it('distinguishes ecological rest, classic rest, and extinction', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 1 })
    world.creatures[0].home = true
    expect(describeField(world)).toContain('Energy still falls')
    world.config.ecologyMode = 'classic'
    expect(describeField(world)).not.toContain('Energy still falls')
    world.creatures[0].alive = false
    expect(describeField(world)).toContain('Finish generation')
    world.creatures = []
    expect(describeField(world)).toContain('extinct')
  })
})
