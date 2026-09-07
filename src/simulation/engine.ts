import { END_CAUSES } from './types'
import type { BiologicalTrait,Config,Creature,GenerationLedger,HistoryPoint,InheritanceSummary,InterventionKind,LastInspectedOutcome,LineageAnalytics,SelectionSummary,TerminalEndCause,Trait,World,WorldActivityEntry,WorldActivityKind,WorldEvent } from './types'
import { clamp,distance,random } from './random'
import { advanceFoodBudget,createEnvironment,effectiveFoodRegrowthRate,enforceAdvancedPatchCapacity,spawnFood,spawnRegrownFood,syncPatchStocks } from './environment'
import { decide,safeFoodEnergy,type Decision } from './behavior'
import { proposeMotion } from './motion'
import {defaultConfig,MAX_FOOD,MAX_FOUNDER_MIGRATION_BATCH,MAX_HISTORY_POINTS,MAX_POPULATION,sanitizeConfig} from './config'
import {perceiveCanonical,reactionWindowFor} from './perception'
import {collectAttackClaims,resolveAttackClaims} from './predation'
import {advanceResourceDynamics,consumeResourceStock} from './resourceDynamics'
import {settleLifecycle} from './lifecycle'
import {retainIndividualActivity} from './individualHistory'
import {restingEnergyRate,shouldLeaveHome} from './energyPolicy'

export {defaultConfig} from './config'
export { getSelectionTakeaway, meetsStandardizedEffectThreshold, snapStandardizedEffect, SELECTION_SIGNAL_THRESHOLD, SELECTION_PATTERN_THRESHOLD, SELECTION_PATTERN_MIN_COUNT, SELECTION_THRESHOLD_TOLERANCE } from './selectionNarrative'
export const SIMULATION_TIMESTEP=.025

function edgePoint(world:World){const edge=Math.floor(random(world)*4),p=.04+random(world)*.92
  return edge===0?{x:p,y:.025}:edge===1?{x:.975,y:p}:edge===2?{x:p,y:.975}:{x:.025,y:p}}
const emptyMemory=()=>({foodX:null,foodY:null,foodUntil:0,threatX:null,threatY:null,threatUntil:0})
const traitKeys:BiologicalTrait[]=['speed','size','sense','aggression','caution','exploration']
export const MAX_WORLD_EVENTS=60
/** Keep the actor-level story small enough to ship with every simulation snapshot. */
export const MAX_ACTIVITY_ENTRIES=24
type ActivityCursor={generation?:unknown;day?:unknown;tick?:unknown}
type ActivityOptions={actorIds?:readonly unknown[];attackerId?:unknown;preyId?:unknown;contestChance?:unknown;location?:unknown;cursor?:ActivityCursor}
const safeActivityInteger=(value:unknown,min=0):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min?value:null
const safeActivityCount=(value:unknown)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0)return 0;return Math.min(Number.MAX_SAFE_INTEGER,Math.floor(value))}
const safeActivityDay=(value:unknown)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0)return 0;const rounded=Math.round(value*1000)/1000;return Number.isFinite(rounded)?rounded:Number.MAX_SAFE_INTEGER}
const safeActivitySummary=(value:unknown)=>typeof value==='string'&&value.trim().length?value:'Activity update unavailable.'
const safeActivityChance=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):null
const safeActivityLocation=(value:unknown):[number,number]|null=>{
  if(value===null||typeof value!=='object')return null
  try{
    const candidate=value as readonly unknown[],x=candidate[0],y=candidate[1]
    return candidate.length===2&&typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1&&typeof y==='number'&&Number.isFinite(y)&&y>=0&&y<=1?[x,y]:null
  }catch{return null}
}
const formatActivityPercent=(chance:number)=>{const percent=chance*100;if(percent>0&&percent<.01)return'<0.01';return percent<.1?percent.toFixed(2):percent<10?percent.toFixed(1):percent.toFixed(0)}

/**
 * Initialize legacy snapshots lazily.  Keeping this tolerant is important for
 * fallback mode, where a hand-authored or older snapshot can become the live
 * mutable world without passing through createWorld first.
 */
function ensureActivityState(world:World){
  if(!Array.isArray(world.activity))world.activity=[]
  const storedDropped=safeActivityInteger(world.activityDropped)
  if(storedDropped===null)world.activityDropped=0
  let latest=safeActivityInteger(world.activitySequence)??0
  for(const entry of world.activity){const sequence=safeActivityInteger((entry as Partial<WorldActivityEntry>|null)?.sequence,1);if(sequence!==null)latest=Math.max(latest,sequence)}
  if(latest>=Number.MAX_SAFE_INTEGER){
    world.activity=world.activity.slice(-MAX_ACTIVITY_ENTRIES).map((entry,index)=>({...entry,sequence:index+1}))
    latest=world.activity.length
  }
  world.activitySequence=latest
  if(world.activity.length>MAX_ACTIVITY_ENTRIES){
    const dropped=world.activity.length-MAX_ACTIVITY_ENTRIES
    world.activity=world.activity.slice(-MAX_ACTIVITY_ENTRIES)
    world.activityDropped=Math.min(Number.MAX_SAFE_INTEGER,world.activityDropped+dropped)
  }
}

/** Append one bounded, deterministic activity fact without touching simulation RNG. */
function recordActivity(world:World,kind:WorldActivityKind,summary:string,count:number,options:ActivityOptions={}){
  ensureActivityState(world)
  const sequence=world.activitySequence<Number.MAX_SAFE_INTEGER?world.activitySequence+1:1
  world.activitySequence=sequence
  const generation=safeActivityInteger(options.cursor?.generation??world.generation,0)??0
  const tick=safeActivityInteger(options.cursor?.tick??world.tickIndex,0)??0
  const entry:WorldActivityEntry={sequence,generation,day:safeActivityDay(options.cursor?.day??world.dayTime),tick,kind,summary:safeActivitySummary(summary),count:safeActivityCount(count)}
  const location=safeActivityLocation(options.location)
  if(location)entry.location=location
  const actorIds=(options.actorIds??[]).map(value=>safeActivityInteger(value)).filter((id):id is number=>id!==null)
  if(actorIds.length)entry.actorIds=[...actorIds]
  const attackerId=safeActivityInteger(options.attackerId)
  if(attackerId!==null)entry.attackerId=attackerId
  const preyId=safeActivityInteger(options.preyId)
  if(preyId!==null)entry.preyId=preyId
  const contestChance=safeActivityChance(options.contestChance)
  if(contestChance!==null)entry.contestChance=contestChance
  retainIndividualActivity(world,entry)
  world.activity.push(entry)
  if(world.activity.length>MAX_ACTIVITY_ENTRIES){world.activity.shift();world.activityDropped=Math.min(Number.MAX_SAFE_INTEGER,world.activityDropped+1)}
}

const activityActorLabel=(individualId:unknown)=>{const id=safeActivityInteger(individualId);return id===null?'An actor':`Individual ${id}`}
const activityActorIds=(...ids:unknown[])=>ids.map(value=>safeActivityInteger(value)).filter((id):id is number=>id!==null)
const activityCountLabel=(count:number,singular:string)=>`${count} ${count===1?singular:`${singular}s`}`
export function summarizeValues(values:number[]){if(!values.length)return{mean:null,variance:null,sd:null};const mean=values.reduce((a,b)=>a+b,0)/values.length,variance=values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length;return{mean,variance,sd:Math.sqrt(variance)}}
function selectionSummary(creatures:Creature[]):SelectionSummary{return Object.fromEntries(traitKeys.map(key=>[key,summarizeValues(creatures.map(c=>c[key]))])) as SelectionSummary}
export function buildInheritanceSummary(pairs:readonly {parent:Pick<Creature,BiologicalTrait>;offspring:Pick<Creature,BiologicalTrait>}[]):InheritanceSummary{
  const traits=Object.fromEntries(traitKeys.map(trait=>{
    const parentValues=pairs.map(pair=>pair.parent[trait]),offspringValues=pairs.map(pair=>pair.offspring[trait])
    return[trait,{parentMean:summarizeValues(parentValues).mean,offspringMean:summarizeValues(offspringValues).mean,changedCount:pairs.reduce((count,pair)=>count+(pair.parent[trait]===pair.offspring[trait]?0:1),0)}]
  })) as Record<BiologicalTrait,InheritanceSummary['traits'][BiologicalTrait]>
  return{offspringCount:pairs.length,changedTraitValues:traitKeys.reduce((sum,trait)=>sum+traits[trait].changedCount,0),traits}
}
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
  const world={config:{...config},generation:1,dayTime:0,tickIndex:0,creatures:[],food:[],history:[],ledger:[],events:[],activity:[],individualActivity:[],individualActivityDropped:0,activityDropped:0,activitySequence:0,environment:null as never,rngState:(config.seed||1)>>>0,nextId:1,nextIndividualId:1,nextLineageId:1,inspectedIndividualId:null,lastInspectedOutcome:null,dayHunted:0,dayFoodProduced:0,dayFoodRemoved:0,dayFoodConsumed:0,dayPreyConsumed:0,dayAttackAttempts:0,dayAttackSuccesses:0,dayAttackFailures:0,dayAttackContested:0,generationFoodStart:0,lastReport:{survived:config.initialPopulation,born:0,starved:0,hunted:0,energy:0,unfed:0,late:0,aged:0,capped:0}} as World
  world.environment=createEnvironment(world,config)
  world.creatures=Array.from({length:config.initialPopulation},()=>makeCreature(world,{},undefined,true))
  world.food=spawnFood(world,Math.round(world.environment.foodBudget));enforceAdvancedPatchCapacity(world);syncPatchStocks(world);world.generationFoodStart=world.food.length;world.history=[averages(world.creatures,0)]
  return world
}

export function setInspectedIndividual(world:World,individualId:number|null){
  world.lastInspectedOutcome=null
  world.inspectedIndividualId=individualId
  for(const creature of world.creatures)if(creature.individualId!==individualId){delete creature.decisionSummary;delete creature.perceptionDiagnostics}
}

function recordInspectedOutcome(world:World,individualId:number,generation:number,cause:TerminalEndCause){
  world.lastInspectedOutcome={individualId,generation,cause} satisfies LastInspectedOutcome
}

export function formatLatestWorldEvent(event:WorldEvent|null|undefined,currentGeneration:number):string{
  if(!event)return'No shocks recorded in this run yet.'
  const hasGeneration=Number.isInteger(event.generation)&&event.generation>=1,hasCurrentGeneration=Number.isInteger(currentGeneration)&&currentGeneration>=1
  const provenance=!hasGeneration||!hasCurrentGeneration?'Generation provenance unavailable':event.generation===currentGeneration?'Current generation':event.generation<currentGeneration?'Earlier generation':'Later generation'
  const generation=hasGeneration?`Generation ${event.generation}`:'Generation unavailable'
  const day=Number.isFinite(event.day)&&event.day>=0?`day ${event.day.toFixed(2)}`:'day unavailable'
  const summary=typeof event.summary==='string'&&event.summary.length>0?event.summary:'Event summary unavailable.'
  return`${provenance} · ${generation} · ${day} · ${summary}`
}

function recordEvent(world:World,kind:InterventionKind,summary:string,count:number){
  world.events??=[]
  let latestSequence=world.events.reduce((latest,event)=>{const candidate=(event as Partial<WorldEvent>|null)?.sequence;return typeof candidate==='number'&&Number.isSafeInteger(candidate)&&candidate>=1?Math.max(latest,candidate):latest},0)
  if(latestSequence===Number.MAX_SAFE_INTEGER){world.events=world.events.slice(-MAX_WORLD_EVENTS).map((event,index)=>({...event,sequence:index+1}));latestSequence=world.events.length}
  world.events.push({generation:world.generation,day:Number(world.dayTime.toFixed(2)),kind,summary,count,sequence:latestSequence+1})
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
    const summary=count?`Resource bloom added ${count} food.`:'Resource bloom was capped; no food was added.'
    recordEvent(world,kind,summary,count);recordActivity(world,'intervention',summary,count)
    return count
  }
  if(kind==='drought'){
    const count=Math.min(world.food.length,Math.ceil(world.food.length*.4))
    const removed=new Set([...world.food].sort((a,b)=>a.id-b.id).slice(-count).map(food=>food.id))
    world.food=world.food.filter(food=>!removed.has(food.id))
    world.dayFoodRemoved+=count
    for(const patch of world.environment.patches)patch.accumulator=Math.min(patch.accumulator,.25)
    syncPatchStocks(world)
    const summary=count?`Drought removed ${count} food.`:'Drought found no food to remove.'
    recordEvent(world,kind,summary,count);recordActivity(world,'intervention',summary,count)
    return count
  }
  const available=Math.max(0,MAX_POPULATION-world.creatures.filter(creature=>creature.alive).length)
  const count=Math.min(MAX_FOUNDER_MIGRATION_BATCH,available)
  const actorIds:number[]=[]
  for(let i=0;i<count;i++){const founder=makeCreature(world,{},undefined,true);world.creatures.push(founder);actorIds.push(founder.individualId)}
  const summary=count?`${count} new founder${count===1?'':'s'} migrated into the population.`:'Migration was capped; the population is full.'
  recordEvent(world,kind,summary,count);recordActivity(world,'intervention',summary,count,{actorIds})
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

/**
 * Decide which parts of a creature's decision cycle need refreshing this tick.
 *
 * Realistic perception intentionally holds both the sampled local view and the
 * resulting decision inside a reaction window. Inspected creatures are the
 * exception: their view is refreshed continuously so the inspector stays
 * useful even while their action is held. A newly inspected creature has no
 * captured summary yet, so it also needs one decision pass immediately.
 */
export function scheduleDecision(perceptionMode:Config['perceptionMode'],currentReactionWindow:number,reactionWindow:number,inspected:boolean,hasDecisionSummary:boolean){
  const shouldDecide=perceptionMode==='perfect'||currentReactionWindow!==reactionWindow||(inspected&&!hasDecisionSummary)
  return{perceive:inspected||shouldDecide,decide:shouldDecide}
}

export function tick(world:World,dt:number,boundaryConfig?:Config){
  for(const creature of world.creatures)if(creature.individualId!==world.inspectedIndividualId){delete creature.decisionSummary;delete creature.perceptionDiagnostics}
  const advanced=world.config.ecologyMode==='energy-regrowth'
  let homeArrivals:Creature[]|undefined
  for(const c of world.creatures){const wasHome=c.home;if(c.alive&&!c.home&&(advanced?(c.returning||c.mode==='returning'):c.food>=1)&&distance(c,{x:c.homeX,y:c.homeY})<.025){c.home=true;c.mode='returning';c.vx=0;c.vy=0}if(c.alive&&!wasHome&&c.home)(homeArrivals??=[]).push(c)}
  if(homeArrivals)for(const c of homeArrivals.sort((a,b)=>a.id-b.id||a.individualId-b.individualId))recordActivity(world,'reached-home',`${activityActorLabel(c.individualId)} reached home.`,1,{actorIds:activityActorIds(c.individualId),location:[c.x,c.y]})
  if(advanced)for(const c of [...world.creatures].sort((a,b)=>a.id-b.id||a.individualId-b.individualId)){
    if(!c.alive||!c.home)continue
    if(shouldLeaveHome(c,world.config,world.dayTime)){
      c.home=false;c.returning=false;c.mode='exploring';c.targetType=null;c.targetId=null;c.commitUntil=0;c.reactionWindow=-1
      c.wanderAngle=Math.atan2(.5-c.y,.5-c.x);c.wanderTurn=0
      delete c.decisionSummary;delete c.perceptionDiagnostics
    }else{
      c.energy-=restingEnergyRate(c,world.config)*dt
      if(c.energy<=0){c.alive=false;c.deathCause='energy';recordActivity(world,'energy-death',`${activityActorLabel(c.individualId)} died from energy loss.`,1,{actorIds:activityActorIds(c.individualId),location:[c.x,c.y]})}
    }
  }
  const snapshots=world.creatures.filter(c=>c.alive&&!c.home).map(c=>({...c,memory:{...c.memory}})).sort((a,b)=>a.id-b.id)
  const canonicalFood=snapshots.length?[...world.food].sort((a,b)=>a.id-b.id):[]
  const decisions=new Map<number,Decision>()
  const reactionWindows=new Map<number,number>()
  const diagnostics=new Map<number,ReturnType<typeof perceiveCanonical>['diagnostics']>()
  const reactionWindow=reactionWindowFor(world.config.reactionTime,world.tickIndex,world.dayTime)
  for(const c of snapshots){
    const inspected=c.individualId===world.inspectedIndividualId,schedule=scheduleDecision(world.config.perceptionMode,c.reactionWindow,reactionWindow,inspected,Boolean(c.decisionSummary))
    const held:Decision={id:c.id,targetX:c.targetX,targetY:c.targetY,targetId:c.targetId,targetType:c.targetType??'explore',mode:c.mode,memory:{...c.memory},commitUntil:c.commitUntil,wanderAngle:c.wanderAngle,wanderTurn:c.wanderTurn,summary:c.decisionSummary}
    reactionWindows.set(c.id,reactionWindow)
    if(!schedule.perceive){decisions.set(c.id,held);continue}
    const seen=perceiveCanonical(c,snapshots,canonicalFood,world.environment.obstacles,world.config,world.generation,world.tickIndex,world.dayTime)
    decisions.set(c.id,schedule.decide?decide(c,seen.creatures,seen.food,world.config,world.dayTime,world.tickIndex,inspected,inspected?{generation:world.generation,dayTime:world.dayTime,reactionWindow}:undefined):held)
    if(inspected)diagnostics.set(c.id,seen.diagnostics)
  }
  const motions=new Map(snapshots.map(c=>[c.id,proposeMotion(c,decisions.get(c.id)!,world.config,world.environment.obstacles,dt)]))
  const byId=new Map(world.creatures.map(c=>[c.id,c]))
  for(const s of snapshots){const c=byId.get(s.id)!,d=decisions.get(s.id)!,m=motions.get(s.id)!
    const wasAlive=c.alive,wasHome=c.home
    Object.assign(c,{x:m.x,y:m.y,vx:m.vx,vy:m.vy,angle:m.angle,energy:m.energy,home:m.home||c.home,alive:m.energy>0,
      mode:m.home?'returning':d.mode,returning:advanced?d.mode==='returning':c.returning||d.mode==='returning',memory:d.memory,targetType:d.targetType,targetId:d.targetId,targetX:d.targetX,targetY:d.targetY,commitUntil:d.commitUntil,wanderAngle:d.wanderAngle,wanderTurn:d.wanderTurn,reactionWindow:reactionWindows.get(c.id)!,decisionSummary:d.summary,perceptionDiagnostics:diagnostics.get(c.id)})
    if(m.energy<=0){c.deathCause='energy';if(wasAlive&&c.alive===false)recordActivity(world,'energy-death',`${activityActorLabel(c.individualId)} died from energy loss.`,1,{actorIds:activityActorIds(c.individualId),location:[c.x,c.y]})}
    if(c.alive&&!wasHome&&c.home)recordActivity(world,'reached-home',`${activityActorLabel(c.individualId)} reached home.`,1,{actorIds:activityActorIds(c.individualId),location:[c.x,c.y]})
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
  for(const q of foodWins){const actor=byId.get(q.actor),food=foodById.get(q.resource);if(actor&&food&&(advanced||actor.food<2)){const reward=advanced?safeFoodEnergy(food,world.config):22;actor.food++;actor.energy+=reward;eatenFood.add(q.resource);world.dayFoodConsumed++;recordActivity(world,'food-collected',advanced?`${activityActorLabel(actor.individualId)} collected ${reward.toFixed(1)}-energy food.`:`${activityActorLabel(actor.individualId)} collected food.`,1,{actorIds:activityActorIds(actor.individualId),location:[food.x,food.y]});if(advanced&&food.patchId!==null)world.environment.patches=consumeResourceStock({patches:world.environment.patches},food.patchId).patches}}
  world.food=world.food.filter(f=>!eatenFood.has(f.id))
  const attackClaims=collectAttackClaims(attackers,preyTargets,world.config),resolution=resolveAttackClaims(attackClaims,world.config,{seed:world.config.seed,generation:world.generation,tick:world.tickIndex})
  for(const outcome of resolution.admitted){const attacker=activityActorLabel(outcome.attacker.individualId),prey=activityActorLabel(outcome.prey.individualId),chance=safeActivityChance(outcome.probability),chanceText=world.config.predationMode==='contest'&&chance!==null?` (contest chance ${formatActivityPercent(chance)}%)`:'';recordActivity(world,outcome.success?'attack-success':'attack-failure',`${outcome.success?`${attacker} caught ${prey}`:`${attacker}'s attack on ${prey} failed`}${chanceText}.`,1,{actorIds:activityActorIds(outcome.attacker.individualId,outcome.prey.individualId),attackerId:outcome.attacker.individualId,preyId:outcome.prey.individualId,contestChance:world.config.predationMode==='contest'?outcome.probability:undefined,location:[(outcome.attacker.x+outcome.prey.x)/2,(outcome.attacker.y+outcome.prey.y)/2]})}
  world.dayAttackAttempts+=world.config.predationMode==='threshold'?attackClaims.length:resolution.admitted.length;world.dayAttackSuccesses+=resolution.successes.length;world.dayAttackFailures+=resolution.failures.length;world.dayAttackContested+=resolution.rejected.filter(item=>item.reason==='prey-contested').length
  const attackEnergyDeaths:Creature[]=[]
  for(const delta of resolution.energyDeltas){const actor=byId.get(delta.id);if(actor){const wasAlive=actor.alive;actor.energy+=delta.delta;if(actor.energy<=0){actor.alive=false;actor.deathCause='energy';if(wasAlive)attackEnergyDeaths.push(actor)}}}
  for(const cooldown of resolution.cooldowns){const actor=byId.get(cooldown.id);if(actor)actor.attackCooldownUntil=world.dayTime+cooldown.duration}
  for(const outcome of resolution.successes){const actor=byId.get(outcome.attacker.id);if(actor)actor.food++}
  const killed=new Set(resolution.killedPreyIds);world.dayPreyConsumed+=resolution.successes.length
  for(const id of killed){const prey=byId.get(id);if(prey&&!prey.home){prey.alive=false;prey.deathCause='hunted'}}
  for(const actor of attackEnergyDeaths.sort((a,b)=>a.id-b.id||a.individualId-b.individualId))if(actor.deathCause==='energy')recordActivity(world,'energy-death',`${activityActorLabel(actor.individualId)} died from energy loss.`,1,{actorIds:activityActorIds(actor.individualId),location:[actor.x,actor.y]})
  world.dayHunted+=killed.size
  if(advanced){const step=advanceResourceDynamics({patches:world.environment.patches},{ecologyMode:'energy-regrowth',patchCapacity:world.config.patchCapacity,foodRegrowthRate:effectiveFoodRegrowthRate(world.environment,world.config),foodPatchSpread:world.config.foodPatchSpread,maxFood:180,patchQualityVariation:world.config.patchQualityVariation},{seed:world.config.seed,generation:world.generation,dt,generationDuration:world.config.dayLength,currentFoodCount:world.food.length});world.environment.patches=step.state.patches;const produced=spawnRegrownFood(world,step.placements);world.food.push(...produced);world.dayFoodProduced+=produced.length;if(produced.length)recordActivity(world,'natural-regrowth',`Natural regrowth added ${produced.length} food.`,produced.length)}
  if(world.inspectedIndividualId!==null){
    const inspectedIndividualId=world.inspectedIndividualId,inspected=world.creatures.find(creature=>creature.individualId===inspectedIndividualId)
    if(!inspected?.alive){
      const cause=inspected?.deathCause
      setInspectedIndividual(world,null)
      if(cause)recordInspectedOutcome(world,inspectedIndividualId,world.generation,cause)
    }
  }
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

export function finishGeneration(world:World,boundaryConfig:Config=world.config){const start=[...world.creatures].sort((a,b)=>a.individualId-b.individualId),settlement=settleLifecycle(start,world.config,{seed:world.config.seed,generation:world.generation,maxPopulation:MAX_POPULATION}),survivors=settlement.survivors.map(item=>item.individual),birthParents=settlement.admittedParents,outcomes=settlement.outcomeCounts,selectionByOutcome=Object.fromEntries(END_CAUSES.map(cause=>[cause,selectionSummary(settlement.outcomes.filter(outcome=>outcome.cause===cause).map(outcome=>outcome.individual))])) as Record<typeof END_CAUSES[number],SelectionSummary>
  if(world.inspectedIndividualId!==null){
    const inspectedIndividualId=world.inspectedIndividualId,inspectedOutcome=settlement.outcomes.find(outcome=>outcome.individual.individualId===inspectedIndividualId)
    if(inspectedOutcome&&inspectedOutcome.cause!=='survived'){
      setInspectedIndividual(world,null)
      recordInspectedOutcome(world,inspectedIndividualId,world.generation,inspectedOutcome.cause)
    }
  }
  const next:Creature[]=settlement.survivors.map(({individual:c,nextAge,settledEnergy})=>makeCreature(world,{speed:c.speed,size:c.size,sense:c.sense,aggression:c.aggression,caution:c.caution,exploration:c.exploration,age:nextAge,energy:settledEnergy},{individualId:c.individualId,lineageId:c.lineageId,parentIndividualId:c.parentIndividualId,birthGeneration:c.birthGeneration}))
  const newbornPairs:{parent:Creature;offspring:Creature}[]=[]
  for(const {parent:c,energy} of settlement.births){const offspring=makeCreature(world,{speed:mutate(world,c.speed,'speed'),size:mutate(world,c.size,'size'),sense:mutate(world,c.sense,'sense'),aggression:mutate(world,c.aggression,'aggression'),caution:mutate(world,c.caution,'caution'),exploration:mutate(world,c.exploration,'exploration'),age:0,energy},{lineageId:c.lineageId,parentIndividualId:c.individualId,birthGeneration:world.generation+1});next.push(offspring);newbornPairs.push({parent:c,offspring})}
  const inheritance=buildInheritanceSummary(newbornPairs)
  const ledger:GenerationLedger={generation:world.generation,startPopulation:start.length,outcomes,foodAtStart:world.generationFoodStart,foodProduced:world.dayFoodProduced,foodRemoved:world.dayFoodRemoved,foodConsumed:world.dayFoodConsumed,foodRemaining:world.food.length,preyConsumed:world.dayPreyConsumed,attackAttempts:world.dayAttackAttempts,attackSuccesses:world.dayAttackSuccesses,attackFailures:world.dayAttackFailures,attackContested:world.dayAttackContested,attackAttemptBasis:world.config.predationMode==='threshold'?'claims':'admitted',birthsEligible:settlement.eligibleParents.length,birthsAdmitted:birthParents.length,birthsCapped:settlement.birthsCapped,...(world.config.ecologyMode==='energy-regrowth'?{birthsImmature:settlement.immatureParents.length}:{}),selection:{start:selectionSummary(start),survivor:selectionSummary(survivors),reproducer:selectionSummary(birthParents)},selectionByOutcome,inheritance}
  world.ledger.push(ledger);if(world.ledger.length>MAX_HISTORY_POINTS)world.ledger=world.ledger.slice(-MAX_HISTORY_POINTS)
  world.lastReport={survived:outcomes.survived,born:birthParents.length,starved:outcomes.energy+outcomes.unfed+outcomes.late,hunted:outcomes.hunted,energy:outcomes.energy,unfed:outcomes.unfed,late:outcomes.late,aged:outcomes.aged,capped:ledger.birthsCapped}
  const maturityNote=world.config.ecologyMode==='energy-regrowth'&&settlement.immatureParents.length?` ${activityCountLabel(settlement.immatureParents.length,'energy-ready survivor')} waited for maturity.`:''
  recordActivity(world,'generation-settlement',`Generation ${world.generation} settled: ${activityCountLabel(outcomes.survived,'survivor')} + ${activityCountLabel(birthParents.length,'admitted birth')} → generation ${world.generation+1} starts with ${activityCountLabel(next.length,'creature')}.${maturityNote}`,next.length)
  world.generation++;world.dayTime=0;world.tickIndex=0;world.creatures=next;if(world.inspectedIndividualId!==null&&!next.some(c=>c.individualId===world.inspectedIndividualId))world.inspectedIndividualId=null
  const nextFoodBudget=advanceFoodBudget(world.environment,boundaryConfig,world.generation);if(boundaryConfig.ecologyMode==='classic'){world.food=spawnFood(world,nextFoodBudget,boundaryConfig);syncPatchStocks(world)}world.generationFoodStart=world.food.length;world.history.push(averages(world.creatures,world.generation-1));if(world.history.length>MAX_HISTORY_POINTS)world.history=world.history.slice(-MAX_HISTORY_POINTS)
  world.dayHunted=0;world.dayFoodProduced=0;world.dayFoodRemoved=0;world.dayFoodConsumed=0;world.dayPreyConsumed=0;world.dayAttackAttempts=0;world.dayAttackSuccesses=0;world.dayAttackFailures=0;world.dayAttackContested=0
}
export function runGeneration(world:World,boundaryConfig?:Config){const target=world.generation;let guard=0;while(world.generation===target&&guard++<10000)tick(world,SIMULATION_TIMESTEP,boundaryConfig)}
export function getStats(world:World){const p=averages(world.creatures.filter(c=>c.alive),world.generation);return{...p,avgSpeed:p.avgSpeed??0,avgSize:p.avgSize??0,avgSense:p.avgSense??0,avgAggression:p.avgAggression??0,avgCaution:p.avgCaution??0,avgExploration:p.avgExploration??0,avgEnergy:p.avgEnergy??0,avgAge:p.avgAge??0}}
export function getModeCounts(world:World){const counts={exploring:0,foraging:0,hunting:0,fleeing:0,returning:0};for(const c of world.creatures)if(c.alive&&!c.home)counts[c.mode]++;return counts}
