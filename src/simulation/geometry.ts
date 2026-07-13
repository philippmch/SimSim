import type {Obstacle} from './types'

export interface Point{x:number;y:number}

const TAU=Math.PI*2
const EPSILON=1e-9

/** Normalize an angle in radians to the half-open interval [0, 2π). */
export function normalizeAngle(angle:number){
  if(!Number.isFinite(angle))return 0
  const normalized=angle%TAU
  return normalized<0?normalized+TAU:normalized
}

/** Smallest signed rotation in radians from `from` to `to`, in [-π, π]. */
export function angleDelta(from:number,to:number){
  let delta=normalizeAngle(to)-normalizeAngle(from)
  if(delta>Math.PI)delta-=TAU
  if(delta<-Math.PI)delta+=TAU
  return delta
}

/** Whether a target lies inside an angle-centred field of view. */
export function isWithinFieldOfView(origin:Point,target:Point,facing:number,fieldOfViewDegrees:number){
  const fov=Math.max(0,Math.min(360,Number.isFinite(fieldOfViewDegrees)?fieldOfViewDegrees:0))
  if(fov>=360-EPSILON)return true
  const dx=target.x-origin.x,dy=target.y-origin.y
  if(dx*dx+dy*dy<=EPSILON*EPSILON)return true
  const bearing=Math.atan2(dy,dx)
  return Math.abs(angleDelta(facing,bearing))<=fov*Math.PI/360+EPSILON
}

/** True when the open segment between two points crosses or touches a circle. */
export function segmentIntersectsCircle(start:Point,end:Point,circle:Pick<Obstacle,'x'|'y'|'radius'>){
  const dx=end.x-start.x,dy=end.y-start.y
  const lengthSquared=dx*dx+dy*dy
  if(lengthSquared<=EPSILON*EPSILON)return false
  const radius=Math.max(0,Number.isFinite(circle.radius)?circle.radius:0)
  if(radius<=EPSILON)return false
  const fx=start.x-circle.x,fy=start.y-circle.y
  const a=lengthSquared,b=2*(fx*dx+fy*dy),c=fx*fx+fy*fy-radius*radius
  const discriminant=b*b-4*a*c
  if(discriminant<-EPSILON)return false
  const root=Math.sqrt(Math.max(0,discriminant)),denominator=2*a
  const near=(-b-root)/denominator,far=(-b+root)/denominator
  return(near>EPSILON&&near<1-EPSILON)||(far>EPSILON&&far<1-EPSILON)||(near<=EPSILON&&far>=1-EPSILON)
}

/** Occlusion is a boolean union, so obstacle input order cannot affect the result. */
export function hasLineOfSight(start:Point,end:Point,obstacles:readonly Obstacle[]){
  return!obstacles.some(obstacle=>segmentIntersectsCircle(start,end,obstacle))
}
