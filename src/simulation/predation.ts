import { clamp, distance, keyedRandom } from './random'
import type { Config } from './types'

/** The legacy engine awarded this fixed amount for threshold-mode predation. */
export const THRESHOLD_PREY_ENERGY = 30

/** Structural view used by the pure policy so callers do not have to clone Creature objects. */
export interface PredationParticipant {
  id: number
  individualId: number
  x: number
  y: number
  size: number
  speed: number
  energy: number
  aggression: number
  caution: number
  alive?: boolean
  home?: boolean
}

export interface AttackClaim {
  attacker: PredationParticipant
  prey: PredationParticipant
  distance: number
}

export interface PredationContext {
  seed: number
  generation: number
  tick: number
}

export interface AttackOutcome extends AttackClaim {
  success: boolean
  probability: number
  draw: number | null
  attackerEnergyDelta: number
  cooldown: number
}

export type RejectedAttackReason = 'invalid' | 'actor-duplicate' | 'prey-contested'
export interface RejectedAttack extends AttackClaim { reason: RejectedAttackReason }
export interface EnergyDelta { id: number; individualId: number; delta: number }
export interface AttackCooldown { id: number; individualId: number; duration: number }

export interface PredationResolution {
  admitted: AttackOutcome[]
  successes: AttackOutcome[]
  failures: AttackOutcome[]
  rejected: RejectedAttack[]
  energyDeltas: EnergyDelta[]
  cooldowns: AttackCooldown[]
  killedPreyIds: number[]
}

export const attackContactRadius = (attacker: Pick<PredationParticipant, 'size'>) => .014 + .012 * attacker.size

/**
 * Shared size gate for every stage of the predation pipeline.
 *
 * Threshold mode keeps the legacy hard ratio. Contest mode is deliberately
 * reachable for evenly matched animals: predatorRatio remains the relative
 * advantage reference in contestSuccessProbability rather than an admission
 * requirement.
 */
export function isPredationSizeEligible(attacker: Pick<PredationParticipant, 'size'>, prey: Pick<PredationParticipant, 'size'>, config: Config) {
  if (!Number.isFinite(attacker.size) || !Number.isFinite(prey.size)) return false
  const minimumRatio = config.predationMode === 'contest' ? 1 : config.predatorRatio
  return attacker.size >= prey.size * minimumRatio
}

/** Eligibility is evaluated from the shared pre-attack state, preserving attack-chain semantics. */
export function isEligiblePrey(attacker: PredationParticipant, prey: PredationParticipant, config: Config) {
  return attacker.id !== prey.id && attacker.alive !== false && attacker.home !== true && prey.alive !== false && prey.home !== true &&
    isPredationSizeEligible(attacker, prey, config)
}

/** Uses the legacy strict contact inequality; touching the boundary is not contact. */
export function isPreyInContact(attacker: PredationParticipant, prey: PredationParticipant, config: Config) {
  return isEligiblePrey(attacker, prey, config) && distance(attacker, prey) < attackContactRadius(attacker)
}

export function createAttackClaim(attacker: PredationParticipant, prey: PredationParticipant, config: Config): AttackClaim | null {
  if (!isPreyInContact(attacker, prey, config)) return null
  return { attacker, prey, distance: distance(attacker, prey) }
}

/** Selects at most one contacted prey per actor by distance, then stable runtime id. */
export function collectAttackClaims(attackers: readonly PredationParticipant[], preyCandidates: readonly PredationParticipant[], config: Config) {
  const claims: AttackClaim[] = []
  for (const attacker of [...attackers].sort(participantOrder)) {
    let best: AttackClaim | null = null
    for (const prey of preyCandidates) {
      const claim = createAttackClaim(attacker, prey, config)
      if (claim && (!best || claim.distance < best.distance || (claim.distance === best.distance && prey.id < best.prey.id))) best = claim
    }
    if (best) claims.push(best)
  }
  return claims
}

/**
 * Contest logit (before the logistic transform):
 *
 * sharpness × [1.4 ln((attacker size / prey size) / eligibility ratio)
 *   + 0.55 ln(attacker speed / prey speed)
 *   + 0.35 normalized energy advantage
 *   + 0.65 (attacker aggression - evasionWeight × prey caution)].
 *
 * Thus size, speed, energy, and aggression monotonically help the attacker while
 * caution and evasionWeight help the prey. Inputs are bounded defensively.
 */
export function contestSuccessProbability(attacker: PredationParticipant, prey: PredationParticipant, config: Config) {
  const safeAttackerSize = Math.max(Number.isFinite(attacker.size) ? attacker.size : 0, 1e-9)
  const safePreySize = Math.max(Number.isFinite(prey.size) ? prey.size : 0, 1e-9)
  const safeAttackerSpeed = Math.max(Number.isFinite(attacker.speed) ? attacker.speed : 0, 1e-9)
  const safePreySpeed = Math.max(Number.isFinite(prey.speed) ? prey.speed : 0, 1e-9)
  const attackerEnergy = Number.isFinite(attacker.energy) ? attacker.energy : 0
  const preyEnergy = Number.isFinite(prey.energy) ? prey.energy : 0
  const energyAdvantage = (attackerEnergy - preyEnergy) / Math.max(Math.abs(attackerEnergy) + Math.abs(preyEnergy), 1)
  const sizeMargin = Math.log((safeAttackerSize / safePreySize) / Math.max(config.predatorRatio, 1e-9))
  const speedAdvantage = Math.log(safeAttackerSpeed / safePreySpeed)
  const behavior = clamp(attacker.aggression, 0, 1) - Math.max(config.evasionWeight, 0) * clamp(prey.caution, 0, 1)
  const score = config.contestSharpness * (1.4 * sizeMargin + .55 * speedAdvantage + .35 * energyAdvantage + .65 * behavior)
  return 1 / (1 + Math.exp(-clamp(score, -60, 60)))
}

/**
 * Resolves a pre-decided claim set without mutation. Duplicate actor claims are
 * reduced first; remaining claims compete per prey by distance then actor id.
 * Every admitted contest attempt pays attackCost and receives handlingTime,
 * including failures. Threshold mode is the exact legacy instant-success path.
 */
export function resolveAttackClaims(claims: readonly AttackClaim[], config: Config, context: PredationContext): PredationResolution {
  const rejected: RejectedAttack[] = []
  const valid: AttackClaim[] = []
  for (const claim of claims) {
    const normalized = createAttackClaim(claim.attacker, claim.prey, config)
    if (normalized) valid.push(normalized)
    else rejected.push({ ...claim, reason: 'invalid' })
  }

  valid.sort(actorClaimOrder)
  const onePerActor: AttackClaim[] = []
  const actors = new Set<number>()
  for (const claim of valid) {
    if (actors.has(claim.attacker.id)) rejected.push({ ...claim, reason: 'actor-duplicate' })
    else { actors.add(claim.attacker.id); onePerActor.push(claim) }
  }

  onePerActor.sort(preyClaimOrder)
  const winners: AttackClaim[] = []
  const prey = new Set<number>()
  for (const claim of onePerActor) {
    if (prey.has(claim.prey.id)) rejected.push({ ...claim, reason: 'prey-contested' })
    else { prey.add(claim.prey.id); winners.push(claim) }
  }

  const admitted = winners.map(claim => resolveClaim(claim, config, context)).sort(outcomeOrder)
  const successes = admitted.filter(outcome => outcome.success)
  const failures = admitted.filter(outcome => !outcome.success)
  const energyDeltas = admitted.map(outcome => ({ id: outcome.attacker.id, individualId: outcome.attacker.individualId, delta: outcome.attackerEnergyDelta }))
  const cooldowns = admitted.filter(() => config.predationMode === 'contest').map(outcome => ({ id: outcome.attacker.id, individualId: outcome.attacker.individualId, duration: outcome.cooldown }))
  rejected.sort(rejectedOrder)
  return { admitted, successes, failures, rejected, energyDeltas, cooldowns, killedPreyIds: successes.map(outcome => outcome.prey.id).sort((a, b) => a - b) }
}

function resolveClaim(claim: AttackClaim, config: Config, context: PredationContext): AttackOutcome {
  if (config.predationMode === 'threshold') return { ...claim, success: true, probability: 1, draw: null, attackerEnergyDelta: THRESHOLD_PREY_ENERGY, cooldown: 0 }
  const probability = contestSuccessProbability(claim.attacker, claim.prey, config)
  const draw = keyedRandom(context.seed, 'predation-contest', context.generation, context.tick, claim.attacker.individualId, claim.prey.individualId)
  const success = draw < probability
  return { ...claim, success, probability, draw, attackerEnergyDelta: -config.attackCost + (success ? config.preyEnergy : 0), cooldown: config.handlingTime }
}

const participantOrder = (a: PredationParticipant, b: PredationParticipant) => a.id - b.id || a.individualId - b.individualId
const actorClaimOrder = (a: AttackClaim, b: AttackClaim) => a.attacker.id - b.attacker.id || a.distance - b.distance || a.prey.id - b.prey.id
const preyClaimOrder = (a: AttackClaim, b: AttackClaim) => a.prey.id - b.prey.id || a.distance - b.distance || a.attacker.id - b.attacker.id
const outcomeOrder = (a: AttackOutcome, b: AttackOutcome) => a.attacker.id - b.attacker.id || a.prey.id - b.prey.id
const rejectedOrder = (a: RejectedAttack, b: RejectedAttack) => a.attacker.id - b.attacker.id || a.prey.id - b.prey.id || a.reason.localeCompare(b.reason)
