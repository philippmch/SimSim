export type Trait = 'speed'|'size'|'sense'|'aggression'|'caution'|'exploration'
export type Mode = 'exploring'|'foraging'|'hunting'|'fleeing'|'returning'
export type TargetType = 'food'|'prey'|'threat'|'home'|'memory'|'explore'
export type EcologyMode = 'classic'|'energy-regrowth'
export type PerceptionMode = 'perfect'|'realistic'
export type PredationMode = 'threshold'|'contest'

export interface Config {
  ecologyMode:EcologyMode;perceptionMode:PerceptionMode;predationMode:PredationMode
  seed:number; initialPopulation:number; foodPerDay:number
  startSpeed:number; startSize:number; startSense:number; startingEnergy:number
  startAggression:number; startCaution:number; startExploration:number
  mutationRate:number; mutationStrength:number
  mutateSpeed:boolean; mutateSize:boolean; mutateSense:boolean
  mutateAggression:boolean; mutateCaution:boolean; mutateExploration:boolean
  predatorRatio:number; moveEnergyFactor:number; senseEnergyFactor:number; dayLength:number
  acceleration:number; turnRate:number; memoryDuration:number; commitmentDuration:number
  foodPatchCount:number; foodPatchiness:number; foodPatchSpread:number; obstacleCount:number
  seasonAmplitude:number; seasonLength:number; environmentResponse:number; foodTrend:number
  founderPhysicalVariation:number;founderBehaviorVariation:number
  foodEnergy:number;preyEnergy:number;energyRetention:number;reproductionEnergyCost:number;offspringEnergy:number;maxAge:number
  patchCapacity:number;foodRegrowthRate:number
  fieldOfView:number;detectionFalloff:number;reactionTime:number;obstacleOcclusion:boolean
  attackCost:number;handlingTime:number;contestSharpness:number;evasionWeight:number
}

export interface Memory {foodX:number|null;foodY:number|null;foodUntil:number;threatX:number|null;threatY:number|null;threatUntil:number}
export interface Creature {
  id:number;x:number;y:number;homeX:number;homeY:number;angle:number;vx:number;vy:number
  individualId:number;lineageId:number;parentIndividualId:number|null;birthGeneration:number
  speed:number;size:number;sense:number;aggression:number;caution:number;exploration:number
  energy:number;food:number;alive:boolean;returning:boolean;home:boolean;age:number;parentId?:number
  mode:Mode;memory:Memory;targetType:TargetType|null;targetId:number|null;targetX:number;targetY:number;commitUntil:number
  wanderAngle:number;wanderTurn:number;reactionWindow:number;attackCooldownUntil:number
  deathCause:'hunted'|'energy'|null
  decisionSummary?:DecisionSummary
  perceptionDiagnostics?:PerceptionDiagnostics
}
export interface DecisionCandidateSummary{type:TargetType;mode:Mode;score:number;reason:string;targetId:number|null}
export interface DecisionSummary{chosen:TargetType;reason:string;candidates:DecisionCandidateSummary[]}
export interface PerceptionCounts{total:number;detected:number;range:number;fov:number;occlusion:number;detection:number}
export interface PerceptionDiagnostics{mode:PerceptionMode;reactionWindow:number;creatures:PerceptionCounts;food:PerceptionCounts}
export interface Food {id:number;x:number;y:number;patchId:number|null;energy:number}
export interface FoodPatch {id:number;x:number;y:number;stock:number;accumulator:number;spawnSequence:number}
export interface Obstacle {id:number;x:number;y:number;radius:number}
export interface Environment {patches:FoodPatch[];obstacles:Obstacle[];foodBudget:number;targetFood:number}

export interface HistoryPoint {
  generation:number;population:number
  avgSpeed:number|null;avgSize:number|null;avgSense:number|null
  avgAggression:number|null;avgCaution:number|null;avgExploration:number|null
  sdSpeed:number|null;sdSize:number|null;sdSense:number|null;sdAggression:number|null;sdCaution:number|null;sdExploration:number|null
  avgEnergy:number|null;avgAge:number|null
}
export type BiologicalTrait='speed'|'size'|'sense'|'aggression'|'caution'|'exploration'
export interface TraitMoments{mean:number|null;variance:number|null;sd:number|null}
export type SelectionSummary=Record<BiologicalTrait,TraitMoments>
export interface InheritanceTraitSummary{parentMean:number|null;offspringMean:number|null;changedCount:number}
export interface InheritanceSummary{offspringCount:number;changedTraitValues:number;traits:Record<BiologicalTrait,InheritanceTraitSummary>}
export const END_CAUSES=['survived','hunted','energy','unfed','late','aged'] as const
export type EndCause=(typeof END_CAUSES)[number]
export type AttackAttemptBasis='claims'|'admitted'
export interface GenerationLedger{generation:number;startPopulation:number;outcomes:Record<EndCause,number>;foodAtStart:number;foodProduced:number;foodRemoved:number;foodConsumed:number;foodRemaining:number;preyConsumed:number;attackAttempts:number;attackSuccesses:number;attackFailures:number;/** Optional for legacy ledgers retained before contested-attack telemetry. */attackContested?:number;/** Optional for legacy ledgers retained before attempt-basis telemetry. */attackAttemptBasis?:AttackAttemptBasis;birthsEligible:number;birthsAdmitted:number;birthsCapped:number;selection:{start:SelectionSummary;survivor:SelectionSummary;reproducer:SelectionSummary};selectionByOutcome:Record<EndCause,SelectionSummary>;inheritance?:InheritanceSummary}
export type InterventionKind='resource-bloom'|'drought'|'founder-migration'
export interface WorldEvent{generation:number;day:number;kind:InterventionKind;summary:string;count:number}
export interface LineageShare{lineageId:number;count:number;share:number}
export interface SelectionShift{trait:BiologicalTrait;survivor:number|null;reproducer:number|null}
export interface LineageAnalytics{livingLineages:number;effectiveDiversity:number;topLineages:LineageShare[];latestGeneration:number|null;selectionShifts:SelectionShift[]}
export interface World {
  config:Config;generation:number;dayTime:number;tickIndex:number
  creatures:Creature[];food:Food[];history:HistoryPoint[];environment:Environment
  rngState:number;nextId:number;dayHunted:number
  nextIndividualId:number;nextLineageId:number;inspectedIndividualId:number|null
  dayFoodProduced:number;dayFoodRemoved:number;dayFoodConsumed:number;dayPreyConsumed:number;dayAttackAttempts:number;dayAttackSuccesses:number;dayAttackFailures:number;dayAttackContested:number;generationFoodStart:number;ledger:GenerationLedger[]
  events:WorldEvent[]
  lastReport:{survived:number;born:number;starved:number;hunted:number;energy:number;unfed:number;late:number;aged:number;capped:number}
}
