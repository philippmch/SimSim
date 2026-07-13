import type { BiologicalTrait,Config,Creature,EndCause,GenerationLedger,HistoryPoint,SelectionSummary,Trait,World } from './types'
import { clamp,distance,random } from './random'
import { advanceFoodBudget,createEnvironment,spawnFood } from './environment'
import { decide } from './behavior'
import { proposeMotion } from './motion'
import {defaultConfig,MAX_HISTORY_POINTS,MAX_POPULATION,sanitizeConfig} from './config'

export {defaultConfig} from './config'
export const SIMULATION_TIMESTEP=.025

function edgePoint(world:World){const edge=Math.floor(random(world)*4),p=.04+random(world)*.92
  return edge===0?{x:p,y:.025}:edge===1?{x:.975,y:p}:edge===2?{x:p,y:.975}:{x:.025,y:p}}
const emptyMemory=()=>({foodX:null,foodY:null,foodUntil:0,threatX:null,threatY:null,threatUntil:0})
const traitKeys:BiologicalTrait[]=['speed','size','sense','aggression','caution','exploration']
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
    energy:world.config.startingEnergy,food:0,alive:true,returning:false,home:false,age:traits.age??0,parentId:identity?.parentIndividualId??undefined,
    mode:'exploring',memory:emptyMemory(),targetType:null,targetId:null,targetX:.5,targetY:.5,commitUntil:0,wanderAngle:angle,wanderTurn:0,deathCause:null}
}
function averages(creatures:Creature[],generation:number):HistoryPoint{const n=creatures.length,m=(key:BiologicalTrait)=>summarizeValues(creatures.map(c=>c[key]))
  const speed=m('speed'),size=m('size'),sense=m('sense'),aggression=m('aggression'),caution=m('caution'),exploration=m('exploration')
  return{generation,population:n,avgSpeed:speed.mean,avgSize:size.mean,avgSense:sense.mean,avgAggression:aggression.mean,avgCaution:caution.mean,avgExploration:exploration.mean,sdSpeed:speed.sd,sdSize:size.sd,sdSense:sense.sd,sdAggression:aggression.sd,sdCaution:caution.sd,sdExploration:exploration.sd}}

export function createWorld(config:Config=defaultConfig):World{
  config=sanitizeConfig(config)
  const world={config:{...config},generation:1,dayTime:0,tickIndex:0,creatures:[],food:[],history:[],ledger:[],environment:null as never,rngState:(config.seed||1)>>>0,nextId:1,nextIndividualId:1,nextLineageId:1,inspectedIndividualId:null,dayHunted:0,dayFoodConsumed:0,dayPreyConsumed:0,dayAttackAttempts:0,generationFoodStart:0,lastReport:{survived:config.initialPopulation,born:0,starved:0,hunted:0,energy:0,unfed:0,late:0,capped:0}} as World
  world.environment=createEnvironment(world,config)
  world.creatures=Array.from({length:config.initialPopulation},()=>makeCreature(world,{},undefined,true))
  world.food=spawnFood(world,Math.round(world.environment.foodBudget));world.generationFoodStart=world.food.length;world.history=[averages(world.creatures,0)]
  return world
}

export function setInspectedIndividual(world:World,individualId:number|null){
  world.inspectedIndividualId=individualId
  for(const creature of world.creatures)if(creature.individualId!==individualId)delete creature.decisionSummary
}

export function tick(world:World,dt:number){
  for(const creature of world.creatures)if(creature.individualId!==world.inspectedIndividualId)delete creature.decisionSummary
  for(const c of world.creatures)if(c.alive&&!c.home&&c.food>=1&&distance(c,{x:c.homeX,y:c.homeY})<.025){c.home=true;c.mode='returning';c.vx=0;c.vy=0}
  const snapshots=world.creatures.filter(c=>c.alive&&!c.home).map(c=>({...c,memory:{...c.memory}})).sort((a,b)=>a.id-b.id)
  const decisions=new Map(snapshots.map(c=>[c.id,decide(c,snapshots,world.food,world.config,world.dayTime,world.tickIndex,c.individualId===world.inspectedIndividualId)]))
  const motions=new Map(snapshots.map(c=>[c.id,proposeMotion(c,decisions.get(c.id)!,world.config,world.environment.obstacles,dt)]))
  const byId=new Map(world.creatures.map(c=>[c.id,c]))
  for(const s of snapshots){const c=byId.get(s.id)!,d=decisions.get(s.id)!,m=motions.get(s.id)!
    Object.assign(c,{x:m.x,y:m.y,vx:m.vx,vy:m.vy,angle:m.angle,energy:m.energy,home:m.home||c.home,alive:m.energy>0,
      mode:m.home?'returning':d.mode,returning:c.returning||d.mode==='returning',memory:d.memory,targetType:d.targetType,targetId:d.targetId,targetX:d.targetX,targetY:d.targetY,commitUntil:d.commitUntil,wanderAngle:d.wanderAngle,wanderTurn:d.wanderTurn,decisionSummary:d.summary})
    if(m.energy<=0)c.deathCause='energy'
  }
  const claimants=snapshots.map(s=>byId.get(s.id)!).filter(c=>c.alive&&!c.home&&c.food<2)
  const preyTargets=snapshots.map(s=>byId.get(s.id)!).filter(c=>c.alive&&!c.home)
  const foodClaims:{actor:number;resource:number;d:number}[]=[],preyClaims:{actor:number;resource:number;d:number}[]=[]
  for(const c of claimants){
    if(c.mode==='hunting'){
      let best:Creature|undefined,bestD=Infinity
      for(const p of preyTargets){const d=distance(c,p);if(p.id!==c.id&&c.size>=p.size*world.config.predatorRatio&&d<.014+.012*c.size&&(d<bestD||(d===bestD&&p.id<(best?.id??Infinity)))){best=p;bestD=d}}
      if(best){preyClaims.push({actor:c.id,resource:best.id,d:bestD});world.dayAttackAttempts++}
    }else{
      let best=world.food[0],bestD=best?distance(c,best):Infinity
      for(const f of world.food){const d=distance(c,f);if(d<bestD||(d===bestD&&f.id<(best?.id??Infinity))){best=f;bestD=d}}
      if(best&&bestD<.016+.009*c.size)foodClaims.push({actor:c.id,resource:best.id,d:bestD})
    }
  }
  const winners=<T extends {actor:number;resource:number;d:number}>(claims:T[])=>{const won=new Map<number,T>();for(const q of claims.sort((a,b)=>a.resource-b.resource||a.d-b.d||a.actor-b.actor))if(!won.has(q.resource))won.set(q.resource,q);return[...won.values()]}
  const foodWins=winners(foodClaims),preyWins=winners(preyClaims)
  const eatenFood=new Set<number>()
  for(const q of foodWins){const actor=byId.get(q.actor);if(actor&&actor.food<2){actor.food++;actor.energy+=22;eatenFood.add(q.resource);world.dayFoodConsumed++}}
  world.food=world.food.filter(f=>!eatenFood.has(f.id))
  const killed=new Set<number>()
  for(const q of preyWins){const actor=byId.get(q.actor);if(actor&&actor.food<2){actor.food++;actor.energy+=30;killed.add(q.resource);world.dayPreyConsumed++}}
  for(const id of killed){const prey=byId.get(id);if(prey&&!prey.home){prey.alive=false;prey.deathCause='hunted'}}
  world.dayHunted+=killed.size;world.dayTime+=dt;world.tickIndex++
  if(world.dayTime>=world.config.dayLength){finishGeneration(world);return true}return false
}

function mutate(world:World,value:number,trait:Trait){const c=world.config
  const enabled=trait==='speed'?c.mutateSpeed:trait==='size'?c.mutateSize:trait==='sense'?c.mutateSense:trait==='aggression'?c.mutateAggression:trait==='caution'?c.mutateCaution:c.mutateExploration
  if(!enabled||random(world)>c.mutationRate)return value
  const variation=(random(world)+random(world)+random(world)+random(world)-2)*c.mutationStrength
  const behavioral=trait==='aggression'||trait==='caution'||trait==='exploration'
  const result=behavioral?value+variation:value*(1+variation)
  return clamp(result,trait==='sense'?.035:trait==='speed'||trait==='size'?.3:0,trait==='sense'?.6:trait==='speed'||trait==='size'?2.8:1)}

export function finishGeneration(world:World){const start=[...world.creatures].sort((a,b)=>a.individualId-b.individualId),survivors=start.filter(c=>c.alive&&c.home&&c.food>=1),eligible=survivors.filter(c=>c.food>=2)
  const outcomes={survived:0,hunted:0,energy:0,unfed:0,late:0};for(const c of start){const cause:EndCause=c.alive&&c.home&&c.food>=1?'survived':c.deathCause==='hunted'?'hunted':c.deathCause==='energy'?'energy':c.food===0?'unfed':'late';outcomes[cause]++}
  const next:Creature[]=survivors.map(c=>makeCreature(world,{speed:c.speed,size:c.size,sense:c.sense,aggression:c.aggression,caution:c.caution,exploration:c.exploration,age:c.age+1},{individualId:c.individualId,lineageId:c.lineageId,parentIndividualId:c.parentIndividualId,birthGeneration:c.birthGeneration}))
  const available=Math.max(0,MAX_POPULATION-next.length),birthParents=eligible.slice(0,available)
  for(const c of birthParents){next.push(makeCreature(world,{speed:mutate(world,c.speed,'speed'),size:mutate(world,c.size,'size'),sense:mutate(world,c.sense,'sense'),aggression:mutate(world,c.aggression,'aggression'),caution:mutate(world,c.caution,'caution'),exploration:mutate(world,c.exploration,'exploration'),age:0},{lineageId:c.lineageId,parentIndividualId:c.individualId,birthGeneration:world.generation+1}))}
  const ledger:GenerationLedger={generation:world.generation,startPopulation:start.length,outcomes,foodAtStart:world.generationFoodStart,foodConsumed:world.dayFoodConsumed,foodRemaining:world.food.length,preyConsumed:world.dayPreyConsumed,attackAttempts:world.dayAttackAttempts,birthsEligible:eligible.length,birthsAdmitted:birthParents.length,birthsCapped:eligible.length-birthParents.length,selection:{start:selectionSummary(start),survivor:selectionSummary(survivors),reproducer:selectionSummary(birthParents)}}
  world.ledger.push(ledger);if(world.ledger.length>MAX_HISTORY_POINTS)world.ledger=world.ledger.slice(-MAX_HISTORY_POINTS)
  world.lastReport={survived:outcomes.survived,born:birthParents.length,starved:outcomes.energy+outcomes.unfed+outcomes.late,hunted:outcomes.hunted,energy:outcomes.energy,unfed:outcomes.unfed,late:outcomes.late,capped:ledger.birthsCapped}
  world.generation++;world.dayTime=0;world.tickIndex=0;world.creatures=next;if(world.inspectedIndividualId!==null&&!next.some(c=>c.individualId===world.inspectedIndividualId))world.inspectedIndividualId=null
  world.food=spawnFood(world,advanceFoodBudget(world.environment,world.config,world.generation));world.generationFoodStart=world.food.length;world.history.push(averages(world.creatures,world.generation-1));if(world.history.length>MAX_HISTORY_POINTS)world.history=world.history.slice(-MAX_HISTORY_POINTS)
  world.dayHunted=0;world.dayFoodConsumed=0;world.dayPreyConsumed=0;world.dayAttackAttempts=0
}
export function runGeneration(world:World){const target=world.generation;let guard=0;while(world.generation===target&&guard++<10000)tick(world,SIMULATION_TIMESTEP)}
export function getStats(world:World){const p=averages(world.creatures.filter(c=>c.alive),world.generation);return{...p,avgSpeed:p.avgSpeed??0,avgSize:p.avgSize??0,avgSense:p.avgSense??0,avgAggression:p.avgAggression??0,avgCaution:p.avgCaution??0,avgExploration:p.avgExploration??0}}
export function getModeCounts(world:World){const counts={exploring:0,foraging:0,hunting:0,fleeing:0,returning:0};for(const c of world.creatures)if(c.alive&&!c.home)counts[c.mode]++;return counts}
