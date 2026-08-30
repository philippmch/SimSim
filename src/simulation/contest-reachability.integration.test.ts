import { describe, expect, it } from 'vitest'
import { defaultConfig } from './config'
import { createWorld, runGeneration } from './engine'
import { decide } from './behavior'

describe('contest predation reachability', () => {
  it('lets an aggressive equal-size creature choose a contest prey target', () => {
    const world = createWorld({
      ...defaultConfig,
      initialPopulation: 2,
      foodPerDay: 0,
      obstacleCount: 0,
      founderPhysicalVariation: 0,
      founderBehaviorVariation: 0,
    })
    const [hunter, prey] = world.creatures
    Object.assign(hunter, {
      x: .5, y: .5, homeX: .05, homeY: .05, size: 1, speed: 2, sense: .25,
      energy: 140, aggression: 1, caution: 0, food: 0, returning: false, home: false,
    })
    Object.assign(prey, {
      x: .58, y: .5, size: 1, speed: .4, energy: 20, caution: 0, home: false,
    })

    const decision = decide(hunter, [hunter, prey], [], world.config, 0, 1)
    expect(decision.targetType).toBe('prey')
    expect(decision.targetId).toBe(prey.id)
    expect(decision.mode).toBe('hunting')
  })

  it('chooses a farther profitable prey instead of an unprofitable nearer equal', () => {
    const world = createWorld({
      ...defaultConfig,
      ecologyMode: 'classic',
      perceptionMode: 'perfect',
      initialPopulation: 3,
      foodPerDay: 0,
      obstacleCount: 0,
      founderPhysicalVariation: 0,
      founderBehaviorVariation: 0,
    })
    const [hunter, nearEqual, farSmaller] = world.creatures
    Object.assign(hunter, {
      x: .5, y: .5, homeX: .05, homeY: .05, size: 1, speed: 1, sense: .25,
      energy: 100, aggression: .5, caution: 0, food: 0, returning: false, home: false,
    })
    Object.assign(nearEqual, {
      x: .58, y: .5, size: 1, speed: 2.8, energy: 300, caution: 1, home: false,
    })
    Object.assign(farSmaller, {
      x: .63, y: .5, size: .8, speed: .3, energy: 20, caution: 0, home: false,
    })

    const decision = decide(hunter, [hunter, nearEqual, farSmaller], [], world.config, 0, 1)
    expect(decision.targetType).toBe('prey')
    expect(decision.targetId).toBe(farSmaller.id)
  })

  it('rejects stale self, dead, and home prey targets', () => {
    const world = createWorld({
      ...defaultConfig,
      ecologyMode: 'classic',
      perceptionMode: 'perfect',
      initialPopulation: 2,
      foodPerDay: 0,
      obstacleCount: 0,
      founderPhysicalVariation: 0,
      founderBehaviorVariation: 0,
    })
    const [hunter, stale] = world.creatures
    Object.assign(hunter, {
      x: .5, y: .5, homeX: .05, homeY: .05, size: 1, speed: 1, sense: .25,
      energy: 100, aggression: 1, caution: 0, food: 0, returning: false, home: false,
      targetType: 'prey', targetId: hunter.id,
    })
    const decisionFor = (target: typeof stale) => decide(hunter, [hunter, target], [], world.config, 0, 1)
    expect(decisionFor(hunter).targetId).not.toBe(hunter.id)

    Object.assign(stale, { x: .55, y: .5, size: 1, alive: false, home: false })
    expect(decisionFor(stale).targetId).not.toBe(stale.id)
    Object.assign(stale, { alive: true, home: true })
    expect(decisionFor(stale).targetId).not.toBe(stale.id)
  })

  it('uses attacker-to-actor eligibility for reversed threat detection', () => {
    const world = createWorld({
      ...defaultConfig,
      ecologyMode: 'classic',
      perceptionMode: 'perfect',
      predationMode: 'threshold',
      initialPopulation: 2,
      foodPerDay: 0,
      obstacleCount: 0,
      founderPhysicalVariation: 0,
      founderBehaviorVariation: 0,
    })
    const [small, large] = world.creatures
    Object.assign(small, {
      x: .5, y: .5, homeX: .05, homeY: .05, size: 1, sense: .25,
      energy: 100, aggression: 0, caution: 1, food: 0, home: false,
    })
    Object.assign(large, { x: .58, y: .5, size: 1.2, home: false })

    const decision = decide(small, [small, large], [], world.config, 0, 1)
    expect(decision.targetType).toBe('threat')
    expect(decision.targetId).toBe(large.id)
  })

  it('records admitted contest attempts in a deterministic default ecological run', () => {
    const run = (seed: number) => {
      const world = createWorld({ ...defaultConfig, seed })
      for (let generation = 0; generation < 2; generation++) runGeneration(world)
      return world.ledger.map(ledger => ({
        generation: ledger.generation,
        attempts: ledger.attackAttempts,
        successes: ledger.attackSuccesses,
        population: ledger.outcomes.survived + ledger.birthsAdmitted,
      }))
    }

    const first = run(1)
    expect(first.some(ledger => ledger.attempts > 0)).toBe(true)
    expect(run(1)).toEqual(first)
  })

})
