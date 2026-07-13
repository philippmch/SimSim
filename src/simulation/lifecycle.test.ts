import {describe,expect,it} from 'vitest'
import {settleLifecycle,type LifecycleIndividual,type LifecyclePolicy} from './lifecycle'

const classic:LifecyclePolicy={ecologyMode:'classic',startingEnergy:110,energyRetention:.5,reproductionEnergyCost:35,offspringEnergy:70,maxAge:2}
const energy:LifecyclePolicy={...classic,ecologyMode:'energy-regrowth'}
const creature=(individualId:number,overrides:Partial<LifecycleIndividual>={}):LifecycleIndividual=>({id:individualId,individualId,alive:true,home:true,food:1,energy:100,age:0,deathCause:null,...overrides})
const settle=(individuals:LifecycleIndividual[],policy=energy,maxPopulation=120,seed=7)=>settleLifecycle(individuals,policy,{seed,generation:4,maxPopulation})

describe('lifecycle settlement policy',()=>{
  it('preserves classic survival, reproduction, causes, and stable ID admission',()=>{
    const result=settle([
      creature(9,{food:2}),creature(2,{food:2}),creature(7,{food:0}),
      creature(3,{alive:false,deathCause:'hunted'}),creature(4,{alive:false,deathCause:'energy'}),
      creature(5,{home:false,food:1}),
    ],classic,3)
    expect(result.outcomes.map(({individual,cause})=>[individual.individualId,cause])).toEqual([[2,'survived'],[3,'hunted'],[4,'energy'],[5,'late'],[7,'unfed'],[9,'survived']])
    expect(result.admittedParents.map(c=>c.individualId)).toEqual([2])
    expect(result.births).toHaveLength(1)
    expect(result.births[0].energy).toBe(110)
    expect(result.survivors.map(s=>[s.individual.individualId,s.settledEnergy])).toEqual([[2,110],[9,110]])
    expect(result.birthsCapped).toBe(1)
  })

  it('uses energy, home arrival, carryover, and reproduction allocation without going negative',()=>{
    const result=settle([creature(1,{food:0,energy:100}),creature(2,{energy:69}),creature(3,{home:false}),creature(4,{energy:0})],energy,4)
    expect(result.outcomeCounts).toMatchObject({survived:2,late:1,energy:1,unfed:0})
    expect(result.eligibleParents.map(c=>c.individualId)).toEqual([1])
    expect(result.survivors.map(s=>[s.individual.individualId,s.retainedEnergy,s.settledEnergy])).toEqual([[1,50,15],[2,34.5,34.5]])
    expect(result.births).toEqual([{parent:result.admittedParents[0],parentIndividualId:1,energy:70}])
    expect(result.survivors.every(s=>s.settledEnergy>=0)).toBe(true)
  })

  it('classifies age expiry explicitly and ignores age in classic mode',()=>{
    expect(settle([creature(1,{age:2})],energy).outcomes[0].cause).toBe('aged')
    expect(settle([creature(1,{age:200,food:1})],classic).outcomes[0].cause).toBe('survived')
  })

  it('does not keep zero-retained-energy adults or reproduce at exact cost',()=>{
    const noRetention=settle([creature(1,{energy:100})],{...energy,energyRetention:0})
    expect(noRetention.outcomeCounts.energy).toBe(1);expect(noRetention.survivors).toEqual([])
    const exactCost=settle([creature(1,{energy:100})],{...energy,energyRetention:.5,reproductionEnergyCost:50})
    expect(exactCost.survivors).toHaveLength(1);expect(exactCost.eligibleParents).toEqual([]);expect(exactCost.survivors[0].settledEnergy).toBe(50)
  })

  it('preserves explicit advanced cause precedence when retention is zero',()=>{
    const result=settle([
      creature(1,{alive:false,deathCause:'hunted',age:9,home:false}),
      creature(2,{alive:false,deathCause:'energy',energy:0,age:9,home:false}),
      creature(3,{age:2,home:true,energy:100}),
      creature(4,{age:0,home:false,energy:100}),
      creature(5,{age:0,home:true,energy:100}),
    ],{...energy,energyRetention:0})
    expect(result.outcomes.map(({individual,cause})=>[individual.individualId,cause])).toEqual([[1,'hunted'],[2,'energy'],[3,'aged'],[4,'late'],[5,'energy']])
    expect(result.outcomeCounts).toEqual({survived:0,hunted:1,energy:2,unfed:0,late:1,aged:1})
  })

  it('caps births against survivor occupancy and charges only admitted parents',()=>{
    const result=settle([creature(1,{energy:100}),creature(2,{energy:100}),creature(3,{energy:100})],energy,4,19)
    expect(result.availableBirthSlots).toBe(1)
    expect(result.births).toHaveLength(1)
    expect(result.birthsCapped).toBe(2)
    expect(result.survivors.filter(s=>s.settledEnergy===15)).toHaveLength(1)
    expect(result.survivors.filter(s=>s.settledEnergy===50)).toHaveLength(2)
  })

  it('uses deterministic, permutation-invariant fair recruitment rather than an ID slice',()=>{
    const population=Array.from({length:12},(_,i)=>creature(i+1,{energy:100}))
    const a=settle(population,energy,14,1).admittedParents.map(c=>c.individualId)
    const b=settle([...population].reverse(),energy,14,1).admittedParents.map(c=>c.individualId)
    expect(a).toEqual(b)
    expect(a).toHaveLength(2)
    expect(a).not.toEqual([1,2])
    expect(settle(population,energy,14,2).admittedParents.map(c=>c.individualId)).not.toEqual(a)
  })

  it('is pure and handles non-finite or invalid energy inputs conservatively',()=>{
    const source=[creature(1,{energy:Number.NaN}),creature(2,{energy:Infinity})]
    const before=source.map(c=>({...c}))
    const result=settle(source,energy)
    expect(source).toEqual(before)
    expect(result.outcomeCounts.energy).toBe(2)
    expect(result.survivors).toEqual([])
    expect(result.survivors.every(s=>s.settledEnergy>=0)).toBe(true)
  })
})
