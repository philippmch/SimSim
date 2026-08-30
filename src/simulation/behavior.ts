import type { Config,Creature,DecisionSummary,Food,Memory,Mode,TargetType } from './types'
import { clamp,distance,keyedNoise } from './random'
import {contestSuccessProbability} from './predation'

export interface Decision {id:number;targetX:number;targetY:number;targetId:number|null;targetType:TargetType;mode:Mode;memory:Memory;commitUntil:number;wanderAngle:number;wanderTurn:number;summary?:DecisionSummary}
type Candidate={type:TargetType;mode:Mode;x:number;y:number;id:number|null;score:number;urgent?:boolean}

export function decide(c:Creature,active:readonly Creature[],food:readonly Food[],cfg:Config,time:number,tick:number,capture=false):Decision{
  let nearestFood:Food|undefined,foodD=Infinity,nearestPrey:Creature|undefined,preyD=Infinity,nearestThreat:Creature|undefined,threatD=Infinity
  for(const f of food){const d=distance(c,f);if(d<=c.sense&&(d<foodD||(d===foodD&&f.id<(nearestFood?.id??Infinity)))){nearestFood=f;foodD=d}}
  for(const o of active){if(o.id===c.id)continue;const d=distance(c,o);if(d>c.sense)continue
    if(o.size>=c.size*cfg.predatorRatio&&(d<threatD||(d===threatD&&o.id<(nearestThreat?.id??Infinity)))){nearestThreat=o;threatD=d}
    if(c.size>=o.size*cfg.predatorRatio&&(d<preyD||(d===preyD&&o.id<(nearestPrey?.id??Infinity)))){nearestPrey=o;preyD=d}
  }
  const memory={...c.memory}
  if(nearestFood){memory.foodX=nearestFood.x;memory.foodY=nearestFood.y;memory.foodUntil=time+cfg.memoryDuration}
  else if(time>=memory.foodUntil||(memory.foodX!==null&&distance(c,{x:memory.foodX,y:memory.foodY!})<.025)){memory.foodX=null;memory.foodY=null}
  if(nearestThreat){memory.threatX=nearestThreat.x;memory.threatY=nearestThreat.y;memory.threatUntil=time+cfg.memoryDuration*.65}
  else if(time>=memory.threatUntil){memory.threatX=null;memory.threatY=null}

  const cost=.12+cfg.senseEnergyFactor*c.sense*8+cfg.moveEnergyFactor*c.size**3*c.speed**2
  const homeD=distance(c,{x:c.homeX,y:c.homeY}),homeTime=homeD/Math.max(.001,.038*c.speed),timeLeft=cfg.dayLength-time
  const unsafe=c.food===1&&(timeLeft<=homeTime*1.2+.5||c.energy<=cost*homeTime*1.25+2)
  const advanced=cfg.ecologyMode==='energy-regrowth',advancedUnsafe=timeLeft<=homeTime*1.2+.5||c.energy<=cost*homeTime*1.25+5
  const reproductiveReserve=cfg.startingEnergy+cfg.reproductionEnergyCost/Math.max(.05,cfg.energyRetention)
  const reserveReady=advanced&&c.energy>=reproductiveReserve
  const huntScore=(prey:Creature,d:number)=>{if(cfg.predationMode!=='contest')return(1+7*c.aggression)/(d+.08)-4*c.caution*(prey.size/c.size);const expected=contestSuccessProbability(c,prey,cfg)*cfg.preyEnergy-cfg.attackCost;return expected<=0?-Infinity:expected*(.4+1.6*c.aggression)/(d+.08)-4*c.caution*(prey.size/c.size)}
  const candidates:Candidate[]=[]
  if(nearestThreat){const urgent=threatD<c.sense*(.1+.5*c.caution);candidates.push({type:'threat',mode:'fleeing',id:nearestThreat.id,x:clamp(c.x+(c.x-nearestThreat.x)*3,0,1),y:clamp(c.y+(c.y-nearestThreat.y)*3,0,1),score:6+6*c.caution+(c.sense-threatD)/c.sense*4,urgent})}
  else if(memory.threatX!==null)candidates.push({type:'threat',mode:'fleeing',id:null,x:clamp(c.x+(c.x-memory.threatX)*2,0,1),y:clamp(c.y+(c.y-memory.threatY!)*2,0,1),score:2.5*c.caution})
  if(!advanced&&(c.food>=2||unsafe||c.returning))candidates.push({type:'home',mode:'returning',id:null,x:c.homeX,y:c.homeY,score:c.food>=2?100:unsafe?45+10*c.caution:12,urgent:c.food>=2||unsafe})
  if(advanced&&(advancedUnsafe||reserveReady||c.returning))candidates.push({type:'home',mode:'returning',id:null,x:c.homeX,y:c.homeY,score:reserveReady?100:advancedUnsafe?45+10*c.caution:12,urgent:reserveReady||advancedUnsafe})
  if((advanced||c.food<2)&&!c.returning){
    if(nearestFood)candidates.push({type:'food',mode:'foraging',id:nearestFood.id,x:nearestFood.x,y:nearestFood.y,score:(3.2+c.exploration+(advanced?Math.max(0,reproductiveReserve-c.energy)/Math.max(1,cfg.foodEnergy):0))/(foodD+.06)})
    if(nearestPrey){const score=huntScore(nearestPrey,preyD);if(Number.isFinite(score))candidates.push({type:'prey',mode:'hunting',id:nearestPrey.id,x:nearestPrey.x,y:nearestPrey.y,score})}
    if(c.targetType==='food'&&c.targetId!==nearestFood?.id){const held=food.find(f=>f.id===c.targetId);if(held&&distance(c,held)<=c.sense)candidates.push({type:'food',mode:'foraging',id:held.id,x:held.x,y:held.y,score:(3.2+c.exploration)/(distance(c,held)+.06)})}
    if(c.targetType==='prey'&&c.targetId!==nearestPrey?.id){const held=active.find(o=>o.id===c.targetId&&c.size>=o.size*cfg.predatorRatio);if(held&&distance(c,held)<=c.sense){const score=huntScore(held,distance(c,held));if(Number.isFinite(score))candidates.push({type:'prey',mode:'hunting',id:held.id,x:held.x,y:held.y,score})}}
    if(!nearestFood&&memory.foodX!==null)candidates.push({type:'memory',mode:'foraging',id:null,x:memory.foodX,y:memory.foodY!,score:(1.5+2*c.exploration)/(distance(c,{x:memory.foodX,y:memory.foodY!})+.1)})
  }
  const noise=keyedNoise(cfg.seed,c.id,tick,1)
  const wanderTurn=clamp(c.wanderTurn+noise*.045,-.8,.8)
  const wanderAngle=c.wanderAngle+wanderTurn*(.45+c.exploration)*.025
  candidates.push({type:'explore',mode:'exploring',id:null,x:clamp(c.x+Math.cos(wanderAngle)*.32,.03,.97),y:clamp(c.y+Math.sin(wanderAngle)*.32,.03,.97),score:.6+2.5*c.exploration+keyedNoise(cfg.seed,c.id,tick,2)*.15})
  candidates.sort((a,b)=>b.score-a.score||a.type.localeCompare(b.type))
  let choice=candidates[0]
  const urgent=candidates.find(v=>v.urgent)
  if(urgent)choice=urgent
  else if(time<c.commitUntil&&c.targetType){
    const committed=candidates.find(v=>v.type===c.targetType&&(c.targetId===null||v.id===c.targetId))
    if(committed&&choice.score<committed.score*1.3)choice=committed
  }
  const switched=choice.type!==c.targetType||choice.id!==c.targetId
  const reason=(candidate:Candidate)=>candidate.type==='threat'?'Detected danger weighted by caution':candidate.type==='home'?'Food, time, and energy favor returning':candidate.type==='food'?'Nearby food utility':candidate.type==='prey'?'Hunting utility weighted by aggression':candidate.type==='memory'?'Recently remembered food location':'Persistent exploration and novelty'
  return{id:c.id,targetX:choice.x,targetY:choice.y,targetId:choice.id,targetType:choice.type,mode:choice.mode,memory,commitUntil:switched?time+cfg.commitmentDuration:c.commitUntil,wanderAngle,wanderTurn,summary:capture?{chosen:choice.type,reason:reason(choice),candidates:candidates.map(v=>({type:v.type,mode:v.mode,score:v.score,reason:reason(v),targetId:v.id}))}:undefined}
}
