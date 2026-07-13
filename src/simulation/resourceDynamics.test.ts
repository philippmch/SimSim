import {describe,expect,it} from 'vitest'
import {advanceResourceDynamics,consumeResourceStock,createResourceDynamicsState,type ResourcePolicy} from './resourceDynamics'

const policy:ResourcePolicy={ecologyMode:'energy-regrowth',patchCapacity:10,foodRegrowthRate:.5,foodPatchSpread:.12,maxFood:180}
const patches=[{id:2,x:.75,y:.75},{id:1,x:.25,y:.25}]
const advance=(state:ReturnType<typeof createResourceDynamicsState>,dt:number,currentFoodCount=state.patches.reduce((n,p)=>n+p.stock,0),overrides:Partial<ResourcePolicy>={})=>advanceResourceDynamics(state,{...policy,...overrides},{seed:91,generation:3,dt,generationDuration:10,currentFoodCount})

describe('resource dynamics policy',()=>{
  it('keeps classic pulse behavior as a pure no-op planning branch',()=>{
    const state=createResourceDynamicsState([{...patches[0],stock:2,accumulator:.4}])
    const before=structuredClone(state)
    const result=advance(state,10,2,{ecologyMode:'classic'})
    expect(result).toMatchObject({branch:'classic-pulse',placements:[],foodCount:2})
    expect(result.state).toEqual(before)
    expect(state).toEqual(before)
  })

  it('conserves generated mass between stock and fractional accumulators',()=>{
    const state=createResourceDynamicsState(patches)
    const result=advance(state,3)
    // Each patch generates 10 * .5 * 3 / 10 = 1.5 items.
    expect(result.placements).toHaveLength(2)
    expect(result.state.patches.map(p=>[p.stock,p.accumulator])).toEqual([[1,.5],[1,.5]])
    expect(result.state.patches.reduce((n,p)=>n+p.stock+p.accumulator,0)).toBeCloseTo(3,12)
  })

  it('respects per-patch capacity and the global MAX_FOOD-style bound',()=>{
    const full=createResourceDynamicsState([{id:1,x:.5,y:.5,stock:9},{id:2,x:.6,y:.6,stock:9}])
    const patchCapped=advance(full,20,18)
    expect(patchCapped.placements).toHaveLength(2)
    expect(patchCapped.state.patches.map(p=>p.stock)).toEqual([10,10])
    const globallyCapped=advance(createResourceDynamicsState(patches),10,179)
    expect(globallyCapped.placements).toHaveLength(1)
    expect(globallyCapped.foodCount).toBe(180)
  })

  it('produces identical state and placements across timestep subdivision',()=>{
    const initial=createResourceDynamicsState(patches)
    const once=advance(initial,10)
    let state=initial,count=0
    const chunkPlacements=[]
    for(let i=0;i<20;i++){
      const chunk=advance(state,.5,count)
      state=chunk.state;count=chunk.foodCount;chunkPlacements.push(...chunk.placements)
    }
    expect(state).toEqual(once.state)
    expect(chunkPlacements).toEqual(once.placements)
    expect(count).toBe(once.foodCount)
  })

  it('is patch-order invariant, deterministic, and bounds every placement',()=>{
    const a=advance(createResourceDynamicsState(patches),20)
    const b=advance(createResourceDynamicsState([...patches].reverse()),20)
    expect(a).toEqual(b)
    expect(advance(createResourceDynamicsState(patches),20)).toEqual(a)
    expect(a.placements.every(p=>p.x>=.02&&p.x<=.98&&p.y>=.02&&p.y<=.98)).toBe(true)
    const otherSeed=advanceResourceDynamics(createResourceDynamicsState(patches),policy,{seed:92,generation:3,dt:20,generationDuration:10,currentFoodCount:0})
    expect(otherSeed.placements).not.toEqual(a.placements)
  })

  it('tracks consumption immutably without releasing blocked whole backlog',()=>{
    const original=createResourceDynamicsState([{id:1,x:.5,y:.5,stock:10,accumulator:1.7}])
    const blocked=advance(original,1,10)
    expect(blocked).toMatchObject({placements:[],state:{patches:[{stock:10,accumulator:0}]}})
    const consumed=consumeResourceStock(blocked.state,1,2)
    expect(blocked.state.patches[0].stock).toBe(10)
    expect(consumed.patches[0].stock).toBe(8)
    const noTime=advance(consumed,0,8)
    expect(noTime).toMatchObject({placements:[],state:{patches:[{stock:8,accumulator:0}]}})
    const globalBlock=advance(createResourceDynamicsState([{id:1,x:.5,y:.5}]),10,180)
    expect(globalBlock.placements).toEqual([]);expect(globalBlock.state.patches[0].accumulator).toBe(0)
    expect(advance(globalBlock.state,0,179).placements).toEqual([])
    const drought=advance(createResourceDynamicsState([{id:1,x:.5,y:.5,stock:8,accumulator:3.4}]),10,8,{foodRegrowthRate:0})
    expect(drought.placements).toEqual([]);expect(drought.state.patches[0].stock).toBe(8);expect(drought.state.patches[0].accumulator).toBeCloseTo(.4,12)
  })
})
