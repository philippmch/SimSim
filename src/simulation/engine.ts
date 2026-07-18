import type { BiologicalTrait,Config,Creature,GenerationLedger,HistoryPoint,InterventionKind,LineageAnalytics,SelectionSummary,Trait,World } from './types'
import { clamp,distance,random } from './random'
import { advanceFoodBudget,createEnvironment,effectiveFoodRegrowthRate,enforceAdvancedPatchCapacity,spawnFood,spawnRegrownFood,syncPatchStocks } from './environment'
import { decide,type Decision } from './behavior'
import { proposeMotion } from './motion'
import {defaultConfig,MAX_FOOD,MAX_HISTORY_POINTS,MAX_POPULATION,sanitizeConfig} from './config'
import {perceive} from './perception'
import {collectAttackClaims,resolveAttackClaims} from './predation'
import {advanceResourceDynamics,consumeResourceStock} from './resourceDynamics'
import {settleLifecycle} from './lifecycle'

export {defaultConfig} from './config'
export const SIMULATION_TIMESTEP=.025

function edgePoint(world:World){const edge=Math.floor(random(world)*4),p=.04+random(world)*.92
  return edge===0?{x:p,y:.025}:edge===1?{x:.975,y:p}:edge===2?{x:p,y:.975}:{x:.025,y:p}}
const emptyMemory=()=>({foodX:null,foodY:null,foodUntil:0,threatX:null,threatY:null,threatUntil:0})
const traitKeys:BiologicalTrait[]=['speed','size','sense','aggression','caution','exploration']
const MAX_WORLD_EVENTS=60
const traitRanges:Record<BiologicalTrait,number>={speed:2.5,size:2.5,sense:.565,aggression:1,caution:1,exploration:1}
const traitDirections:Record<BiologicalTrait,readonly [string,string]>={speed:['slower','faster'],size:['smaller','larger'],sense:['narrower-sensing','broader-sensing'],aggression:['less aggressive','more aggressive'],caution:['less cautious','more cautious'],exploration:['less exploratory','more exploratory']}
export function summarizeValues(values:number[]){if(!values.length)return{mean:null,variance:null,sd:null};const mean=values.reduce((a,b)=>a+b,0)/values.length,variance=values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length;return{mean,variance,sd:Math.sqrt(variance)}}
function selectionSummary(creatures:Creature[]):SelectionSummary{return Object.fromEntries(traitKeys.map(key=>[key,summarizeValues(creatures.map(c=>c[key]))])) as SelectionSummary}
function founderValue(world:World,value:number,variation:number,min:number,max:number,multiplicative=true){if(!variation)return value;const noise=random(world)+random(world)+random(world)+random(world)-2;return clamp(multiplicative?value*(1+noise*variation):value+noise*variation,min,max)}
type Identity={individualId:number;lineageId:number;parentIndividualId:number|null;birthGeneration:number}
function makeCreature(world:World,traits:Partial<Creature>={},identity?:Partial<Identity>,founder=false):Creature{
  const home=edgePoint(world),angle=Math.atan2(.5-home.y,.5-home.x)+(random(world)-.5)
  const physical=world.config.founderPhysicalVariation,behavior=world.config.founderBehaviorVariation
  const individualId=identity?.individualId??world.nextIndividualId++,lineageId=identity?.lineageId??world.nextLineageId++
  return{id:world.nextId++,x:home.x,y:home.y,homeX:home.x,homeY:home.y,angle,vx:0,vy:0,
    individualId,lineageId,parentIndividualId:identity?.parentIndividualId??null,birthGeneration:identity?.birthGeneration??world.generation,
    speed:traits.speed??(founder?founderValue(world,world.config.startSpeed,physical,.3,2.8):world.config.startSpeed),size:traits.size??(founder?founderValue(world,world.config.startSize,physical,.3,2.8):world.config.startSize),sense:traits.sense??(founder?founderValue(world,world.config.startSense,physical,.035,.6):world.config.startSense),
    aggression:traits.aggression??(founder?founderValue(world,world.config.startAggression,behavior,0,1,false):world.config.startAggression),caution:traits.caution??(founder?founderValue(world,world.config.startCaution,behavior,0,1,false):world.config.startCaution),exploration:traits.exploration??(founder?founderValue(world,world.config.startExploration,behavior,0,1,false):world.config.startExploration),
    energy:traits.energy??world.config.startingEnergy,food:0,alive:true,returning:false,home:false,age:traits.age??0,parentId:identity?.parentIndividualId??undefined,
    mode:'exploring',memory:emptyMemory(),targetType:null,targetId:null,targetX:.5,targetY:.5,commitUntil:0,wanderAngle:angle,wanderTurn:0,reactionWindow:-1,attackCooldownUntil:0,deathCause:null}
}
function averages(creatures:Creature[],generation:number):HistoryPoint{const n=creatures.length,m=(key:BiologicalTrait)=>summarizeValues(creatures.map(c=>c[key]))
  const speed=m('speed'),size=m('size'),sense=m('sense'),aggression=m('aggression'),caution=m('caution'),exploration=m('exploration')
  return{generation,population:n,avgSpeed:speed.mean,avgSize:size.mean,avgSense:sense.mean,avgAggression:aggression.mean,avgCaution:caution.mean,avgExploration:exploration.mean,sdSpeed:speed.sd,sdSize:size.sd,sdSense:sense.sd,sdAggression:aggression.sd,sdCaution:caution.sd,sdExploration:exploration.sd,avgEnergy:n?creatures.reduce((sum,c)=>sum+c.energy,0)/n:null,avgAge:n?creatures.reduce((sum,c)=>sum+c.age,0)/n:null}}

export function createWorld(config:Config=defaultConfig):World{
  config=sanitizeConfig(config)
  const world={config:{...config},generation:1,dayTime:0,tickIndex:0,creatures:[],food:[],history:[],ledger:[],events:[],environment:null as never,rngState:(config.seed||1)>>>0,nextId:1,nextIndividualId:1,nextLineageId:1,inspectedIndividualId:null,dayHunted:0,dayFoodProduced:0,dayFoodRemoved:0,dayFoodConsumed:0,dayPreyConsumed:0,dayAttackAttempts:0,dayAttackSuccesses:0,dayAttackFailures:0,generationFoodStart:0,lastReport:{survived:config.initialPopulation,born:0,starved:0,hunted:0,energy:0,unfed:0,late:0,aged:0,capped:0}} as World
  world.environment=createEnvironment(world,config)
  world.creatures=Array.from({length:config.initialPopulation},()=>makeCreature(world,{},undefined,true))
  world.food=spawnFood(world,Math.round(world.environment.foodBudget));enforceAdvancedPatchCapacity(world);syncPatchStocks(world);world.generationFoodStart=world.food.length;world.history=[averages(world.creatures,0)]
  return world
}

export function setInspectedIndividual(world:World,individualId:number|null){
  world.inspectedIndividualId=individualId
  for(const creature of world.creatures)if(creature.individualId!==individualId){delete creature.decisionSummary;delete creature.perceptionDiagnostics}
}

function recordEvent(world:World,kind:InterventionKind,summary:string,count:number){
  world.events??=[]
  world.events.push({generation:world.generation,day:Number(world.dayTime.toFixed(2)),kind,summary,count})
  if(world.events.length>MAX_WORLD_EVENTS)world.events=world.events.slice(-MAX_WORLD_EVENTS)
}

/** Applies a deterministic, live ecological shock. Replaying a seed with the same command sequence yields the same world. */
export function applyIntervention(world:World,kind:InterventionKind){
  if(kind==='resource-bloom'){
    const requested=Math.min(24,MAX_FOOD-world.food.length)
    const before=world.food.length
    if(requested>0)world.food.push(...spawnFood(world,requested))
    enforceAdvancedPatchCapacity(world);syncPatchStocks(world)
    const count=world.food.length-before
    world.dayFoodProduced+=count
    recordEvent(world,kind,count?`Resource bloom added ${count} food.`:'Resource bloom was capped; no food was added.',count)
    return count
  }
  if(kind==='drought'){
    const count=Math.min(world.food.length,Math.ceil(world.food.length*.4))
    const removed=new Set([...world.food].sort((a,b)=>a.id-b.id).slice(-count).map(food=>food.id))
    world.food=world.food.filter(food=>!removed.has(food.id))
    world.dayFoodRemoved+=count
    for(const patch of world.environment.patches)patch.accumulator=Math.min(patch.accumulator,.25)
    syncPatchStocks(world)
    recordEvent(world,kind,count?`Drought removed ${count} food.`:'Drought found no food to remove.',count)
    return count
  }
  const available=Math.max(0,MAX_POPULATION-world.creatures.filter(creature=>creature.alive).length)
  const count=Math.min(8,available)
  for(let i=0;i<count;i++)world.creatures.push(makeCreature(world,{},undefined,true))
  recordEvent(world,kind,count?`${count} new founders migrated into the population.`:'Migration was capped; the population is full.',count)
  return count
}

export function getLineageAnalytics(world:World):LineageAnalytics{
  const living=world.creatures.filter(creature=>creature.alive)
  const counts=new Map<number,number>()
  for(const creature of living)counts.set(creature.lineageId,(counts.get(creature.lineageId)??0)+1)
  const topLineages=[...counts].map(([lineageId,count])=>({lineageId,count,share:living.length?count/living.length:0})).sort((a,b)=>b.count-a.count||a.lineageId-b.lineageId).slice(0,5)
  const concentration=living.length?[...counts.values()].reduce((sum,count)=>sum+(count/living.length)**2,0):0
  const latest=world.ledger.at(-1)
  const delta=(after:number|null,before:number|null)=>after===null||before===null?null:after-before
  return{livingLineages:counts.size,effectiveDiversity:concentration?1/concentration:0,topLineages,latestGeneration:latest?.generation??null,selectionShifts:traitKeys.map(trait=>({trait,survivor:latest?delta(latest.selection.survivor[trait].mean,latest.selection.start[trait].mean):null,reproducer:latest?delta(latest.selection.reproducer[trait].mean,latest.selection.start[trait].mean):null}))}
}

type SelectionSignal={trait:BiologicalTrait;direction:string;effect:number;cohort:'survivor'|'reproducer'}
function strongestSelectionSignal(ledger:GenerationLedger,cohort:SelectionSignal['cohort']):SelectionSignal|null{
  let strongest:SelectionSignal|null=null
  for(const trait of traitKeys){
    const start=ledger.selection.start[trait],after=ledger.selection[cohort][trait]
    if(start.mean===null||start.sd===null||after.mean===null)continue
    const change=after.mean-start.mean,range=traitRanges[trait]
    if(start.sd<range*.005||Math.abs(change)<range*.005)continue
    const effect=change/start.sd
    if(Math.abs(effect)<.2||strongest&&Math.abs(effect)<=Math.abs(strongest.effect))continue
    strongest={trait,direction:traitDirections[trait][effect<0?0:1],effect,cohort}
  }
  return strongest
}

/** Turns the latest selection moments into one cautious, comparable plain-language takeaway. */
export function getSelectionTakeaway(ledger:GenerationLedger|undefined){
  if(!ledger)return'Finish a generation to see which traits stood out.'
  if(ledger.outcomes.survived===0)return`Generation ${ledger.generation} ended with no survivors, so there is no trait shift to compare.`
  const survivor=strongestSelectionSignal(ledger,'survivor'),reproducer=ledger.birthsAdmitted?strongestSelectionSignal(ledger,'reproducer'):null
  if(!survivor&&!reproducer)return`Generation ${ledger.generation}: trait averages stayed close to the starting population; no single trait stood out.${ledger.birthsAdmitted?'':' No offspring were born.'}`
  if(survivor&&reproducer&&survivor.trait===reproducer.trait&&Math.sign(survivor.effect)===Math.sign(reproducer.effect)){
    const direction=survivor.direction[0].toUpperCase()+survivor.direction.slice(1)
    return`Generation ${ledger.generation}: ${direction} creatures stood out among both survivors and parents of newborns.`
  }
  const signal=!survivor?reproducer:!reproducer?survivor:Math.abs(survivor.effect)>=Math.abs(reproducer.effect)?survivor:reproducer
  const magnitude=Math.abs(signal!.effect)<.5?'slightly':Math.abs(signal!.effect)<1?'noticeably':'substantially'
  const subject=signal!.cohort==='survivor'?'survivors':'parents of newborns'
  return`Generation ${ledger.generation}: ${subject} were ${magnitude} ${signal!.direction} on average than the starting population.${ledger.birthsAdmitted?'':' No offspring were born.'}`
}

export function tick(world:World,dt:number,boundaryConfig?:Config){
  for(const creature of world.creatures)if(creature.individualId!==world.inspectedIndividualId){delete creature.decisionSummary;delete creature.perceptionDiagnostics}
  const advanced=world.config.ecologyMode==='energy-regrowth'
  for(const c of world.creatures)if(c.alive&&!c.home&&(advanced?(c.returning||c.mode==='returning'):c.food>=1)&&distance(c,{x:c.homeX,y:c.homeY})<.025){c.home=true;c.mode='returning';c.vx=0;c.vy=0}
  const snapshots=world.creatures.filter(c=>c.alive&&!c.home).map(c=>({...c,memory:{...c.memory}})).sort((a,b)=>a.id-b.id)
  const decisions=new Map<number,Decision>()
  const reactionWindows=new Map<number,number>()
  const diagnostics=new Map<number,ReturnType<typeof perceive>['diagnostics']>()
  for(const c of snapshots){const seen=perceive(c,snapshots,world.food,world.environment.obstacles,world.config,world.generation,world.tickIndex,world.dayTime),window=seen.diagnostics.reactionWindow,react=world.config.perceptionMode==='perfect'||c.reactionWindow!==window
    const held:Decision={id:c.id,targetX:c.targetX,targetY:c.targetY,targetId:c.targetId,targetType:c.targetType??'explore',mode:c.mode,memory:{...c.memory},commitUntil:c.commitUntil,wanderAngle:c.wanderAngle,wanderTurn:c.wanderTurn,summary:c.decisionSummary}
    decisions.set(c.id,react?decide(c,seen.creatures,seen.food,world.config,world.dayTime,world.tickIndex,c.individualId===world.inspectedIndividualId):held);reactionWindows.set(c.id,window);if(c.individualId===world.inspectedIndividualId)diagnostics.set(c.id,seen.diagnostics)}
  const motions=new Map(snapshots.map(c=>[c.id,proposeMotion(c,decisions.get(c.id)!,world.config,world.environment.obstacles,dt)]))
  const byId=new Map(world.creatures.map(c=>[c.id,c]))
  for(const s of snapshots){const c=byId.get(s.id)!,d=decisions.get(s.id)!,m=motions.get(s.id)!
    Object.assign(c,{x:m.x,y:m.y,vx:m.vx,vy:m.vy,angle:m.angle,energy:m.energy,home:m.home||c.home,alive:m.energy>0,
      mode:m.home?'returning':d.mode,returning:c.returning||d.mode==='returning',memory:d.memory,targetType:d.targetType,targetId:d.targetId,targetX:d.targetX,targetY:d.targetY,commitUntil:d.commitUntil,wanderAngle:d.wanderAngle,wanderTurn:d.wanderTurn,reactionWindow:reactionWindows.get(c.id)!,decisionSummary:d.summary,perceptionDiagnostics:diagnostics.get(c.id)})
    if(m.energy<=0)c.deathCause='energy'
  }
  const claimants=snapshots.map(s=>byId.get(s.id)!).filter(c=>c.alive&&!c.home&&(advanced||c.food<2))
  const preyTargets=snapshots.map(s=>byId.get(s.id)!).filter(c=>c.alive&&!c.home)
  const foodClaims:{actor:number;resource:number;d:number}[]=[]
  const attackers:Creature[]=[]
  for(const c of claimants){
    if(c.mode==='hunting'&&world.dayTime>=c.attackCooldownUntil)attackers.push(c)
    else if(c.mode!=='hunting'){
      let best=world.food[0],bestD=best?distance(c,best):Infinity
      for(const f of world.food){const d=distance(c,f);if(d<bestD||(d===bestD&&f.id<(best?.id??Infinity))){best=f;bestD=d}}
      if(best&&bestD<.016+.009*c.size)foodClaims.push({actor:c.id,resource:best.id,d:bestD})
    }
  }
  const winners=<T extends {actor:number;resource:number;d:number}>(claims:T[])=>{const won=new Map<number,T>();for(const q of claims.sort((a,b)=>a.resource-b.resource||a.d-b.d||a.actor-b.actor))if(!won.has(q.resource))won.set(q.resource,q);return[...won.values()]}
  const foodWins=winners(foodClaims),foodById=new Map(world.food.map(food=>[food.id,food]))
  const eatenFood=new Set<number>()
  for(const q of foodWins){const actor=byId.get(q.actor),food=foodById.get(q.resource);if(actor&&food&&(advanced||actor.food<2)){actor.food++;actor.energy+=advanced?food.energy:22;eatenFood.add(q.resource);world.dayFoodConsumed++;if(advanced&&food.patchId!==null)world.environment.patches=consumeResourceStock({patches:world.environment.patches},food.patchId).patches}}
  world.food=world.food.filter(f=>!eatenFood.has(f.id))
  const attackClaims=collectAttackClaims(attackers,preyTargets,world.config),resolution=resolveAttackClaims(attackClaims,world.config,{seed:world.config.seed,generation:world.generation,tick:world.tickIndex})
  world.dayAttackAttempts+=world.config.predationMode==='threshold'?attackClaims.length:resolution.admitted.length;world.dayAttackSuccesses+=resolution.successes.length;world.dayAttackFailures+=resolution.failures.length
  for(const delta of resolution.energyDeltas){const actor=byId.get(delta.id);if(actor){actor.energy+=delta.delta;if(actor.energy<=0){actor.alive=false;actor.deathCause='energy'}}}
  for(const cooldown of resolution.cooldowns){const actor=byId.get(cooldown.id);if(actor)actor.attackCooldownUntil=world.dayTime+cooldown.duration}
  for(const outcome of resolution.successes){const actor=byId.get(outcome.attacker.id);if(actor)actor.food++}
  const killed=new Set(resolution.killedPreyIds);world.dayPreyConsumed+=resolution.successes.length
  for(const id of killed){const prey=byId.get(id);if(prey&&!prey.home){prey.alive=false;prey.deathCause='hunted'}}
  world.dayHunted+=killed.size
  if(advanced){const step=advanceResourceDynamics({patches:world.environment.patches},{ecologyMode:'energy-regrowth',patchCapacity:world.config.patchCapacity,foodRegrowthRate:effectiveFoodRegrowthRate(world.environment,world.config),foodPatchSpread:world.config.foodPatchSpread,maxFood:180},{seed:world.config.seed,generation:world.generation,dt,generationDuration:world.config.dayLength,currentFoodCount:world.food.length});world.environment.patches=step.state.patches;const produced=spawnRegrownFood(world,step.placements);world.food.push(...produced);world.dayFoodProduced+=produced.length}
  if(world.inspectedIndividualId!==null&&!world.creatures.some(creature=>creature.alive&&creature.individualId===world.inspectedIndividualId))setInspectedIndividual(world,null)
  world.dayTime+=dt;world.tickIndex++
  if(world.dayTime>=world.config.dayLength){finishGeneration(world,boundaryConfig);return true}return false
}

function mutate(world:World,value:number,trait:Trait){const c=world.config
  const enabled=trait==='speed'?c.mutateSpeed:trait==='size'?c.mutateSize:trait==='sense'?c.mutateSense:trait==='aggression'?c.mutateAggression:trait==='caution'?c.mutateCaution:c.mutateExploration
  if(!enabled||random(world)>c.mutationRate)return value
  const variation=(random(world)+random(world)+random(world)+random(world)-2)*c.mutationStrength
  const behavioral=trait==='aggression'||trait==='caution'||trait==='exploration'
  const result=behavioral?value+variation:value*(1+variation)
  return clamp(result,trait==='sense'?.035:trait==='speed'||trait==='size'?.3:0,trait==='sense'?.6:trait==='speed'||trait==='size'?2.8:1)}

export function finishGeneration(world:World,boundaryConfig:Config=world.config){const start=[...world.creatures].sort((a,b)=>a.individualId-b.individualId),settlement=settleLifecycle(start,world.config,{seed:world.config.seed,generation:world.generation,maxPopulation:MAX_POPULATION}),survivors=settlement.survivors.map(item=>item.individual),birthParents=settlement.admittedParents,outcomes=settlement.outcomeCounts
  const next:Creature[]=settlement.survivors.map(({individual:c,nextAge,settledEnergy})=>makeCreature(world,{speed:c.speed,size:c.size,sense:c.sense,aggression:c.aggression,caution:c.caution,exploration:c.exploration,age:nextAge,energy:settledEnergy},{individualId:c.individualId,lineageId:c.lineageId,parentIndividualId:c.parentIndividualId,birthGeneration:c.birthGeneration}))
  for(const {parent:c,energy} of settlement.births){next.push(makeCreature(world,{speed:mutate(world,c.speed,'speed'),size:mutate(world,c.size,'size'),sense:mutate(world,c.sense,'sense'),aggression:mutate(world,c.aggression,'aggression'),caution:mutate(world,c.caution,'caution'),exploration:mutate(world,c.exploration,'exploration'),age:0,energy},{lineageId:c.lineageId,parentIndividualId:c.individualId,birthGeneration:world.generation+1}))}
  const ledger:GenerationLedger={generation:world.generation,startPopulation:start.length,outcomes,foodAtStart:world.generationFoodStart,foodProduced:world.dayFoodProduced,foodRemoved:world.dayFoodRemoved,foodConsumed:world.dayFoodConsumed,foodRemaining:world.food.length,preyConsumed:world.dayPreyConsumed,attackAttempts:world.dayAttackAttempts,attackSuccesses:world.dayAttackSuccesses,attackFailures:world.dayAttackFailures,birthsEligible:settlement.eligibleParents.length,birthsAdmitted:birthParents.length,birthsCapped:settlement.birthsCapped,selection:{start:selectionSummary(start),survivor:selectionSummary(survivors),reproducer:selectionSummary(birthParents)}}
  world.ledger.push(ledger);if(world.ledger.length>MAX_HISTORY_POINTS)world.ledger=world.ledger.slice(-MAX_HISTORY_POINTS)
  world.lastReport={survived:outcomes.survived,born:birthParents.length,starved:outcomes.energy+outcomes.unfed+outcomes.late,hunted:outcomes.hunted,energy:outcomes.energy,unfed:outcomes.unfed,late:outcomes.late,aged:outcomes.aged,capped:ledger.birthsCapped}
  world.generation++;world.dayTime=0;world.tickIndex=0;world.creatures=next;if(world.inspectedIndividualId!==null&&!next.some(c=>c.individualId===world.inspectedIndividualId))world.inspectedIndividualId=null
  const nextFoodBudget=advanceFoodBudget(world.environment,boundaryConfig,world.generation);if(boundaryConfig.ecologyMode==='classic'){world.food=spawnFood(world,nextFoodBudget,boundaryConfig);syncPatchStocks(world)}world.generationFoodStart=world.food.length;world.history.push(averages(world.creatures,world.generation-1));if(world.history.length>MAX_HISTORY_POINTS)world.history=world.history.slice(-MAX_HISTORY_POINTS)
  world.dayHunted=0;world.dayFoodProduced=0;world.dayFoodRemoved=0;world.dayFoodConsumed=0;world.dayPreyConsumed=0;world.dayAttackAttempts=0;world.dayAttackSuccesses=0;world.dayAttackFailures=0
}
export function runGeneration(world:World,boundaryConfig?:Config){const target=world.generation;let guard=0;while(world.generation===target&&guard++<10000)tick(world,SIMULATION_TIMESTEP,boundaryConfig)}
export function getStats(world:World){const p=averages(world.creatures.filter(c=>c.alive),world.generation);return{...p,avgSpeed:p.avgSpeed??0,avgSize:p.avgSize??0,avgSense:p.avgSense??0,avgAggression:p.avgAggression??0,avgCaution:p.avgCaution??0,avgExploration:p.avgExploration??0,avgEnergy:p.avgEnergy??0,avgAge:p.avgAge??0}}
export function getModeCounts(world:World){const counts={exploring:0,foraging:0,hunting:0,fleeing:0,returning:0};for(const c of world.creatures)if(c.alive&&!c.home)counts[c.mode]++;return counts}
