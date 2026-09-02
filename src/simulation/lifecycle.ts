import { keyedRandom } from './random'

export type LifecycleMode='classic'|'energy-regrowth'
export type LifecycleOutcomeCause='survived'|'hunted'|'energy'|'unfed'|'late'|'aged'

/** The settlement policy deliberately depends on a small structural view, not World. */
export interface LifecycleIndividual{
  id:number
  individualId:number
  alive:boolean
  home:boolean
  food:number
  energy:number
  age:number
  deathCause:'hunted'|'energy'|null
}

export interface LifecyclePolicy{
  ecologyMode:LifecycleMode
  startingEnergy:number
  energyRetention:number
  reproductionEnergyCost:number
  offspringEnergy:number
  maxAge:number
  /** Optional for direct/legacy callers; omitted means immediate maturity. */
  maturityAge?:number
}

export interface LifecycleContext{
  seed:number
  generation:number
  maxPopulation:number
}

export interface LifecycleOutcome<T extends LifecycleIndividual>{
  individual:T
  cause:LifecycleOutcomeCause
}

export interface SurvivorSettlement<T extends LifecycleIndividual>{
  individual:T
  nextAge:number
  retainedEnergy:number
  settledEnergy:number
  reproductionEligible:boolean
  birthAdmitted:boolean
}

export interface BirthSettlement<T extends LifecycleIndividual>{
  parent:T
  parentIndividualId:number
  energy:number
}

export interface LifecycleSettlement<T extends LifecycleIndividual>{
  mode:LifecycleMode
  outcomes:LifecycleOutcome<T>[]
  outcomeCounts:Record<LifecycleOutcomeCause,number>
  survivors:SurvivorSettlement<T>[]
  /** Advanced survivors that clear the energy hurdle but are still too young to reproduce. */
  immatureParents:T[]
  eligibleParents:T[]
  admittedParents:T[]
  births:BirthSettlement<T>[]
  birthsCapped:number
  availableBirthSlots:number
}

const ordered=<T extends LifecycleIndividual>(items:readonly T[])=>[...items].sort((a,b)=>a.individualId-b.individualId||a.id-b.id)
const finiteNonNegative=(value:number)=>Number.isFinite(value)?Math.max(0,value):0
const unit=(value:number)=>Math.max(0,Math.min(1,Number.isFinite(value)?value:0))

function classifyClassic(individual:LifecycleIndividual):LifecycleOutcomeCause{
  if(individual.alive&&individual.home&&individual.food>=1)return'survived'
  if(individual.deathCause==='hunted')return'hunted'
  if(individual.deathCause==='energy')return'energy'
  if(individual.food===0)return'unfed'
  return'late'
}

function classifyEnergy(individual:LifecycleIndividual,maxAge:number,retention:number):LifecycleOutcomeCause{
  if(individual.deathCause==='hunted')return'hunted'
  if(!individual.alive||!Number.isFinite(individual.energy)||individual.energy<=0||individual.deathCause==='energy')return'energy'
  if(individual.age>=maxAge)return'aged'
  if(!individual.home)return'late'
  if(individual.energy*retention<=0)return'energy'
  return'survived'
}

/**
 * Pure generation-boundary settlement. Classic mode is a golden compatibility
 * branch. Energy mode retains energy and uses stateless keyed draws when births
 * compete for capacity, so array order and unrelated RNG calls cannot bias it.
 */
export function settleLifecycle<T extends LifecycleIndividual>(
  individuals:readonly T[],policy:LifecyclePolicy,context:LifecycleContext,
):LifecycleSettlement<T>{
  const mode=policy.ecologyMode
  const maxAge=Math.max(1,Math.trunc(finiteNonNegative(policy.maxAge)))
  const maturityAge=Math.max(0,Math.trunc(finiteNonNegative(policy.maturityAge??0)))
  const retention=unit(policy.energyRetention)
  const source=ordered(individuals)
  const outcomes=source.map(individual=>({individual,cause:mode==='classic'?classifyClassic(individual):classifyEnergy(individual,maxAge,retention)}))
  const outcomeCounts:Record<LifecycleOutcomeCause,number>={survived:0,hunted:0,energy:0,unfed:0,late:0,aged:0}
  for(const outcome of outcomes)outcomeCounts[outcome.cause]++

  const survivorIndividuals=outcomes.filter(outcome=>outcome.cause==='survived').map(outcome=>outcome.individual)
  const reproductionCost=finiteNonNegative(policy.reproductionEnergyCost)
  const survivorEnergy=new Map(survivorIndividuals.map(individual=>[
    individual.individualId,
    mode==='classic'?finiteNonNegative(policy.startingEnergy):finiteNonNegative(individual.energy)*retention,
  ]))
  const energyQualifiedParents=survivorIndividuals.filter(individual=>(survivorEnergy.get(individual.individualId)??0)>reproductionCost)
  const immatureParents=mode==='energy-regrowth'
    ?energyQualifiedParents.filter(individual=>individual.age<maturityAge)
    :[]
  const eligibleParents=mode==='classic'
    ?survivorIndividuals.filter(individual=>individual.food>=2)
    :energyQualifiedParents.filter(individual=>individual.age>=maturityAge)

  const availableBirthSlots=Math.max(0,Math.trunc(finiteNonNegative(context.maxPopulation))-survivorIndividuals.length)
  const ranked=mode==='classic'?eligibleParents:[...eligibleParents].sort((a,b)=>{
    const aDraw=keyedRandom(context.seed,'lifecycle.recruitment.v1',context.generation,a.individualId)
    const bDraw=keyedRandom(context.seed,'lifecycle.recruitment.v1',context.generation,b.individualId)
    return aDraw-bDraw||a.individualId-b.individualId||a.id-b.id
  })
  const admittedSet=new Set(ranked.slice(0,availableBirthSlots).map(individual=>individual.individualId))
  // Keep returned collections in biological ID order even though admission was randomized.
  const admittedParents=eligibleParents.filter(individual=>admittedSet.has(individual.individualId))
  const survivors=survivorIndividuals.map(individual=>{
    const retainedEnergy=survivorEnergy.get(individual.individualId)??0
    const birthAdmitted=admittedSet.has(individual.individualId)
    return{
      individual,nextAge:individual.age+1,retainedEnergy,
      settledEnergy:mode==='energy-regrowth'&&birthAdmitted?Math.max(0,retainedEnergy-reproductionCost):retainedEnergy,
      reproductionEligible:eligibleParents.includes(individual),birthAdmitted,
    }
  })
  const birthEnergy=mode==='classic'?finiteNonNegative(policy.startingEnergy):finiteNonNegative(policy.offspringEnergy)
  const births=admittedParents.map(parent=>({parent,parentIndividualId:parent.individualId,energy:birthEnergy}))
  return{mode,outcomes,outcomeCounts,survivors,immatureParents,eligibleParents,admittedParents,births,
    birthsCapped:Math.max(0,eligibleParents.length-admittedParents.length),availableBirthSlots}
}
