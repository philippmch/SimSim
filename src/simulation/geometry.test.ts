import{describe,expect,it}from'vitest'
import{angleDelta,hasLineOfSight,isWithinFieldOfView,normalizeAngle,segmentIntersectsCircle}from'./geometry'

describe('perception geometry',()=>{
  it('normalizes angles and finds the shortest signed delta',()=>{expect(normalizeAngle(-Math.PI/2)).toBeCloseTo(Math.PI*1.5);expect(normalizeAngle(Math.PI*5)).toBeCloseTo(Math.PI);expect(normalizeAngle(NaN)).toBe(0);expect(angleDelta(Math.PI*1.9,.1*Math.PI)).toBeCloseTo(.2*Math.PI);expect(angleDelta(.1*Math.PI,Math.PI*1.9)).toBeCloseTo(-.2*Math.PI)})
  it('uses an angle-centred field of view including its boundary',()=>{const origin={x:0,y:0};expect(isWithinFieldOfView(origin,{x:1,y:1},0,90)).toBe(true);expect(isWithinFieldOfView(origin,{x:0,y:1},0,90)).toBe(false);expect(isWithinFieldOfView(origin,{x:-1,y:0},0,360)).toBe(true)})
  it('detects circle intersections only along the open line segment',()=>{expect(segmentIntersectsCircle({x:0,y:0},{x:1,y:0},{x:.5,y:0,radius:.1})).toBe(true);expect(segmentIntersectsCircle({x:0,y:0},{x:1,y:0},{x:.5,y:.1,radius:.1})).toBe(true);expect(segmentIntersectsCircle({x:0,y:0},{x:1,y:0},{x:2,y:0,radius:.5})).toBe(false);expect(segmentIntersectsCircle({x:0,y:0},{x:0,y:0},{x:0,y:0,radius:1})).toBe(false)})
  it('reports line of sight independently of obstacle order',()=>{const a={id:2,x:.5,y:.4,radius:.1},b={id:1,x:.5,y:0,radius:.1};expect(hasLineOfSight({x:0,y:0},{x:1,y:0},[a,b])).toBe(false);expect(hasLineOfSight({x:0,y:0},{x:1,y:0},[b,a])).toBe(false);expect(hasLineOfSight({x:0,y:0},{x:1,y:0},[a])).toBe(true)})
})
