import type { Config,Creature,HistoryPoint,Trait,World } from './types'
import { clamp,distance,random } from './random'
import { advanceFoodBudget,createEnvironment,spawnFood } from './environment'
import { decide } from './behavior'
import { proposeMotion } from './motion'

export const defaultConfig:Config={
  seed:2187,initialPopulation:42,foodPerDay:42,startSpeed:1,startSize:1,startSense:.18,startingEnergy:110,
  startAggression:.42,startCaution:.58,startExploration:.55,
  mutationRate:.05,mutationStrength:.1,mutateSpeed:true,mutateSize:true,mutateSense:true,
  mutateAggression:true,mutateCaution:true,mutateExploration:true,
  predatorRatio:1.2,moveEnergyFactor:.7,senseEnergyFactor:.32,dayLength:18,
  acceleration:.11,turnRate:4,memoryDuration:2.8,commitmentDuration:.8,
  foodPatchCount:4,foodPatchiness:.72,foodPatchSpread:.12,obstacleCount:4,
  seasonAmplitude:.22,seasonLength:8,environmentResponse:.45,foodTrend:0,
}
export const SIMULATION_TIMESTEP=.025

function edgePoint(world:World){const edge=Math.floor(random(world)*4),p=.04+random(world)*.92
  return edge===0?{x:p,y:.025}:edge===1?{x:.975,y:p}:edge===2?{x:p,y:.975}:{x:.025,y:p}}
const emptyMemory=()=>({foodX:null,foodY:null,foodUntil:0,threatX:null,threatY:null,threatUntil:0})
function makeCreature(world:World,traits:Partial<Creature>={},parentId?:number):Creature{
  const home=edgePoint(world),angle=Math.atan2(.5-home.y,.5-home.x)+(random(world)-.5)
  return{id:world.nextId++,x:home.x,y:home.y,homeX:home.x,homeY:home.y,angle,vx:0,vy:0,
    speed:traits.speed??world.config.startSpeed,size:traits.size??world.config.startSize,sense:traits.sense??world.config.startSense,
    aggression:traits.aggression??world.config.startAggression,caution:traits.caution??world.config.startCaution,exploration:traits.exploration??world.config.startExploration,
    energy:world.config.startingEnergy,food:0,alive:true,returning:false,home:false,age:traits.age??0,parentId,
    mode:'exploring',memory:emptyMemory(),targetType:null,targetId:null,targetX:.5,targetY:.5,commitUntil:0,wanderAngle:angle,wanderTurn:0}
}
function averages(creatures:Creature[],generation:number):HistoryPoint{const n=creatures.length,sum=(key:keyof Creature)=>n?creatures.reduce((s,c)=>s+(c[key] as number),0)/n:null
  return{generation,population:n,avgSpeed:sum('speed'),avgSize:sum('size'),avgSense:sum('sense'),avgAggression:sum('aggression'),avgCaution:sum('caution'),avgExploration:sum('exploration')}}

export function createWorld(config:Config=defaultConfig):World{
  const world={config:{...config},generation:1,dayTime:0,tickIndex:0,creatures:[],food:[],history:[],environment:null as never,rngState:(config.seed||1)>>>0,nextId:1,dayHunted:0,lastReport:{survived:config.initialPopulation,born:0,starved:0,hunted:0}} as World
  world.environment=createEnvironment(world,config)
  world.creatures=Array.from({length:config.initialPopulation},()=>makeCreature(world))
  world.food=spawnFood(world,Math.round(world.environment.foodBudget));world.history=[averages(world.creatures,0)]
  return world
}

export function tick(world:World,dt:number){
  for(const c of world.creatures)if(c.alive&&!c.home&&c.food>=1&&distance(c,{x:c.homeX,y:c.homeY})<.025){c.home=true;c.mode='returning';c.vx=0;c.vy=0}
  const snapshots=world.creatures.filter(c=>c.alive&&!c.home).map(c=>({...c,memory:{...c.memory}})).sort((a,b)=>a.id-b.id)
  const decisions=new Map(snapshots.map(c=>[c.id,decide(c,snapshots,world.food,world.config,world.dayTime,world.tickIndex)]))
  const motions=new Map(snapshots.map(c=>[c.id,proposeMotion(c,decisions.get(c.id)!,world.config,world.environment.obstacles,dt)]))
  const byId=new Map(world.creatures.map(c=>[c.id,c]))
  for(const s of snapshots){const c=byId.get(s.id)!,d=decisions.get(s.id)!,m=motions.get(s.id)!
    Object.assign(c,{x:m.x,y:m.y,vx:m.vx,vy:m.vy,angle:m.angle,energy:m.energy,home:m.home||c.home,alive:m.energy>0,
      mode:m.home?'returning':d.mode,returning:c.returning||d.mode==='returning',memory:d.memory,targetType:d.targetType,targetId:d.targetId,targetX:d.targetX,targetY:d.targetY,commitUntil:d.commitUntil,wanderAngle:d.wanderAngle,wanderTurn:d.wanderTurn})
  }
  const claimants=snapshots.map(s=>byId.get(s.id)!).filter(c=>c.alive&&!c.home&&c.food<2)
  const preyTargets=snapshots.map(s=>byId.get(s.id)!).filter(c=>c.alive&&!c.home)
  const foodClaims:{actor:number;resource:number;d:number}[]=[],preyClaims:{actor:number;resource:number;d:number}[]=[]
  for(const c of claimants){
    if(c.mode==='hunting'){
      let best:Creature|undefined,bestD=Infinity
      for(const p of preyTargets){const d=distance(c,p);if(p.id!==c.id&&c.size>=p.size*world.config.predatorRatio&&d<.014+.012*c.size&&(d<bestD||(d===bestD&&p.id<(best?.id??Infinity)))){best=p;bestD=d}}
      if(best)preyClaims.push({actor:c.id,resource:best.id,d:bestD})
    }else{
      let best=world.food[0],bestD=best?distance(c,best):Infinity
      for(const f of world.food){const d=distance(c,f);if(d<bestD||(d===bestD&&f.id<(best?.id??Infinity))){best=f;bestD=d}}
      if(best&&bestD<.016+.009*c.size)foodClaims.push({actor:c.id,resource:best.id,d:bestD})
    }
  }
  const winners=<T extends {actor:number;resource:number;d:number}>(claims:T[])=>{const won=new Map<number,T>();for(const q of claims.sort((a,b)=>a.resource-b.resource||a.d-b.d||a.actor-b.actor))if(!won.has(q.resource))won.set(q.resource,q);return[...won.values()]}
  const foodWins=winners(foodClaims),preyWins=winners(preyClaims)
  const eatenFood=new Set<number>()
  for(const q of foodWins){const actor=byId.get(q.actor);if(actor&&actor.food<2){actor.food++;actor.energy+=22;eatenFood.add(q.resource)}}
  world.food=world.food.filter(f=>!eatenFood.has(f.id))
  const killed=new Set<number>()
  for(const q of preyWins){const actor=byId.get(q.actor);if(actor&&actor.food<2){actor.food++;actor.energy+=30;killed.add(q.resource)}}
  for(const id of killed){const prey=byId.get(id);if(prey&&!prey.home)prey.alive=false}
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

export function finishGeneration(world:World){const before=world.creatures.length,survivors=world.creatures.filter(c=>c.alive&&c.home&&c.food>=1).sort((a,b)=>a.id-b.id),next:Creature[]=[];let born=0
  for(const c of survivors){const genes={speed:c.speed,size:c.size,sense:c.sense,aggression:c.aggression,caution:c.caution,exploration:c.exploration,age:c.age+1};next.push(makeCreature(world,genes,c.parentId));if(c.food>=2){next.push(makeCreature(world,{...genes,age:0,speed:mutate(world,c.speed,'speed'),size:mutate(world,c.size,'size'),sense:mutate(world,c.sense,'sense'),aggression:mutate(world,c.aggression,'aggression'),caution:mutate(world,c.caution,'caution'),exploration:mutate(world,c.exploration,'exploration')},c.id));born++}}
  world.lastReport={survived:survivors.length,born,starved:Math.max(0,before-survivors.length-world.dayHunted),hunted:world.dayHunted}
  world.generation++;world.dayTime=0;world.tickIndex=0;world.creatures=next;world.food=spawnFood(world,advanceFoodBudget(world.environment,world.config,world.generation));world.history.push(averages(next,world.generation-1));world.dayHunted=0
}
export function runGeneration(world:World){const target=world.generation;let guard=0;while(world.generation===target&&guard++<10000)tick(world,SIMULATION_TIMESTEP)}
export function getStats(world:World){const p=averages(world.creatures.filter(c=>c.alive),world.generation);return{...p,avgSpeed:p.avgSpeed??0,avgSize:p.avgSize??0,avgSense:p.avgSense??0,avgAggression:p.avgAggression??0,avgCaution:p.avgCaution??0,avgExploration:p.avgExploration??0}}
export function getModeCounts(world:World){const counts={exploring:0,foraging:0,hunting:0,fleeing:0,returning:0};for(const c of world.creatures)if(c.alive&&!c.home)counts[c.mode]++;return counts}
