import { describe, expect, it } from 'vitest'
import { defaultConfig } from './config'
import { keyedRandom } from './random'
import type { Config } from './types'
import {
  attackContactRadius, collectAttackClaims, contestSuccessProbability, createAttackClaim,
  isPredationSizeEligible, resolveAttackClaims, THRESHOLD_PREY_ENERGY, type AttackClaim, type PredationParticipant,
} from './predation'

const participant = (id: number, extra: Partial<PredationParticipant> = {}): PredationParticipant => ({
  id, individualId: id * 10, x: .5, y: .5, size: 1, speed: 1, energy: 100, aggression: .5, caution: .5, alive: true, home: false, ...extra,
})
const threshold = { ...defaultConfig, predationMode: 'threshold' as const, predatorRatio: 1.2, attackCost: 99, handlingTime: 9, preyEnergy: 177 }
const contest = { ...defaultConfig, predationMode: 'contest' as const, predatorRatio: 1.2, attackCost: 4, handlingTime: .45, preyEnergy: 30 }
const context = { seed: 77, generation: 3, tick: 42 }
const claim = (attacker: PredationParticipant, prey: PredationParticipant, config: Config = contest) => createAttackClaim(attacker, prey, config)!

describe('threshold predation golden behavior', () => {
  it('keeps the legacy ratio, strict contact, instant reward, and no cost, draw, or cooldown', () => {
    const prey = participant(2)
    const attacker = participant(1, { size: 1.2, x: prey.x + attackContactRadius({ size: 1.2 }) - 1e-9 })
    const resolution = resolveAttackClaims([claim(attacker, prey, threshold)], threshold, context)
    expect(resolution.successes).toHaveLength(1)
    expect(resolution.successes[0]).toMatchObject({ success: true, probability: 1, draw: null, attackerEnergyDelta: THRESHOLD_PREY_ENERGY, cooldown: 0 })
    expect(resolution.energyDeltas).toEqual([{ id: 1, individualId: 10, delta: 30 }])
    expect(resolution.cooldowns).toEqual([])
    expect(createAttackClaim({ ...attacker, x: prey.x + attackContactRadius(attacker) + 1e-9 }, prey, threshold)).toBeNull()
    expect(createAttackClaim({ ...attacker, size: 1.2 - 1e-10, x: prey.x }, prey, threshold)).toBeNull()
  })
})

describe('contest policy', () => {
  it('admits an equal-size in-contact contest while threshold keeps the hard ratio', () => {
    const attacker = participant(1), prey = participant(2)
    expect(isPredationSizeEligible(attacker, prey, contest)).toBe(true)
    expect(isPredationSizeEligible(attacker, prey, threshold)).toBe(false)
    expect(createAttackClaim(attacker, prey, contest)).not.toBeNull()
    expect(createAttackClaim(attacker, prey, threshold)).toBeNull()
    expect(resolveAttackClaims([createAttackClaim(attacker, prey, contest)!], contest, context).admitted).toHaveLength(1)
  })

  it('keeps equal-size contest admission deterministic under participant and claim permutation', () => {
    const first = participant(1, { x: .49 }), second = participant(2, { x: .51 }), prey = participant(3)
    const forward = collectAttackClaims([first, second], [prey], contest)
    const reverse = collectAttackClaims([second, first], [prey], contest)
    expect(reverse).toEqual(forward)
    expect(resolveAttackClaims([...reverse].reverse(), contest, context)).toEqual(resolveAttackClaims(forward, contest, context))
  })

  it('is monotonic in every modeled advantage and disadvantage', () => {
    const prey = participant(2, { caution: .4 })
    const baseline = participant(1, { size: 1.2, aggression: .4 })
    const p = contestSuccessProbability(baseline, prey, contest)
    expect(contestSuccessProbability({ ...baseline, size: 1.5 }, prey, contest)).toBeGreaterThan(p)
    expect(contestSuccessProbability({ ...baseline, speed: 1.5 }, prey, contest)).toBeGreaterThan(p)
    expect(contestSuccessProbability({ ...baseline, energy: 180 }, prey, contest)).toBeGreaterThan(p)
    expect(contestSuccessProbability({ ...baseline, aggression: .8 }, prey, contest)).toBeGreaterThan(p)
    expect(contestSuccessProbability(baseline, { ...prey, caution: .8 }, contest)).toBeLessThan(p)
    expect(contestSuccessProbability(baseline, prey, { ...contest, evasionWeight: 2 })).toBeLessThan(p)
  })

  it('uses a named keyed draw and is deterministic', () => {
    const attacker = participant(1, { size: 1.4 }), prey = participant(2)
    const first = resolveAttackClaims([claim(attacker, prey)], contest, context).admitted[0]
    const second = resolveAttackClaims([claim(attacker, prey)], contest, context).admitted[0]
    expect(second).toEqual(first)
    expect(first.draw).toBe(keyedRandom(context.seed, 'predation-contest', context.generation, context.tick, attacker.individualId, prey.individualId))
    expect(first.success).toBe(first.draw! < first.probability)
  })

  it('charges failures and rewards prey energy only on success, with cooldown metadata', () => {
    const attacker = participant(1, { size: 1.2, speed: .4, energy: 1, aggression: 0 })
    const prey = participant(2, { speed: 2.8, energy: 300, caution: 1 })
    const probability = contestSuccessProbability(attacker, prey, contest)
    const failureSeed = findSeed(draw => draw >= probability, attacker, prey)
    const failed = resolveAttackClaims([claim(attacker, prey)], contest, { ...context, seed: failureSeed })
    expect(failed.failures).toHaveLength(1)
    expect(failed.energyDeltas[0].delta).toBe(-contest.attackCost)
    expect(failed.killedPreyIds).toEqual([])
    expect(failed.cooldowns).toEqual([{ id: attacker.id, individualId: attacker.individualId, duration: contest.handlingTime }])

    const successSeed = findSeed(draw => draw < probability, attacker, prey)
    const succeeded = resolveAttackClaims([claim(attacker, prey)], contest, { ...context, seed: successSeed })
    expect(succeeded.successes).toHaveLength(1)
    expect(succeeded.energyDeltas[0].delta).toBe(contest.preyEnergy - contest.attackCost)
    expect(succeeded.killedPreyIds).toEqual([prey.id])
  })
})

describe('stable simultaneous resolution', () => {
  it('allows a killed actor to complete its pre-decided chain attack', () => {
    const large = participant(1, { size: 2 }), middle = participant(2, { size: 1.5 }), small = participant(3, { size: 1 })
    const result = resolveAttackClaims([claim(large, middle, threshold), claim(middle, small, threshold)], threshold, context)
    expect(result.successes.map(outcome => [outcome.attacker.id, outcome.prey.id])).toEqual([[1, 2], [2, 3]])
    expect(result.killedPreyIds).toEqual([2, 3])
  })

  it('is invariant to participant and claim permutation', () => {
    const a = participant(1, { size: 2, x: .49 }), b = participant(2, { size: 2, x: .51 }), prey = participant(3, { x: .5 })
    const forward = collectAttackClaims([a, b], [prey], threshold)
    const reverse = collectAttackClaims([b, a], [prey], threshold)
    expect(reverse).toEqual(forward)
    const first = resolveAttackClaims(forward, contest, context)
    const second = resolveAttackClaims([...reverse].reverse(), contest, context)
    expect(second).toEqual(first)
  })

  it('admits one claim per actor and one winner per prey with stable tie-breaking', () => {
    const a = participant(1, { size: 2, x: .49 }), b = participant(2, { size: 2, x: .51 })
    const near = participant(3, { x: .5 }), other = participant(4, { x: .5 })
    const claims: AttackClaim[] = [claim(b, near, threshold), claim(a, other, threshold), claim(a, near, threshold)]
    const result = resolveAttackClaims(claims, threshold, context)
    expect(result.admitted.map(outcome => [outcome.attacker.id, outcome.prey.id])).toEqual([[1, 3]])
    expect(result.rejected.map(item => item.reason).sort()).toEqual(['actor-duplicate', 'prey-contested'])
  })
})

function findSeed(predicate: (draw: number) => boolean, attacker: PredationParticipant, prey: PredationParticipant) {
  for (let seed = 1; seed < 10_000; seed++) {
    const draw = keyedRandom(seed, 'predation-contest', context.generation, context.tick, attacker.individualId, prey.individualId)
    if (predicate(draw)) return seed
  }
  throw new Error('No deterministic seed found')
}
