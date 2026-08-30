import type { Config,Creature,Obstacle } from './types'
import type { Decision } from './behavior'
import { clamp } from './random'

export interface Motion {id:number;x:number;y:number;vx:number;vy:number;angle:number;energy:number;home:boolean}
const angleDelta=(a:number,b:number)=>((b-a+Math.PI*3)%(Math.PI*2))-Math.PI
const MOTION_EPS=1e-10
type Point={x:number;y:number}

/**
 * Keep obstacle traversal independent from the order in which the environment
 * happened to serialize its obstacles.  IDs are the normal unique key; the
 * geometric fields make the ordering total for hand-authored/test fixtures
 * that reuse an ID.
 */
const obstacleOrder=(a:Obstacle,b:Obstacle)=>a.id-b.id||a.x-b.x||a.y-b.y||a.radius-b.radius

const clamp01=(value:number)=>Math.max(0,Math.min(1,value))

/**
 * A boundary touch while travelling away from a rock is not a blocked route;
 * a segment that enters the expanded clearance is.  This distinction lets a
 * detour leave the obstacle instead of selecting a new side on every tick.
 */
function segmentHitParameter(start:Point,end:Point,obstacle:Obstacle,clearance:number){
  const min=obstacle.radius+clearance-MOTION_EPS,dx=end.x-start.x,dy=end.y-start.y
  const fx=start.x-obstacle.x,fy=start.y-obstacle.y,startDistanceSquared=fx*fx+fy*fy
  if(startDistanceSquared<min*min)return 0
  const lengthSquared=dx*dx+dy*dy
  if(!lengthSquared)return undefined
  const b=2*(fx*dx+fy*dy),c= startDistanceSquared-min*min,discriminant=b*b-4*lengthSquared*c
  if(discriminant<0)return undefined
  const entry=(-b-Math.sqrt(Math.max(0,discriminant)))/(2*lengthSquared)
  return entry>=-MOTION_EPS&&entry<=1+MOTION_EPS?clamp01(entry):undefined
}

function tieBreakSign(obstacle:Obstacle){
  // The ID is stable across a replay.  Quantized geometry handles fixtures
  // that reuse an ID while remaining invariant to input array order.
  const qx=Math.round(obstacle.x*1e6),qy=Math.round(obstacle.y*1e6),qr=Math.round(obstacle.radius*1e6)
  let hash=(obstacle.id|0)^Math.imul(qx,0x9e3779b1)^Math.imul(qy,0x85ebca6b)^Math.imul(qr,0xc2b2ae35)
  hash=Math.imul(hash^(hash>>>16),0x7feb352d)
  return(hash^(hash>>>15))&1?1:-1
}

/**
 * Choose a local tangent direction around the first blocking obstacle.  The
 * sign from the radial/target cross product naturally keeps the same side as
 * the creature rounds the rock.  Exact symmetry falls back to a stable key,
 * so tiny floating-point changes cannot make the animal ping-pong sides.
 */
function detourDirection(c:Creature,d:Decision,obstacle:Obstacle,clearance:number):Point{
  let rx=c.x-obstacle.x,ry=c.y-obstacle.y,rd=Math.hypot(rx,ry)
  if(rd<MOTION_EPS){
    const targetX=d.targetX-obstacle.x,targetY=d.targetY-obstacle.y,targetDistance=Math.hypot(targetX,targetY)
    if(targetDistance>MOTION_EPS){rx=targetX;ry=targetY;rd=targetDistance}
    else{rx=1;ry=0;rd=1}
  }
  const nx=rx/rd,ny=ry/rd
  let tx=d.targetX-obstacle.x,ty=d.targetY-obstacle.y,targetDistance=Math.hypot(tx,ty)
  if(targetDistance<MOTION_EPS){tx=Math.cos(c.angle);ty=Math.sin(c.angle);targetDistance=Math.hypot(tx,ty)||1}
  const cross=nx*ty-ny*tx
  const side=Math.abs(cross)>1e-6*targetDistance?(cross>0?1:-1):tieBreakSign(obstacle)
  // side +1 is counter-clockwise; side -1 is clockwise.
  const tangentX=side>0?-ny:ny,tangentY=side>0?nx:-nx
  // Add a small outward component close to the expanded boundary.  It gives
  // an already-touching creature room to escape while the tangent component
  // makes measurable progress around the obstacle.
  const min=obstacle.radius+clearance,outward=Math.max(0,Math.min(.45,(min+clearance*2-rd)/Math.max(min,.001)))
  return{x:tangentX+nx*outward,y:tangentY+ny*outward}
}

function firstBlockingObstacle(c:Creature,end:Point,obstacles:Obstacle[],clearance:number){
  let best:Obstacle|undefined,bestT=Infinity
  for(const obstacle of obstacles){
    const hit=segmentHitParameter(c,end,obstacle,clearance)
    if(hit===undefined)continue
    if(hit<bestT-MOTION_EPS){best=obstacle;bestT=hit}
    // Equal hit positions are resolved by the canonical obstacle order.
  }
  return best
}

export function proposeMotion(c:Creature,d:Decision,cfg:Config,obstacles:Obstacle[],dt:number):Motion{
  const desired=Math.atan2(d.targetY-c.y,d.targetX-c.x)
  const maxTurn=cfg.turnRate/Math.sqrt(Math.max(.35,c.size))*dt
  let angle=c.angle+clamp(angleDelta(c.angle,desired),-maxTurn,maxTurn)
  const maxVelocity=.038*c.speed
  let desiredVx=Math.cos(angle)*maxVelocity,desiredVy=Math.sin(angle)*maxVelocity
  const accel=cfg.acceleration/Math.max(.5,c.size)*dt
  let dvx=desiredVx-c.vx,dvy=desiredVy-c.vy,dv=Math.hypot(dvx,dvy)
  let vx=c.vx+(dv>accel?dvx/dv*accel:dvx),vy=c.vy+(dv>accel?dvy/dv*accel:dvy)
  let x=c.x+vx*dt,y=c.y+vy*dt
  const stableObstacles=[...obstacles].sort(obstacleOrder)
  if(stableObstacles.length){
    const clearance=.01*c.size,blocked=firstBlockingObstacle(c,{x,y},stableObstacles,clearance)
    if(blocked){
      const detour=detourDirection(c,d,blocked,clearance),detourAngle=Math.atan2(detour.y,detour.x)
      angle=c.angle+clamp(angleDelta(c.angle,detourAngle),-maxTurn,maxTurn)
      desiredVx=Math.cos(angle)*maxVelocity;desiredVy=Math.sin(angle)*maxVelocity
      dvx=desiredVx-c.vx;dvy=desiredVy-c.vy;dv=Math.hypot(dvx,dvy)
      vx=c.vx+(dv>accel?dvx/dv*accel:dvx);vy=c.vy+(dv>accel?dvy/dv*accel:dvy)
      x=c.x+vx*dt;y=c.y+vy*dt
    }
  }
  // Expanded obstacle clearances can overlap for large creatures. Stable,
  // repeated projection converges to a legal point without input-order bias.
  for(let pass=0;pass<32;pass++){
    let corrected=false
    for(const o of stableObstacles){
      const min=o.radius+.01*c.size,dx=x-o.x,dy=y-o.y,dist=Math.hypot(dx,dy)
      if(dist<min-1e-10){const nx=dist?dx/dist:1,ny=dist?dy/dist:0;x=o.x+nx*min;y=o.y+ny*min;const inward=vx*nx+vy*ny;if(inward<0){vx-=inward*nx;vy-=inward*ny}corrected=true}
    }
    if(!corrected)break
  }
  if(stableObstacles.some(o=>Math.hypot(x-o.x,y-o.y)<o.radius+.01*c.size-1e-8)){
    const origin={x,y};let best:{x:number;y:number;distance:number}|undefined
    for(const o of stableObstacles)for(let step=0;step<128;step++){
      const angle=step/128*Math.PI*2,r=o.radius+.01*c.size+1e-7
      const candidate={x:o.x+Math.cos(angle)*r,y:o.y+Math.sin(angle)*r}
      if(candidate.x<.012||candidate.x>.988||candidate.y<.012||candidate.y>.988)continue
      if(stableObstacles.some(other=>Math.hypot(candidate.x-other.x,candidate.y-other.y)<other.radius+.01*c.size))continue
      const candidateDistance=Math.hypot(candidate.x-origin.x,candidate.y-origin.y)
      if(!best||candidateDistance<best.distance-1e-12)best={...candidate,distance:candidateDistance}
    }
    if(best){x=best.x;y=best.y;for(const o of stableObstacles){const dx=x-o.x,dy=y-o.y,dist=Math.hypot(dx,dy),nx=dx/dist,ny=dy/dist,inward=vx*nx+vy*ny;if(inward<0){vx-=inward*nx;vy-=inward*ny}}}
  }
  if(x<.012){x=.012;vx=Math.max(0,vx)}else if(x>.988){x=.988;vx=Math.min(0,vx)}
  if(y<.012){y=.012;vy=Math.max(0,vy)}else if(y>.988){y=.988;vy=Math.min(0,vy)}
  const actual=Math.hypot(vx,vy)/.038
  const metabolic=.08+cfg.senseEnergyFactor*c.sense*8+cfg.moveEnergyFactor*c.size**3*actual**2
  const home=(cfg.ecologyMode==='classic'?c.food>=1:d.mode==='returning')&&Math.hypot(x-c.homeX,y-c.homeY)<.025
  return{id:c.id,x,y,vx:home?0:vx,vy:home?0:vy,angle,energy:c.energy-metabolic*dt,home}
}
