import { describe, expect, it, vi } from 'vitest'
import { decodeRun, encodeRun } from './checkpoint'
import { createWorld, defaultConfig, tick, runGeneration, applyIntervention, setInspectedIndividual } from './engine'
import { fallbackController } from './fallbackController'
import { CLASSIC_MODES } from './config'

// Recompute the public damage checksum to exercise structural validation itself.
function rewriteRun(text: string, path: string, value: unknown) {
  const envelope = JSON.parse(text)
  const payload = JSON.parse(envelope.payload)
  const keys = path.split('.')
  let target = payload.world
  for (const key of keys.slice(0, -1)) target = target[key]
  target[keys.at(-1)!] = value
  envelope.payload = JSON.stringify(payload)
  let hash = 2166136261
  for (let i = 0; i < envelope.payload.length; i++) hash = Math.imul(hash ^ envelope.payload.charCodeAt(i), 16777619)
  envelope.checksum = (hash >>> 0).toString(16)
  return JSON.stringify(envelope)
}

describe('saved runs', () => {
  it('validates optional home experience and movement records, while accepting old saves', () => {
    const world=createWorld(defaultConfig), saved=encodeRun(world)
    expect(decodeRun(saved).world.creatures[0].homeExperience).toBeUndefined()
    const experience={foodCount:2,foodX:.4,foodY:.6,dangerCount:0,dangerX:0,dangerY:0}
    expect(decodeRun(rewriteRun(saved,'creatures.0.homeExperience',experience)).world.creatures[0].homeExperience).toEqual(experience)
    expect(()=>decodeRun(rewriteRun(saved,'creatures.0.homeExperience',{...experience,foodX:2}))).toThrow()
    expect(()=>decodeRun(rewriteRun(saved,'creatures.0.homeExperience',{...experience,foodCount:-1}))).toThrow()
    const move={generation:1,fromX:.025,fromY:.3,toX:.025,toY:.36,energyCost:1,reason:'food'}
    expect(decodeRun(rewriteRun(saved,'creatures.0.lastHomeMove',move)).world.creatures[0].lastHomeMove).toEqual(move)
    expect(()=>decodeRun(rewriteRun(saved,'creatures.0.lastHomeMove',{...move,energyCost:-1}))).toThrow()
    expect(()=>decodeRun(rewriteRun(saved,'creatures.0.lastHomeMove',{...move,reason:'random'}))).toThrow()
  })

  it.each([
    ['ledger', [null]], ['ledger.0.selection.start.speed', null],
    ['ledger.0.selectionByOutcome.hunted', {}], ['ledger.0.inheritance', { offspringCount: 1 }],
    ['ledger.0.attackAttemptBasis', 'invalid'], ['events', [{ kind: 'drought' }]],
    ['activity', [null]], ['activity.0.kind', 'invalid'], ['activity.0.summary', {}],
    ['individualActivity.0.actorIds', ['invalid']], ['individualActivity.0.location', [0.5]],
    ['individualActivity.0.contestChance', 2], ['creatures.0.mode', 'invalid'],
    ['creatures.0.size', -1], ['environment.obstacles.0.radius', -1],
    ['creatures.0.size', Number.MAX_VALUE], ['creatures.0.speed', Number.MAX_VALUE],
    ['creatures.0.sense', 0], ['creatures.0.aggression', 2], ['creatures.0.caution', -1],
    ['creatures.0.exploration', Number.MAX_VALUE], ['creatures.0.vx', Number.MAX_VALUE],
    ['creatures.0.vy', -Number.MAX_VALUE], ['creatures.0.energy', Number.MAX_VALUE],
    ['creatures.0.x', 2], ['creatures.0.y', -1], ['creatures.0.homeX', Number.MAX_VALUE],
    ['creatures.0.targetY', Number.MAX_VALUE], ['creatures.0.memory.foodY', 2],
    ['nextId', 1], ['nextIndividualId', 1], ['nextLineageId', 1],
    ['creatures.0.targetType', 'invalid'], ['creatures.0.memory.foodX', 'invalid'],
    ['creatures.0.decisionSummary', { chosen: 'explore', reason: 'test', candidates: [null] }],
    ['creatures.0.decisionSummary', { chosen: 'explore', reason: 'test', candidates: [], selectionBasis: 'invalid' }],
    ['creatures.0.perceptionDiagnostics', { mode: 'realistic', reactionWindow: 1, creatures: {}, food: null }],
    ['environment.patches.0.qualityBias', 'invalid'], ['environment.obstacles', [null]],
    ['food', [{ id: 1, x: 0.5, y: 0.5, patchId: 'invalid', energy: 1 }]],
  ])('rejects correctly checksummed malformed %s', (path, value) => {
    const world = createWorld(defaultConfig)
    runGeneration(world)
    applyIntervention(world, 'resource-bloom')
    expect(() => decodeRun(rewriteRun(encodeRun(world), path, value))).toThrow('damaged')
  })
  it('validates food and obstacles even when both fresh collections are empty', () => {
    const world = createWorld({ ...defaultConfig, foodPerDay: 0, obstacleCount: 0 })
    const text = encodeRun(world)
    expect(decodeRun(text).world).toEqual(world)
    expect(() => decodeRun(rewriteRun(text, 'food', [{}]))).toThrow('damaged')
    expect(() => decodeRun(rewriteRun(text, 'environment.obstacles', [{}]))).toThrow('damaged')
  })
  it('rejects duplicate entity IDs, including collisions across entity types', () => {
    const world = createWorld(defaultConfig)
    const text = encodeRun(world)
    expect(() => decodeRun(rewriteRun(text, 'creatures.1.id', world.creatures[0].id))).toThrow('damaged')
    expect(() => decodeRun(rewriteRun(text, 'food.0.id', world.creatures[0].id))).toThrow('damaged')
    expect(() => decodeRun(rewriteRun(text, 'creatures.1.individualId', world.creatures[0].individualId))).toThrow('damaged')
  })
  it('checks allocators against retained actor identities after extinction', () => {
    const world = createWorld({ ...defaultConfig, initialPopulation: 1, startingEnergy: 10, foodPerDay: 0, foodRegrowthRate: 0, maxAge: 1 })
    setInspectedIndividual(world, world.creatures[0].individualId)
    runGeneration(world); runGeneration(world)
    expect(world.creatures).toHaveLength(0)
    expect(world.individualActivity?.length).toBeGreaterThan(0)
    expect(() => decodeRun(rewriteRun(encodeRun(world), 'nextIndividualId', 1))).toThrow('damaged')
  })
  it('continues evolved runs with fresh identities after migrations', () => {
    const world = createWorld({ ...defaultConfig, mutationRate: 1, mutationStrength: 1 })
    for (let generation = 0; generation < 5; generation++) {
      applyIntervention(world, 'founder-migration')
      runGeneration(world)
      expect(decodeRun(encodeRun(world)).world).toEqual(JSON.parse(JSON.stringify(world)))
    }
    const restored = decodeRun(encodeRun(world)).world
    applyIntervention(world, 'founder-migration'); applyIntervention(restored, 'founder-migration')
    runGeneration(world); runGeneration(restored)
    expect(restored).toEqual(world)
    expect(new Set(restored.creatures.map(creature => creature.individualId)).size).toBe(restored.creatures.length)
  })
  it.each([['ledger', 241], ['events', 61], ['activity', 25], ['individualActivity', 481], ['environment.patches', 13], ['environment.obstacles', 13]])('bounds the %s collection', (path, length) => {
    const world = createWorld(defaultConfig)
    runGeneration(world)
    applyIntervention(world, 'resource-bloom')
    const text = encodeRun(world)
    let collection = JSON.parse(JSON.parse(text).payload).world
    for (const key of String(path).split('.')) collection = collection[key]
    expect(() => decodeRun(rewriteRun(text, String(path), Array.from({ length: Number(length) }, () => collection[0])))).toThrow('damaged')
  })
  it.each([{}, CLASSIC_MODES])('preserves inspected decisions and optional legacy telemetry in %j', modes => {
    const world = createWorld({ ...defaultConfig, ...modes })
    runGeneration(world)
    setInspectedIndividual(world, world.creatures[0].individualId)
    for (let i = 0; i < 20; i++) tick(world, .025)
    expect(world.creatures.some(creature => creature.decisionSummary)).toBe(true)
    const restored = decodeRun(encodeRun(world)).world
    for (let i = 0; i < 20; i++) { tick(world, .025); tick(restored, .025) }
    expect(restored).toEqual(world)
    delete world.individualActivity
    delete world.individualActivityDropped
    for (const ledger of world.ledger) {
      delete ledger.attackContested; delete ledger.attackAttemptBasis; delete ledger.birthsImmature; delete ledger.inheritance
    }
    for (const patch of world.environment.patches) delete patch.qualityBias
    for (const creature of world.creatures) if (creature.decisionSummary) {
      delete creature.decisionSummary.decidedAt; delete creature.decisionSummary.selectionBasis; delete creature.decisionSummary.chosenTargetId
    }
    world.creatures[0].energy = -1
    world.rngState = 2 ** 40
    expect(decodeRun(encodeRun(world)).world).toEqual(JSON.parse(JSON.stringify(world)))
  })
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
