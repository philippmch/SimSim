import { describe, expect, it } from 'vitest'
import { createWorld, defaultConfig, finishGeneration, getStats, runGeneration, setInspectedIndividual, SIMULATION_TIMESTEP, tick } from './engine'
import {CLASSIC_MODES} from './config'

describe('selection simulation', () => {
  it('is deterministic for a seed and configuration', () => {
    const config={...defaultConfig,seed:99,initialPopulation:16,foodPerDay:14}
    const a=createWorld(config), b=createWorld(config)
    for(let i=0;i<4;i++){runGeneration(a);runGeneration(b)}
    expect(a).toEqual(b)
  })

  it('only fed creatures at home survive and two foods yield one child', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:3,foodPerDay:0,mutationRate:0})
    w.creatures[0].food=2; w.creatures[0].home=true
    w.creatures[1].food=1; w.creatures[1].home=true
    w.creatures[2].food=2; w.creatures[2].home=false
    finishGeneration(w)
    expect(w.creatures).toHaveLength(3)
    expect(w.lastReport).toMatchObject({survived:2,born:1})
  })

  it('keeps traits unchanged when mutations are disabled', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPerDay:0,mutateSpeed:false,mutateSize:false,mutateSense:false,mutationRate:1})
    const original=w.creatures[0]
    original.food=2; original.home=true
    finishGeneration(w)
    expect(w.creatures.every(c=>c.speed===original.speed && c.size===original.size && c.sense===original.sense)).toBe(true)
  })

  it('does not give a predation turn to a creature killed earlier in the tick', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:3,foodPerDay:0,predatorRatio:1.2})
    const [largest,middle,smallest]=w.creatures
    for(const c of w.creatures){c.x=.5;c.y=.5;c.sense=.5;c.angle=0}
    largest.size=2; middle.size=1.5; smallest.size=1
    tick(w,SIMULATION_TIMESTEP)
    expect(middle.alive).toBe(false)
    expect(smallest.alive).toBe(true)
  })

  it('retires fed creatures safely at home for the rest of the day', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:2,foodPerDay:0,predatorRatio:1.2})
    const [safe,predator]=w.creatures
    safe.food=1;safe.returning=true;safe.energy=47;safe.x=safe.homeX;safe.y=safe.homeY
    predator.x=.5;predator.y=.5
    tick(w,SIMULATION_TIMESTEP)
    expect(safe).toMatchObject({alive:true,home:true,energy:47,food:1})
    const restingPosition={x:safe.x,y:safe.y}
    predator.size=2;predator.x=safe.x;predator.y=safe.y;predator.sense=.5
    tick(w,SIMULATION_TIMESTEP)
    expect(safe).toMatchObject({alive:true,home:true,energy:47,food:1,...restingPosition})
  })

  it('reports live statistics without creatures killed during the day', () => {
    const w=createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0})
    w.creatures[0].speed=.8;w.creatures[0].size=.9;w.creatures[0].sense=.12
    w.creatures[1].speed=2.8;w.creatures[1].size=2.8;w.creatures[1].sense=.6;w.creatures[1].alive=false
    expect(getStats(w)).toMatchObject({population:1,avgSpeed:.8,avgSize:.9,avgSense:.12})
  })

  it('records missing trait averages for extinction while live metrics stay numeric', () => {
    const w=createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0})
    finishGeneration(w)
    expect(w.history.at(-1)).toMatchObject({population:0,avgSpeed:null,avgSize:null,avgSense:null,avgAggression:null,avgCaution:null,avgExploration:null})
    expect(getStats(w)).toMatchObject({population:0,avgSpeed:0,avgSize:0,avgSense:0,avgAggression:0,avgCaution:0,avgExploration:0})
  })

  it('uses the same fixed timestep for stepped and animated generations', () => {
    const config={...defaultConfig,seed:612,initialPopulation:12,foodPerDay:14}
    const stepped=createWorld(config), animated=createWorld(config)
    runGeneration(stepped)
    const generation=animated.generation
    while(animated.generation===generation)tick(animated,SIMULATION_TIMESTEP)
    expect(stepped).toEqual(animated)
  })

  it('returns with one food when home travel exceeds the time or energy budget', () => {
    const early=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPerDay:0})
    const late=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPerDay:0})
    const lowEnergy=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPerDay:0})
    for(const w of [early,late,lowEnergy]){
      const c=w.creatures[0]
      c.x=.5;c.y=.5;c.food=1;c.energy=defaultConfig.startingEnergy
    }
    late.dayTime=defaultConfig.dayLength-3
    lowEnergy.creatures[0].energy=3
    tick(early,SIMULATION_TIMESTEP)
    tick(late,SIMULATION_TIMESTEP)
    tick(lowEnergy,SIMULATION_TIMESTEP)
    expect(early.creatures[0].returning).toBe(false)
    expect(late.creatures[0].returning).toBe(true)
    expect(lowEnergy.creatures[0].returning).toBe(true)
  })

  it('pursues the nearer food when sensed prey is farther away', () => {
    const w=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:2,foodPerDay:0,predatorRatio:1.2})
    const [hunter,prey]=w.creatures
    hunter.x=.5;hunter.y=.5;hunter.angle=Math.PI/2;hunter.size=2;hunter.sense=.3
    prey.x=.6;prey.y=.5;prey.size=1
    w.food=[{id:999,x:.45,y:.5,patchId:null,energy:22}]
    tick(w,SIMULATION_TIMESTEP)
    expect(hunter.x).toBeLessThan(.5)
    expect(prey.alive).toBe(true)
  })

  it('keeps decision telemetry only on the inspected individual', () => {
    const w=createWorld({...defaultConfig,initialPopulation:3,foodPerDay:0})
    const [active,home,dead]=w.creatures
    home.home=true
    dead.alive=false
    for(const creature of w.creatures)creature.decisionSummary={chosen:'explore',reason:'stale',candidates:[]}
    setInspectedIndividual(w,active.individualId)
    expect(active.decisionSummary).toBeDefined()
    expect(home.decisionSummary).toBeUndefined()
    expect(dead.decisionSummary).toBeUndefined()
    tick(w,SIMULATION_TIMESTEP)
    expect(active.decisionSummary).toBeDefined()
    expect(w.creatures.filter(creature=>creature.individualId!==active.individualId).every(creature=>creature.decisionSummary===undefined)).toBe(true)
    setInspectedIndividual(w,null)
    expect(w.creatures.every(creature=>creature.decisionSummary===undefined)).toBe(true)
  })
})
