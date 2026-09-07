import { describe, expect, it, vi } from 'vitest'
import { decodeRun, encodeRun } from './checkpoint'
import { createWorld, defaultConfig, tick, runGeneration, applyIntervention, setInspectedIndividual } from './engine'
import { fallbackController } from './fallbackController'

describe('saved runs', () => {
  it('preserves a progressed run and deterministic continuation after JSON storage', () => {
    const original = createWorld(defaultConfig)
    runGeneration(original)
    applyIntervention(original, 'resource-bloom')
    for (let i = 0; i < 33; i++) tick(original, .025)
    const restored = decodeRun(encodeRun(original)).world
    expect(restored).toEqual(JSON.parse(JSON.stringify(original)))
    for (let i = 0; i < 100; i++) { tick(original, .025); tick(restored, .025) }
    expect(restored).toEqual(original)
  })
  it('retains the actor archive across engine generations and saved runs', () => {
    const world = createWorld(defaultConfig)
    runGeneration(world); runGeneration(world)
    expect(new Set(world.individualActivity?.map(entry => entry.generation)).size).toBeGreaterThan(1)
    expect(world.individualActivity!.length).toBeGreaterThan(world.activity.length)
    expect(world.individualActivity!.length).toBeLessThanOrEqual(480)
    expect(decodeRun(encodeRun(world)).world.individualActivity).toEqual(world.individualActivity)
  })
  it('keeps extinction and empty collections saveable', () => {
    const world = createWorld(defaultConfig)
    world.creatures = []; world.food = []
    expect(decodeRun(encodeRun(world)).world).toEqual(world)
  })
  it('roundtrips a terminal inspected outcome', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 1, foodPerDay: 0 })
    setInspectedIndividual(world, world.creatures[0].individualId)
    world.creatures[0].energy = 0
    tick(world, .025)
    runGeneration(world)
    expect(world.lastInspectedOutcome).not.toBeNull()
    expect(decodeRun(encodeRun(world)).world).toEqual(JSON.parse(JSON.stringify(world)))
  })
  it('roundtrips engine-produced extinction and null historical averages', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 1, startingEnergy: 10, foodPerDay: 0, foodRegrowthRate: 0, maxAge: 1 })
    setInspectedIndividual(world, world.creatures[0].individualId)
    runGeneration(world); runGeneration(world)
    expect(world.creatures).toHaveLength(0)
    expect(world.history.at(-1)?.avgSpeed).toBeNull()
    expect(decodeRun(encodeRun(world)).world).toEqual(JSON.parse(JSON.stringify(world)))
  })
  it('rejects damaged, truncated, incompatible and nonfinite saves', () => {
    const world = createWorld(defaultConfig), text = encodeRun(world)
    expect(() => decodeRun(text.slice(0, -1))).toThrow('damaged')
    expect(() => decodeRun(text.replace('"version":1', '"version":2'))).toThrow('unsupported')
    expect(() => decodeRun(text.replace('generation', 'generatiom'))).toThrow('damaged')
    world.creatures[0].energy = Infinity
    expect(() => encodeRun(world)).toThrow('invalid')
  })
  it('restores the fallback paused and resumes from the saved tick', () => {
    vi.useFakeTimers()
    try {
      const saved = createWorld(defaultConfig)
      for (let i = 0; i < 20; i++) tick(saved, .025)
      let observed = createWorld(defaultConfig)
      const controller = fallbackController(defaultConfig, world => { observed = world })
      controller.send({ type: 'play' })
      controller.send({ type: 'restore', world: saved })
      vi.advanceTimersByTime(1000)
      expect(observed).toEqual(saved)
      expect(observed).not.toBe(saved)
      controller.send({ type: 'step', stepId: 1 })
      expect(observed.tickIndex).toBeGreaterThan(saved.tickIndex)
      controller.dispose()
    } finally { vi.useRealTimers() }
  })
})
