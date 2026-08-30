import{describe,expect,it}from'vitest'
import{createWorld,finishGeneration,runGeneration,SIMULATION_TIMESTEP,tick}from'./engine'
import{CLASSIC_MODES,defaultConfig,MAX_FOOD}from'./config'
import{advanceFoodBudget,effectiveFoodRegrowthRate}from'./environment'
import{advanceResourceDynamics,createResourceDynamicsState}from'./resourceDynamics'
import{contestSuccessProbability}from'./predation'
import{keyedRandom}from'./random'
import type{Creature,Food,World}from'./types'

const advanced=(overrides:Partial<typeof defaultConfig>={})=>createWorld({...defaultConfig,initialPopulation:2,foodPerDay:0,obstacleCount:0,founderPhysicalVariation:0,founderBehaviorVariation:0,...overrides})
const item=(id:number,x:number,y:number,patchId:number|null=null,energy=22):Food=>({id,x,y,patchId,energy})
const sortedCreatures=(world:World)=>[...world.creatures].sort((a,b)=>a.id-b.id)

describe('environment-modulated regrowth',()=>{
  it('makes seasons and trends diverge while environment response controls lag',()=>{const base={...defaultConfig,seasonAmplitude:.5,seasonLength:4,foodTrend:0,environmentResponse:1,foodRegrowthRate:.2},environment=()=>({patches:[],obstacles:[],foodBudget:defaultConfig.foodPerDay,targetFood:defaultConfig.foodPerDay}),summer=environment(),winter=environment();advanceFoodBudget(summer,base,2);advanceFoodBudget(winter,base,4);const summerRate=effectiveFoodRegrowthRate(summer,base),winterRate=effectiveFoodRegrowthRate(winter,base);expect(summerRate).toBeGreaterThan(winterRate);expect(effectiveFoodRegrowthRate(environment(),base)).toBe(base.foodRegrowthRate)
    const production=(rate:number)=>advanceResourceDynamics(createResourceDynamicsState([{id:1,x:.5,y:.5}]),{ecologyMode:'energy-regrowth',patchCapacity:20,foodRegrowthRate:rate,foodPatchSpread:.1,maxFood:180},{seed:1,generation:2,dt:5,generationDuration:5,currentFoodCount:0}).placements.length;expect(production(summerRate)).toBeGreaterThan(production(winterRate))
    const positive=environment(),negative=environment();advanceFoodBudget(positive,{...base,seasonAmplitude:0,foodTrend:.1},5);advanceFoodBudget(negative,{...base,seasonAmplitude:0,foodTrend:-.1},5);expect(effectiveFoodRegrowthRate(positive,base)).toBeGreaterThan(effectiveFoodRegrowthRate(negative,base));const fast=environment(),slow=environment();advanceFoodBudget(fast,base,2);advanceFoodBudget(slow,{...base,environmentResponse:.1},2);expect(slow.foodBudget).toBeGreaterThan(defaultConfig.foodPerDay);expect(slow.foodBudget).toBeLessThan(fast.foodBudget)})
})

describe('integrated realistic perception and reaction',()=>{
  it('records selected-only FOV/occlusion diagnostics and holds decisions inside a reaction window',()=>{const w=advanced({perceptionMode:'realistic',fieldOfView:90,detectionFalloff:0,reactionTime:.2}),[actor,behind]=w.creatures;Object.assign(actor,{x:.5,y:.5,angle:0,sense:.35});Object.assign(behind,{x:.4,y:.5});w.environment.obstacles=[{id:800,x:.6,y:.5,radius:.03}];w.food=[item(900,.7,.5)];w.inspectedIndividualId=actor.individualId
    tick(w,SIMULATION_TIMESTEP);expect(actor.perceptionDiagnostics).toMatchObject({mode:'realistic',creatures:{fov:1},food:{occlusion:1}});expect(behind.perceptionDiagnostics).toBeUndefined();const held={type:actor.targetType,id:actor.targetId,x:actor.targetX,y:actor.targetY};w.environment.obstacles=[];w.config.fieldOfView=360;w.food=[item(901,actor.x+.1,actor.y)]
    tick(w,SIMULATION_TIMESTEP);expect({type:actor.targetType,id:actor.targetId,x:actor.targetX,y:actor.targetY}).toEqual(held);for(let i=0;i<7;i++)tick(w,SIMULATION_TIMESTEP);expect(actor.reactionWindow).toBe(1);expect(actor.targetType).toBe('food');expect(actor.targetId).toBe(901)})
})

describe('integrated resource and lifecycle mechanics',()=>{
  it('regrows obstacle-safe bounded food, conserves ledger mass, and honors drought',()=>{const w=advanced({initialPopulation:1,foodPerDay:defaultConfig.foodPerDay,foodRegrowthRate:1,patchCapacity:8,dayLength:5,obstacleCount:4});w.food=[];w.generationFoodStart=0;for(const patch of w.environment.patches){patch.stock=0;patch.accumulator=0}while(w.generation===1)tick(w,SIMULATION_TIMESTEP);const ledger=w.ledger[0];expect(ledger.foodProduced).toBeGreaterThan(0);expect(ledger.foodAtStart+ledger.foodProduced).toBe(ledger.foodConsumed+ledger.foodRemaining);expect(ledger.foodRemaining).toBeLessThanOrEqual(MAX_FOOD);expect(w.food.every(food=>food.x>.01&&food.x<.99&&food.y>.01&&food.y<.99&&w.environment.obstacles.every(obstacle=>Math.hypot(food.x-obstacle.x,food.y-obstacle.y)>obstacle.radius+.01))).toBe(true)
    const capped=advanced({initialPopulation:1,foodPerDay:120,foodRegrowthRate:1,patchCapacity:MAX_FOOD,dayLength:5});for(let i=0;i<80;i++)tick(capped,SIMULATION_TIMESTEP);expect(capped.food.length).toBeLessThanOrEqual(MAX_FOOD)
    const drought=advanced({initialPopulation:1,foodPerDay:0,foodRegrowthRate:1,dayLength:5});while(drought.generation===1)tick(drought,SIMULATION_TIMESTEP);expect(drought.ledger[0]).toMatchObject({foodAtStart:0,foodProduced:0,foodConsumed:0,foodRemaining:0})})
  it('lets advanced returners arrive home without a legacy food token',()=>{const w=advanced({initialPopulation:1}),creature=w.creatures[0];Object.assign(creature,{x:creature.homeX,y:creature.homeY,food:0,returning:true,mode:'returning',targetType:'home',targetX:creature.homeX,targetY:creature.homeY,reactionWindow:0});tick(w,SIMULATION_TIMESTEP);expect(creature.home).toBe(true)})
  it('enforces patch capacity on advanced initialization without changing classic pulses',()=>{const capped=advanced({initialPopulation:1,foodPatchCount:1,patchCapacity:1,foodPerDay:120});expect(capped.food).toHaveLength(1);expect(capped.environment.patches[0].stock).toBe(1);const classic=createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPatchCount:1,patchCapacity:1,foodPerDay:120});expect(classic.food.length).toBeGreaterThan(1)})
  it('uses the next full boundary config for budget and classic pulse without mutating active config',()=>{const active={...defaultConfig,...CLASSIC_MODES,initialPopulation:1,foodPerDay:12,dayLength:5},w=createWorld(active),boundary={...active,foodPerDay:0,environmentResponse:1};runGeneration(w,boundary);expect(w.config.foodPerDay).toBe(12);expect(w.environment.targetFood).toBe(0);expect(w.food).toHaveLength(0)})
  it('carries energy, charges admitted reproduction, seeds offspring energy, and reports age death',()=>{const w=advanced({energyRetention:.5,reproductionEnergyCost:35,offspringEnergy:70,maxAge:2}),[parent,aged]=w.creatures;Object.assign(parent,{home:true,energy:100,age:0});Object.assign(aged,{home:true,energy:100,age:2});finishGeneration(w);expect(w.ledger[0].outcomes).toMatchObject({survived:1,aged:1});expect(w.lastReport.aged).toBe(1);const adult=w.creatures.find(c=>c.individualId===parent.individualId)!,child=w.creatures.find(c=>c.parentIndividualId===parent.individualId)!;expect(adult.energy).toBe(15);expect(child.energy).toBe(70);expect(child.lineageId).toBe(parent.lineageId)})
  it('records zero-retention extinction at the boundary and never creates a zero-energy adult',()=>{const w=advanced({initialPopulation:1,energyRetention:0}),creature=w.creatures[0];Object.assign(creature,{alive:true,home:true,energy:100});finishGeneration(w);expect(w.ledger[0].outcomes.energy).toBe(1);expect(w.lastReport.energy).toBe(1);expect(w.creatures).toHaveLength(0)})
  it('uses fair keyed recruitment consistently under an integrated population cap',()=>{const a=advanced({seed:19,initialPopulation:119,energyRetention:1,reproductionEnergyCost:10,offspringEnergy:40}),b=structuredClone(a);for(const world of[a,b])for(const creature of world.creatures)Object.assign(creature,{home:true,energy:100});b.creatures.reverse();finishGeneration(a);finishGeneration(b);const parentA=a.creatures.find(c=>c.birthGeneration===2)!.parentIndividualId,parentB=b.creatures.find(c=>c.birthGeneration===2)!.parentIndividualId;expect(parentB).toBe(parentA);expect(parentA).not.toBe(1);expect(a.creatures).toHaveLength(120)})
})

describe('integrated contest predation',()=>{
  const setup=(success:boolean)=>{const template=advanced({perceptionMode:'realistic',reactionTime:1,predationMode:'contest',attackCost:4,handlingTime:.45,preyEnergy:30}),[attacker,prey]=template.creatures;Object.assign(attacker,{x:.5,y:.5,size:1.2,speed:success?2:.4,energy:success?180:40,aggression:success?1:0,caution:0,mode:'hunting',targetType:'prey',targetId:prey.id,targetX:prey.x,targetY:prey.y,reactionWindow:0});Object.assign(prey,{x:.5,y:.5,size:1,speed:(success ? .4 : 2.8),energy:success?40:300,caution:success?0:1,reactionWindow:0});const probability=contestSuccessProbability(attacker,prey,template.config);let seed=1;while((keyedRandom(seed,'predation-contest',1,0,attacker.individualId,prey.individualId)<probability)!==success)seed++;template.config.seed=seed;return{world:template,attacker,prey}}
  it('charges failures, rewards only successes, applies cooldowns, and ignores array order',()=>{const failure=setup(false),beforeFailure=failure.attacker.energy;tick(failure.world,SIMULATION_TIMESTEP);expect(failure.world).toMatchObject({dayAttackAttempts:1,dayAttackSuccesses:0,dayAttackFailures:1});expect(failure.attacker.energy).toBeLessThan(beforeFailure-3.9);expect(failure.prey.alive).toBe(true);expect(failure.attacker.attackCooldownUntil).toBeGreaterThan(failure.world.dayTime);const attempts=failure.world.dayAttackAttempts;tick(failure.world,SIMULATION_TIMESTEP);expect(failure.world.dayAttackAttempts).toBe(attempts)
    const success=setup(true),permuted=structuredClone(success.world),beforeSuccess=success.attacker.energy;permuted.creatures.reverse();tick(success.world,SIMULATION_TIMESTEP);tick(permuted,SIMULATION_TIMESTEP);expect(success.world).toMatchObject({dayAttackAttempts:1,dayAttackSuccesses:1,dayAttackFailures:0});expect(success.attacker.energy).toBeGreaterThan(beforeSuccess);expect(success.prey.alive).toBe(false);expect(sortedCreatures(permuted)).toEqual(sortedCreatures(success.world))})

  it('records contested claims and the attempt basis for both predation modes',()=>{
    const run=(predationMode:'threshold'|'contest')=>{
      const world=advanced({initialPopulation:5,predationMode,perceptionMode:'realistic',reactionTime:5,fieldOfView:360,obstacleOcclusion:false,dayLength:5}),[first,second,third,contestedPrey,otherPrey]=world.creatures
      Object.assign(first,{x:.3,y:.3,size:2,speed:2,energy:200,aggression:1,mode:'hunting',targetType:'prey',targetId:contestedPrey.id,targetX:contestedPrey.x,targetY:contestedPrey.y,reactionWindow:0,attackCooldownUntil:0})
      Object.assign(second,{x:.3,y:.3,size:2,speed:2,energy:200,aggression:1,mode:'hunting',targetType:'prey',targetId:contestedPrey.id,targetX:contestedPrey.x,targetY:contestedPrey.y,reactionWindow:0,attackCooldownUntil:0})
      Object.assign(third,{x:.7,y:.7,size:1.2,speed:.4,energy:20,aggression:0,mode:predationMode==='contest'?'hunting':'exploring',targetType:predationMode==='contest'?'prey':'explore',targetId:predationMode==='contest'?otherPrey.id:null,targetX:otherPrey.x,targetY:otherPrey.y,reactionWindow:0,attackCooldownUntil:0})
      Object.assign(contestedPrey,{x:.3,y:.3,size:1,speed:.4,energy:40,caution:0,mode:'exploring',targetType:'explore',targetId:null,targetX:.3,targetY:.3,reactionWindow:0})
      Object.assign(otherPrey,{x:.7,y:.7,size:1,speed:2.8,energy:300,caution:1,mode:'exploring',targetType:'explore',targetId:null,targetX:.7,targetY:.7,reactionWindow:0})
      if(predationMode==='contest'){
        const firstProbability=contestSuccessProbability(first,contestedPrey,world.config),thirdProbability=contestSuccessProbability(third,otherPrey,world.config)
        let seed=1
        while(!(keyedRandom(seed,'predation-contest',1,0,first.individualId,contestedPrey.individualId)<firstProbability&&keyedRandom(seed,'predation-contest',1,0,third.individualId,otherPrey.individualId)>=thirdProbability))seed++
        world.config.seed=seed
      }
      expect(world.dayAttackContested).toBe(0)
      tick(world,SIMULATION_TIMESTEP)
      expect(world).toMatchObject({dayAttackAttempts:2,dayAttackSuccesses:1,dayAttackFailures:predationMode==='threshold'?0:1,dayAttackContested:1})
      finishGeneration(world)
      expect(world.ledger.at(-1)).toMatchObject({attackAttempts:2,attackSuccesses:1,attackFailures:predationMode==='threshold'?0:1,attackContested:1,attackAttemptBasis:predationMode==='threshold'?'claims':'admitted'})
      expect(world.dayAttackContested).toBe(0)
    }
    run('threshold')
    run('contest')
  })
})
