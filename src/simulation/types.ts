export type Trait = 'speed'|'size'|'sense'|'aggression'|'caution'|'exploration'
export type Mode = 'exploring'|'foraging'|'hunting'|'fleeing'|'returning'
export type TargetType = 'food'|'prey'|'threat'|'home'|'memory'|'explore'

export interface Config {
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
}

export interface Memory {foodX:number|null;foodY:number|null;foodUntil:number;threatX:number|null;threatY:number|null;threatUntil:number}
export interface Creature {
  id:number;x:number;y:number;homeX:number;homeY:number;angle:number;vx:number;vy:number
  individualId:number;lineageId:number;parentIndividualId:number|null;birthGeneration:number
  speed:number;size:number;sense:number;aggression:number;caution:number;exploration:number
  energy:number;food:number;alive:boolean;returning:boolean;home:boolean;age:number;parentId?:number
  mode:Mode;memory:Memory;targetType:TargetType|null;targetId:number|null;targetX:number;targetY:number;commitUntil:number
  wanderAngle:number;wanderTurn:number
  deathCause:'hunted'|'energy'|null
  decisionSummary?:DecisionSummary
}
export interface DecisionCandidateSummary{type:TargetType;mode:Mode;score:number;reason:string;targetId:number|null}
export interface DecisionSummary{chosen:TargetType;reason:string;candidates:DecisionCandidateSummary[]}
export interface Food {id:number;x:number;y:number}
export interface FoodPatch {id:number;x:number;y:number}
export interface Obstacle {id:number;x:number;y:number;radius:number}
export interface Environment {patches:FoodPatch[];obstacles:Obstacle[];foodBudget:number;targetFood:number}

export interface HistoryPoint {
  generation:number;population:number
  avgSpeed:number|null;avgSize:number|null;avgSense:number|null
  avgAggression:number|null;avgCaution:number|null;avgExploration:number|null
  sdSpeed:number|null;sdSize:number|null;sdSense:number|null;sdAggression:number|null;sdCaution:number|null;sdExploration:number|null
}
export type BiologicalTrait='speed'|'size'|'sense'|'aggression'|'caution'|'exploration'
export interface TraitMoments{mean:number|null;variance:number|null;sd:number|null}
export type SelectionSummary=Record<BiologicalTrait,TraitMoments>
export type EndCause='survived'|'hunted'|'energy'|'unfed'|'late'
export interface GenerationLedger{generation:number;startPopulation:number;outcomes:Record<EndCause,number>;foodAtStart:number;foodConsumed:number;foodRemaining:number;preyConsumed:number;attackAttempts:number;birthsEligible:number;birthsAdmitted:number;birthsCapped:number;selection:{start:SelectionSummary;survivor:SelectionSummary;reproducer:SelectionSummary}}
export interface World {
  config:Config;generation:number;dayTime:number;tickIndex:number
  creatures:Creature[];food:Food[];history:HistoryPoint[];environment:Environment
  rngState:number;nextId:number;dayHunted:number
  nextIndividualId:number;nextLineageId:number;inspectedIndividualId:number|null
  dayFoodConsumed:number;dayPreyConsumed:number;dayAttackAttempts:number;generationFoodStart:number;ledger:GenerationLedger[]
  lastReport:{survived:number;born:number;starved:number;hunted:number;energy:number;unfed:number;late:number;capped:number}
}
