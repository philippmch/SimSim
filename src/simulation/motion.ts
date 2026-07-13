import type { Config,Creature,Obstacle } from './types'
import type { Decision } from './behavior'
import { clamp } from './random'

export interface Motion {id:number;x:number;y:number;vx:number;vy:number;angle:number;energy:number;home:boolean}
const angleDelta=(a:number,b:number)=>((b-a+Math.PI*3)%(Math.PI*2))-Math.PI

export function proposeMotion(c:Creature,d:Decision,cfg:Config,obstacles:Obstacle[],dt:number):Motion{
  const desired=Math.atan2(d.targetY-c.y,d.targetX-c.x)
  const maxTurn=cfg.turnRate/Math.sqrt(Math.max(.35,c.size))*dt
  const angle=c.angle+clamp(angleDelta(c.angle,desired),-maxTurn,maxTurn)
  const maxVelocity=.038*c.speed
  const desiredVx=Math.cos(angle)*maxVelocity,desiredVy=Math.sin(angle)*maxVelocity
  const accel=cfg.acceleration/Math.max(.5,c.size)*dt
  const dvx=desiredVx-c.vx,dvy=desiredVy-c.vy,dv=Math.hypot(dvx,dvy)
  let vx=c.vx+(dv>accel?dvx/dv*accel:dvx),vy=c.vy+(dv>accel?dvy/dv*accel:dvy)
  let x=c.x+vx*dt,y=c.y+vy*dt
  const stableObstacles=[...obstacles].sort((a,b)=>a.id-b.id)
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
  const home=c.food>=1&&Math.hypot(x-c.homeX,y-c.homeY)<.025
  return{id:c.id,x,y,vx:home?0:vx,vy:home?0:vy,angle,energy:c.energy-metabolic*dt,home}
}
