import {describe,expect,it} from 'vitest'
import {applyIntervention,createWorld,defaultConfig,finishGeneration,runGeneration,tick} from './engine'
import {decodeRun,encodeRun} from './checkpoint'
import {chooseHomeMove,recordHomeFoodExperience} from './homePolicy'
import type {Creature} from './types'

const homeOf=(creature:Creature)=>({homeX:creature.homeX,homeY:creature.homeY})
const expectAtHome=(creature:Creature,home:ReturnType<typeof homeOf>)=>{
  expect(homeOf(creature)).toEqual(home)
  expect({x:creature.x,y:creature.y}).toEqual({x:home.homeX,y:home.homeY})
}

describe('ecological family homes',()=>{
  it('keeps survivor homes exactly across repeated round boundaries, independent of arrival position',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:4,mutationRate:0,maxAge:20})
    const homes=new Map(world.creatures.map(creature=>[creature.individualId,homeOf(creature)]))
    for(let round=0;round<4;round++){
      for(const creature of world.creatures){
        creature.home=true
        creature.energy=10 // Survive without reproducing.
        creature.x=.5
        creature.y=.5
      }
      finishGeneration(world)
      expect(world.creatures).toHaveLength(homes.size)
      for(const creature of world.creatures){
        expectAtHome(creature,homes.get(creature.individualId)!)
        expect(creature.age).toBe(round+1)
        expect(creature.home).toBe(false)
        expect(creature.mode).toBe('exploring')
      }
    }
  })

  it('starts offspring at their parent home while preserving identity, inherited traits, and energy settlement',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:2,mutationRate:0,maturityAge:0,energyRetention:.75,reproductionEnergyCost:40,offspringEnergy:55})
    const parents=world.creatures.map(creature=>({...creature,home:true,energy:200}))
    world.creatures=parents
    finishGeneration(world)
    expect(world.creatures).toHaveLength(4)
    for(const parent of parents){
      const survivor=world.creatures.find(creature=>creature.individualId===parent.individualId)!
      const child=world.creatures.find(creature=>creature.parentIndividualId===parent.individualId)!
      expectAtHome(survivor,homeOf(parent))
      expectAtHome(child,homeOf(parent))
      expect(survivor).toMatchObject({individualId:parent.individualId,lineageId:parent.lineageId,birthGeneration:parent.birthGeneration,age:1,energy:110})
      expect(child.individualId).not.toBe(parent.individualId)
      expect(child).toMatchObject({lineageId:parent.lineageId,parentIndividualId:parent.individualId,birthGeneration:2,age:0,energy:55})
      for(const trait of ['speed','size','sense','aggression','caution','exploration'] as const){
        expect(survivor[trait]).toBe(parent[trait])
        expect(child[trait]).toBe(parent[trait])
      }
    }
  })

  it('continues to place independent founders and migrants around the edge',()=>{
    const world=createWorld({...defaultConfig,seed:3045219,initialPopulation:8})
    const originalCount=world.creatures.length
    applyIntervention(world,'founder-migration')
    expect(world.creatures.length).toBeGreaterThan(originalCount)
    expect(new Set(world.creatures.map(creature=>JSON.stringify(homeOf(creature)))).size).toBe(world.creatures.length)
    for(const creature of world.creatures){
      expectAtHome(creature,homeOf(creature))
      expect(creature.homeX===.025||creature.homeX===.975||creature.homeY===.025||creature.homeY===.975).toBe(true)
      expect(creature.parentIndividualId).toBeNull()
    }
  })

  it('preserves shared family homes and deterministic continuation through a checkpoint',()=>{
    const world=createWorld({...defaultConfig,seed:3045219,initialPopulation:3,maturityAge:0})
    for(const creature of world.creatures){creature.home=true;creature.energy=200}
    finishGeneration(world)
    expect(world.lastReport.born).toBe(3)
    const restored=decodeRun(encodeRun(world)).world
    expect(restored).toEqual(world)
    runGeneration(world)
    runGeneration(restored)
    expect(restored).toEqual(world)
  })

  it('moves a surviving family using consumed-food experience and pays after reproduction settlement',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1,maturityAge:0,energyRetention:.75,reproductionEnergyCost:40,offspringEnergy:55})
    const parent=world.creatures[0]
    Object.assign(parent,{homeX:.025,homeY:.3,home:true,energy:200})
    recordHomeFoodExperience(parent,.08,.8)
    const move=chooseHomeMove(parent,world.config,110)!
    expect(move).not.toBeNull()
    finishGeneration(world)
    const [survivor,child]=world.creatures
    expectAtHome(survivor,{homeX:move.toX,homeY:move.toY})
    expectAtHome(child,homeOf(survivor))
    expect(survivor.energy).toBeCloseTo(110-move.energyCost)
    expect(child.energy).toBe(55)
    expect(survivor.lastHomeMove).toEqual({...move,generation:2})
    expect(child.lastHomeMove).toBeUndefined()
    expect(survivor.homeExperience).toBeUndefined()
    expect(child.homeExperience).toBeUndefined()
    expect(world.activity.at(-1)).toMatchObject({kind:'home-relocated',generation:2,day:0,tick:0,actorIds:[parent.individualId],location:[move.toX,move.toY]})
    expect(world.history.at(-1)!.avgEnergy).toBeCloseTo((survivor.energy+child.energy)/2)
    for(const creature of world.creatures){creature.home=true;creature.energy=10}
    finishGeneration(world)
    expect(world.creatures[0].lastHomeMove).toEqual({...move,generation:2})
    expectAtHome(world.creatures[0],{homeX:move.toX,homeY:move.toY})
  })

  it('does not let remembered food rescue dead, late, or energy-poor creatures at settlement',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:3,maturityAge:0})
    for(const creature of world.creatures){
      Object.assign(creature,{homeX:.025,homeY:.3,home:true,energy:200})
      recordHomeFoodExperience(creature,.08,.8)
    }
    Object.assign(world.creatures[0],{alive:false,deathCause:'hunted'})
    world.creatures[1].home=false
    world.creatures[2].energy=10
    const remainingId=world.creatures[2].individualId
    finishGeneration(world)
    expect(world.creatures).toHaveLength(1)
    expect(world.creatures[0].individualId).toBe(remainingId)
    expectAtHome(world.creatures[0],{homeX:.025,homeY:.3})
    expect(world.creatures[0].lastHomeMove).toBeUndefined()
    expect(world.lastReport).toMatchObject({hunted:1,late:1,survived:1,born:0})
    expect(world.activity.some(entry=>entry.kind==='home-relocated')).toBe(false)
  })

  it('records food only for the eater, not observers or inspected creatures',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0,foodRegrowthRate:0,obstacleCount:0})
    const [eater,observer]=world.creatures
    Object.assign(eater,{x:.5,y:.5,reactionWindow:0,mode:'foraging'})
    Object.assign(observer,{x:.8,y:.8,reactionWindow:0})
    world.inspectedIndividualId=observer.individualId
    world.food=[{id:world.nextId++,x:.5,y:.5,energy:20,patchId:null}]
    tick(world,0)
    expect(world.dayFoodConsumed).toBe(1)
    expect(eater.homeExperience).toEqual({foodCount:1,foodX:.5,foodY:.5,dangerCount:0,dangerX:0,dangerY:0})
    expect(observer.homeExperience).toBeUndefined()
  })

  it('records one experienced danger for the prey of an admitted attack, excluding rejected claims',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:3,foodPerDay:0,foodRegrowthRate:0,obstacleCount:0,predationMode:'threshold'})
    const [hunter,rival,prey]=world.creatures
    Object.assign(prey,{x:.5,y:.5,size:.5,reactionWindow:0,mode:'fleeing'})
    for(const [index,actor] of [hunter,rival].entries())Object.assign(actor,{x:.5+(index+1)*.005,y:.5,size:2,reactionWindow:0,mode:'hunting',targetType:'prey',targetId:prey.id})
    tick(world,0)
    expect(world.dayAttackSuccesses).toBe(1)
    expect(world.dayAttackContested).toBe(1)
    expect(prey.homeExperience).toEqual({foodCount:0,foodX:0,foodY:0,dangerCount:1,dangerX:hunter.x,dangerY:hunter.y})
    expect(hunter.homeExperience).toBeUndefined()
    expect(rival.homeExperience).toBeUndefined()
  })

  it('resumes experience-driven relocation exactly from a checkpoint',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1,maturityAge:0})
    Object.assign(world.creatures[0],{homeX:.025,homeY:.3,home:true,energy:200})
    recordHomeFoodExperience(world.creatures[0],.08,.8)
    const restored=decodeRun(encodeRun(world)).world
    finishGeneration(world)
    finishGeneration(restored)
    expect(restored).toEqual(world)
    expect(restored.creatures[0].lastHomeMove).toBeDefined()
    expect(decodeRun(encodeRun(restored)).world).toEqual(restored)
  })

  it('lets a prey remember an attack it survived',()=>{
    const world=createWorld({...defaultConfig,seed:3045219,initialPopulation:2,foodPerDay:0,foodRegrowthRate:0,obstacleCount:0,predationMode:'contest'})
    const [hunter,prey]=world.creatures
    Object.assign(hunter,{x:.5,y:.5,size:1,speed:.3,energy:10,aggression:0,reactionWindow:0,mode:'hunting'})
    Object.assign(prey,{x:.505,y:.5,size:1,speed:2.8,energy:200,caution:1,reactionWindow:0,mode:'fleeing'})
    tick(world,0)
    expect(world.dayAttackFailures).toBe(1)
    expect(prey.alive).toBe(true)
    expect(prey.homeExperience).toMatchObject({dangerCount:1,dangerX:hunter.x,dangerY:hunter.y})
  })
})
