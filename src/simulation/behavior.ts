import type { Config,Creature,DecisionProvenance,DecisionSelectionBasis,DecisionSummary,Food,Memory,Mode,TargetType } from './types'
import { clamp,distance,keyedNoise } from './random'
import {contestSuccessProbability,isEligiblePrey} from './predation'

export interface Decision {id:number;targetX:number;targetY:number;targetId:number|null;targetType:TargetType;mode:Mode;memory:Memory;commitUntil:number;wanderAngle:number;wanderTurn:number;summary?:DecisionSummary}
export type DecisionCaptureContext=DecisionProvenance
type Candidate={type:TargetType;mode:Mode;x:number;y:number;id:number|null;score:number;urgent?:boolean}

/** Keep malformed/legacy food records from poisoning a decision score. */
export function safeFoodEnergy(food:Pick<Food,'energy'>,cfg:Config){
  const fallback=typeof cfg.foodEnergy==='number'&&Number.isFinite(cfg.foodEnergy)?Math.max(0,cfg.foodEnergy):0
  return typeof food.energy==='number'&&Number.isFinite(food.energy)&&food.energy>=0?food.energy:fallback
}

/**
 * Score food by both distance and its actual energy value.  The optional
 * reserve term mirrors the two existing call sites: ordinary food candidates
 * include the advanced return-reserve pressure, while a held target keeps its
 * legacy commitment baseline.  With an energy ratio of exactly one this
 * reduces to the pre-quality score byte-for-byte in arithmetic terms.
 */
export function foodDistanceUtility(c:Creature,food:Pick<Food,'energy'>,d:number,cfg:Config,reproductiveReserve:number,includeReserve=true){
  const denominator=Number.isFinite(d)&&d>=0?d+.06:Infinity
  if(!Number.isFinite(denominator))return -Infinity
  const baseline=(3.2+c.exploration+(includeReserve&&cfg.ecologyMode==='energy-regrowth'?Math.max(0,reproductiveReserve-c.energy)/Math.max(1,cfg.foodEnergy):0))/denominator
  if(cfg.ecologyMode!=='energy-regrowth')return baseline
  // A missing/invalid food energy falls back to the configured baseline.  A
  // real zero remains zero, making empty-value items unattractive when richer
  // alternatives are visible.
  const configured=typeof cfg.foodEnergy==='number'&&Number.isFinite(cfg.foodEnergy)?Math.max(0,cfg.foodEnergy):0
  // A zero configured baseline has no meaningful ratio.  Treat it as neutral
  // so old zero-energy advanced snapshots keep their nearest-food behavior.
  const ratio=configured>0?safeFoodEnergy(food,cfg)/configured:1
  return baseline*ratio
}

export function decide(c:Creature,active:readonly Creature[],food:readonly Food[],cfg:Config,time:number,tick:number,capture=false,captureContext?:DecisionCaptureContext):Decision{
  let nearestFood:Food|undefined,foodD=Infinity,nearestPrey:Creature|undefined,preyD=Infinity,nearestThreat:Creature|undefined,threatD=Infinity
  const advanced=cfg.ecologyMode==='energy-regrowth'
  const huntScore=(prey:Creature,d:number)=>{if(cfg.predationMode!=='contest')return(1+7*c.aggression)/(d+.08)-4*c.caution*(prey.size/c.size);const expected=contestSuccessProbability(c,prey,cfg)*cfg.preyEnergy-cfg.attackCost;return expected<=0?-Infinity:expected*(.4+1.6*c.aggression)/(d+.08)-4*c.caution*(prey.size/c.size)}
  const reproductiveReserve=cfg.startingEnergy+cfg.reproductionEnergyCost/Math.max(.05,cfg.energyRetention)
  let bestPreyScore=-Infinity,bestFoodScore=-Infinity
  for(const f of food){
    const d=distance(c,f)
    if(d>c.sense)continue
    if(advanced){
      const score=foodDistanceUtility(c,f,d,cfg,reproductiveReserve)
      if(score>bestFoodScore||(score===bestFoodScore&&(d<foodD||(d===foodD&&f.id<(nearestFood?.id??Infinity))))){nearestFood=f;foodD=d;bestFoodScore=score}
    }else if(d<foodD||(d===foodD&&f.id<(nearestFood?.id??Infinity))){nearestFood=f;foodD=d}
  }
  for(const o of active){if(o.id===c.id)continue;const d=distance(c,o);if(d>c.sense)continue
    if(isEligiblePrey(o,c,cfg)&&(d<threatD||(d===threatD&&o.id<(nearestThreat?.id??Infinity)))){nearestThreat=o;threatD=d}
    if(isEligiblePrey(c,o,cfg)){
      if(cfg.predationMode==='contest'){
        const score=huntScore(o,d)
        if(Number.isFinite(score)&&(score>bestPreyScore||(score===bestPreyScore&&(d<preyD||(d===preyD&&o.id<(nearestPrey?.id??Infinity)))))){nearestPrey=o;preyD=d;bestPreyScore=score}
      }else if(d<preyD||(d===preyD&&o.id<(nearestPrey?.id??Infinity))){nearestPrey=o;preyD=d}
    }
  }
  const memory={...c.memory}
  if(nearestFood){memory.foodX=nearestFood.x;memory.foodY=nearestFood.y;memory.foodUntil=time+cfg.memoryDuration}
  else if(time>=memory.foodUntil||(memory.foodX!==null&&distance(c,{x:memory.foodX,y:memory.foodY!})<.025)){memory.foodX=null;memory.foodY=null}
  if(nearestThreat){memory.threatX=nearestThreat.x;memory.threatY=nearestThreat.y;memory.threatUntil=time+cfg.memoryDuration*.65}
  else if(time>=memory.threatUntil){memory.threatX=null;memory.threatY=null}

  const cost=.12+cfg.senseEnergyFactor*c.sense*8+cfg.moveEnergyFactor*c.size**3*c.speed**2
  const homeD=distance(c,{x:c.homeX,y:c.homeY}),homeTime=homeD/Math.max(.001,.038*c.speed),timeLeft=cfg.dayLength-time
  const unsafe=c.food===1&&(timeLeft<=homeTime*1.2+.5||c.energy<=cost*homeTime*1.25+2)
  const advancedUnsafe=timeLeft<=homeTime*1.2+.5||c.energy<=cost*homeTime*1.25+5
  const reserveReady=advanced&&c.energy>=reproductiveReserve
  const candidates:Candidate[]=[]
  if(nearestThreat){const urgent=threatD<c.sense*(.1+.5*c.caution);candidates.push({type:'threat',mode:'fleeing',id:nearestThreat.id,x:clamp(c.x+(c.x-nearestThreat.x)*3,0,1),y:clamp(c.y+(c.y-nearestThreat.y)*3,0,1),score:6+6*c.caution+(c.sense-threatD)/c.sense*4,urgent})}
  else if(memory.threatX!==null)candidates.push({type:'threat',mode:'fleeing',id:null,x:clamp(c.x+(c.x-memory.threatX)*2,0,1),y:clamp(c.y+(c.y-memory.threatY!)*2,0,1),score:2.5*c.caution})
  if(!advanced&&(c.food>=2||unsafe||c.returning))candidates.push({type:'home',mode:'returning',id:null,x:c.homeX,y:c.homeY,score:c.food>=2?100:unsafe?45+10*c.caution:12,urgent:c.food>=2||unsafe})
  if(advanced&&(advancedUnsafe||reserveReady||c.returning))candidates.push({type:'home',mode:'returning',id:null,x:c.homeX,y:c.homeY,score:reserveReady?100:advancedUnsafe?45+10*c.caution:12,urgent:reserveReady||advancedUnsafe})
  if((advanced||c.food<2)&&!c.returning){
    if(nearestFood)candidates.push({type:'food',mode:'foraging',id:nearestFood.id,x:nearestFood.x,y:nearestFood.y,score:advanced?bestFoodScore:(3.2+c.exploration)/(foodD+.06)})
    if(nearestPrey){const score=huntScore(nearestPrey,preyD);if(Number.isFinite(score))candidates.push({type:'prey',mode:'hunting',id:nearestPrey.id,x:nearestPrey.x,y:nearestPrey.y,score})}
    if(c.targetType==='food'&&c.targetId!==nearestFood?.id){const held=food.find(f=>f.id===c.targetId),heldD=held?distance(c,held):Infinity;if(held&&heldD<=c.sense)candidates.push({type:'food',mode:'foraging',id:held.id,x:held.x,y:held.y,score:advanced?foodDistanceUtility(c,held,heldD,cfg,reproductiveReserve,false):(3.2+c.exploration)/(heldD+.06)})}
    if(c.targetType==='prey'&&c.targetId!==nearestPrey?.id){const held=active.find(o=>o.id===c.targetId&&isEligiblePrey(c,o,cfg));if(held&&distance(c,held)<=c.sense){const score=huntScore(held,distance(c,held));if(Number.isFinite(score))candidates.push({type:'prey',mode:'hunting',id:held.id,x:held.x,y:held.y,score})}}
    if(!nearestFood&&memory.foodX!==null)candidates.push({type:'memory',mode:'foraging',id:null,x:memory.foodX,y:memory.foodY!,score:(1.5+2*c.exploration)/(distance(c,{x:memory.foodX,y:memory.foodY!})+.1)})
  }
  const noise=keyedNoise(cfg.seed,c.id,tick,1)
  const wanderTurn=clamp(c.wanderTurn+noise*.045,-.8,.8)
  const wanderAngle=c.wanderAngle+wanderTurn*(.45+c.exploration)*.025
  candidates.push({type:'explore',mode:'exploring',id:null,x:clamp(c.x+Math.cos(wanderAngle)*.32,.03,.97),y:clamp(c.y+Math.sin(wanderAngle)*.32,.03,.97),score:.6+2.5*c.exploration+keyedNoise(cfg.seed,c.id,tick,2)*.15})
  candidates.sort((a,b)=>b.score-a.score||a.type.localeCompare(b.type))
  const best=candidates[0]
  let choice=best
  let selectionBasis:DecisionSelectionBasis='best-utility'
  const sameCandidate=(a:Candidate,b:Candidate)=>a.type===b.type&&a.id===b.id
  const urgent=candidates.find(v=>v.urgent)
  if(urgent){choice=urgent;if(!sameCandidate(choice,best))selectionBasis='urgent-override'}
  else if(time<c.commitUntil&&c.targetType){
    const committed=candidates.find(v=>v.type===c.targetType&&(c.targetId===null||v.id===c.targetId))
    if(committed&&choice.score<committed.score*1.3){choice=committed;if(!sameCandidate(choice,best))selectionBasis='commitment'}
  }
  const switched=choice.type!==c.targetType||choice.id!==c.targetId
  const reason=(candidate:Candidate)=>candidate.type==='threat'?'Detected danger weighted by caution':candidate.type==='home'?'Food, time, and energy favor returning':candidate.type==='food'?(advanced?'Food value and distance utility':'Nearby food utility'):candidate.type==='prey'?'Hunting utility weighted by aggression':candidate.type==='memory'?'Recently remembered food location':'Persistent exploration and novelty'
  const summary=capture?{
    chosen:choice.type,
    chosenTargetId:choice.id,
    selectionBasis,
    ...(captureContext?{decidedAt:{generation:captureContext.generation,dayTime:captureContext.dayTime,reactionWindow:captureContext.reactionWindow}}:{}),
    reason:reason(choice),
    candidates:candidates.map(v=>({type:v.type,mode:v.mode,score:v.score,reason:reason(v),targetId:v.id})),
  }:undefined
  return{id:c.id,targetX:choice.x,targetY:choice.y,targetId:choice.id,targetType:choice.type,mode:choice.mode,memory,commitUntil:switched?time+cfg.commitmentDuration:c.commitUntil,wanderAngle,wanderTurn,summary}
}
