import{describe,expect,it}from'vitest'
import{applyIntervention,createWorld,finishGeneration,MAX_ACTIVITY_ENTRIES,SIMULATION_TIMESTEP,tick}from'./engine'
import{CLASSIC_MODES,defaultConfig}from'./config'
import{contestSuccessProbability}from'./predation'
import{keyedRandom}from'./random'
import type{World}from'./types'

const classic=(overrides:Partial<typeof defaultConfig>={})=>createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPerDay:0,obstacleCount:0,dayLength:60,...overrides})

describe('bounded world activity telemetry',()=>{
  it('starts empty and resets with a fresh world',()=>{
    const world=classic()
    expect(world.activity).toEqual([])
    expect(world.activityDropped).toBe(0)
    expect(world.activitySequence).toBe(0)
    applyIntervention(world,'drought')
    const reset=createWorld(world.config)
    expect(reset.activity).toEqual([])
    expect(reset.activityDropped).toBe(0)
    expect(reset.activitySequence).toBe(0)
  })

  it('does not write movement-only ticks, but records food and home arrivals with actor IDs',()=>{
    const moving=classic()
    tick(moving,SIMULATION_TIMESTEP)
    expect(moving.activity).toEqual([])

    const collecting=classic(),collector=collecting.creatures[0]
    Object.assign(collector,{x:.5,y:.5,homeX:.05,homeY:.05,angle:0,sense:.4})
    collecting.food=[{id:900,x:.5,y:.5,patchId:null,energy:22}]
    tick(collecting,SIMULATION_TIMESTEP)
    const collected=collecting.activity.find(entry=>entry.kind==='food-collected')
    expect(collected).toMatchObject({generation:1,tick:0,kind:'food-collected',count:1,actorIds:[collector.individualId]})
    expect(collected?.summary).toContain(`Individual ${collector.individualId}`)

    const arriving=classic(),traveller=arriving.creatures[0]
    Object.assign(traveller,{x:traveller.homeX,y:traveller.homeY,food:1,returning:true,mode:'returning'})
    tick(arriving,SIMULATION_TIMESTEP)
    expect(arriving.activity).toContainEqual(expect.objectContaining({kind:'reached-home',count:1,actorIds:[traveller.individualId]}))
  })

  it('records the actual variable food reward in ecological activity',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1,foodPerDay:0,obstacleCount:0,dayLength:60}),collector=world.creatures[0]
    Object.assign(collector,{x:.5,y:.5,homeX:.05,homeY:.05,angle:0,sense:.4})
    world.food=[{id:900,x:.5,y:.5,patchId:null,energy:27.4}]
    tick(world,SIMULATION_TIMESTEP)
    expect(world.activity.find(entry=>entry.kind==='food-collected')?.summary).toBe(`Individual ${collector.individualId} collected 27.4-energy food.`)
  })

  it('records energy deaths and admitted attacks without changing RNG state',()=>{
    const doomed=classic(),creature=doomed.creatures[0],rngBefore=doomed.rngState
    creature.energy=0
    tick(doomed,SIMULATION_TIMESTEP)
    expect(doomed.rngState).toBe(rngBefore)
    expect(doomed.activity).toContainEqual(expect.objectContaining({kind:'energy-death',actorIds:[creature.individualId],count:1}))

    const hunted=classic({initialPopulation:2,predatorRatio:1.2}),[attacker,prey]=hunted.creatures
    Object.assign(attacker,{x:.5,y:.5,size:2,speed:1,energy:100,aggression:1,mode:'hunting',targetType:'prey',targetId:prey.id,targetX:prey.x,targetY:prey.y,reactionWindow:0,attackCooldownUntil:0})
    Object.assign(prey,{x:.5,y:.5,size:1,speed:.4,energy:30,caution:0,reactionWindow:0})
    tick(hunted,SIMULATION_TIMESTEP)
    expect(hunted.activity).toContainEqual(expect.objectContaining({kind:'attack-success',attackerId:attacker.individualId,preyId:prey.individualId,actorIds:[attacker.individualId,prey.individualId],count:1}))
  })

  it('records contest failures with a finite contest chance',()=>{
    const make=(seed:number)=>{
      const world=createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0,obstacleCount:0,dayLength:60,predationMode:'contest',perceptionMode:'realistic',reactionTime:1,predatorRatio:3,contestSharpness:20})
      world.config.seed=seed
      const[attacker,prey]=world.creatures
      Object.assign(attacker,{x:.5,y:.5,size:1,speed:.3,energy:20,aggression:0,mode:'hunting',targetType:'prey',targetId:prey.id,targetX:prey.x,targetY:prey.y,reactionWindow:0,attackCooldownUntil:0})
      Object.assign(prey,{x:.5,y:.5,size:1,speed:2.8,energy:300,caution:1,reactionWindow:0})
      return{world,attacker,prey}
    }
    const probe=make(1),probability=contestSuccessProbability(probe.attacker,probe.prey,probe.world.config)
    expect(probability).toBeGreaterThan(0)
    expect(probability).toBeLessThan(1)
    let observed:ReturnType<typeof make>|undefined
    for(let seed=1;seed<64&&!observed;seed++){
      const candidate=make(seed)
      if(keyedRandom(seed,'predation-contest',1,0,candidate.attacker.individualId,candidate.prey.individualId)>=probability){tick(candidate.world,SIMULATION_TIMESTEP);observed=candidate}
    }
    expect(observed).toBeDefined()
    expect(observed?.world.activity).toContainEqual(expect.objectContaining({kind:'attack-failure',attackerId:observed?.attacker.individualId,preyId:observed?.prey.individualId,actorIds:[observed?.attacker.individualId,observed?.prey.individualId],contestChance:expect.any(Number)}))
    const attack=observed?.world.activity.find(entry=>entry.kind==='attack-failure')
    expect(attack?.contestChance).toBeGreaterThan(0)
    expect(attack?.contestChance).toBeLessThan(1)
    expect(attack?.summary).toMatch(/contest chance (?:<0\.01|\d+(?:\.\d+)?)%\)\.$/)
    expect(attack?.summary).not.toMatch(/NaN|Infinity/)
  })

  it('reports the final hunted cause when predation and attack-cost exhaustion coincide',()=>{
    const world=createWorld({...defaultConfig,seed:1,initialPopulation:2,foodPerDay:0,obstacleCount:0,dayLength:60,predationMode:'contest',perceptionMode:'realistic',reactionTime:1,predatorRatio:1.01,contestSharpness:20,attackCost:4,preyEnergy:0})
    const[hunter,doomed]=world.creatures
    Object.assign(hunter,{x:.5,y:.5,vx:0,vy:0,angle:0,size:1,speed:2.8,sense:.6,energy:100,aggression:1,caution:0,mode:'hunting',targetType:'prey',targetId:doomed.id,targetX:.5,targetY:.5,reactionWindow:0,attackCooldownUntil:0,returning:false})
    Object.assign(doomed,{x:.5,y:.5,vx:0,vy:0,angle:0,size:1,speed:.3,sense:.6,energy:2,aggression:0,caution:1,mode:'hunting',targetType:'prey',targetId:hunter.id,targetX:.5,targetY:.5,reactionWindow:0,attackCooldownUntil:0,returning:false})

    tick(world,SIMULATION_TIMESTEP)

    expect(doomed.deathCause).toBe('hunted')
    expect(world.activity).toContainEqual(expect.objectContaining({kind:'attack-success',attackerId:hunter.individualId,preyId:doomed.individualId}))
    expect(world.activity).not.toContainEqual(expect.objectContaining({kind:'energy-death',actorIds:[doomed.individualId]}))
  })

  it('aggregates positive regrowth and captures intervention actors',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1,foodPerDay:120,foodRegrowthRate:1,patchCapacity:60,obstacleCount:0,dayLength:60})
    world.food=[]
    for(const patch of world.environment.patches){patch.stock=0;patch.accumulator=0}
    for(let i=0;i<200&&!world.activity.some(entry=>entry.kind==='natural-regrowth');i++)tick(world,SIMULATION_TIMESTEP)
    const regrowth=world.activity.find(entry=>entry.kind==='natural-regrowth')
    expect(regrowth).toMatchObject({kind:'natural-regrowth',count:expect.any(Number)})
    expect(regrowth?.count).toBeGreaterThan(0)
    expect(regrowth?.actorIds).toBeUndefined()

    const migrated=classic()
    const count=applyIntervention(migrated,'founder-migration')
    const intervention=migrated.activity.at(-1)
    expect(intervention).toMatchObject({kind:'intervention',count,actorIds:migrated.creatures.slice(1).map(creature=>creature.individualId)})
  })

  it('retains the newest entries, increments exact drops, and keeps deterministic order',()=>{
    const world=classic()
    for(let index=0;index<MAX_ACTIVITY_ENTRIES+3;index++)applyIntervention(world,'drought')
    expect(world.activity).toHaveLength(MAX_ACTIVITY_ENTRIES)
    expect(world.activityDropped).toBe(3)
    expect(world.activity.map(entry=>entry.sequence)).toEqual(Array.from({length:MAX_ACTIVITY_ENTRIES},(_,index)=>index+4))
    expect(world.activity.every(entry=>entry.kind==='intervention'&&entry.generation===1&&entry.tick===0)).toBe(true)
    expect(world.activitySequence).toBe(MAX_ACTIVITY_ENTRIES+3)
  })

  it('orders simultaneous actor events independently of snapshot array order',()=>{
    const first=classic({initialPopulation:2}),second=structuredClone(first)
    for(const world of[first,second])for(const creature of world.creatures)Object.assign(creature,{x:creature.homeX,y:creature.homeY,food:1,returning:true,mode:'returning'})
    second.creatures.reverse()
    tick(first,SIMULATION_TIMESTEP)
    tick(second,SIMULATION_TIMESTEP)
    expect(first.activity).toEqual(second.activity)
    expect(first.activity.map(entry=>entry.actorIds?.[0])).toEqual([1,2])
  })

  it('records an exact settlement handoff and leaves prior entries immutable',()=>{
    const world=classic(),before=structuredClone(world),survivor=world.creatures[0]
    Object.assign(survivor,{home:true,food:2})
    finishGeneration(world)
    const settlement=world.activity.at(-1)
    expect(settlement).toMatchObject({generation:1,kind:'generation-settlement',count:world.creatures.length})
    expect(settlement?.summary).toBe('Generation 1 settled: 1 survivor + 1 admitted birth → generation 2 starts with 2 creatures.')
    expect(world.generation).toBe(2)
    expect(before.activity).toEqual([])
  })

  it('explains advanced maturity waits in settlement activity without changing classic copy',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1,foodPerDay:0,obstacleCount:0,dayLength:60,energyRetention:1,reproductionEnergyCost:10})
    Object.assign(world.creatures[0],{home:true,energy:100})
    finishGeneration(world)
    expect(world.ledger[0].birthsImmature).toBe(1)
    expect(world.activity.at(-1)?.summary).toContain('1 energy-ready survivor waited for maturity.')
  })

  it('lazily tolerates omitted activity fields on legacy snapshots',()=>{
    const world=classic() as World
    delete(world as Partial<World>).activity
    delete(world as Partial<World>).activityDropped
    delete(world as Partial<World>).activitySequence
    applyIntervention(world,'drought')
    expect(world.activity).toHaveLength(1)
    expect(world.activity[0].sequence).toBe(1)
    expect(world.activityDropped).toBe(0)
  })
})
