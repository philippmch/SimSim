import type {Config,Creature,HomeMove} from './types'
import {movementScale,restingEnergyRate} from './energyPolicy'

const MAX_EXPERIENCES=1_000_000
function recordExperience(c:Creature,x:number,y:number,kind:'food'|'danger'){
  if(!Number.isFinite(x)||!Number.isFinite(y))return
  const experience=c.homeExperience??={foodCount:0,foodX:0,foodY:0,dangerCount:0,dangerX:0,dangerY:0}
  const countKey=kind==='food'?'foodCount':'dangerCount',xKey=kind==='food'?'foodX':'dangerX',yKey=kind==='food'?'foodY':'dangerY'
  const count=Math.min(MAX_EXPERIENCES,experience[countKey]+1)
  experience[xKey]+=(Math.max(0,Math.min(1,x))-experience[xKey])/count
  experience[yKey]+=(Math.max(0,Math.min(1,y))-experience[yKey])/count
  experience[countKey]=count
}
export const recordHomeFoodExperience=(c:Creature,x:number,y:number)=>recordExperience(c,x,y,'food')
export const recordHomeDangerExperience=(c:Creature,x:number,y:number)=>recordExperience(c,x,y,'danger')

/**
 * Consider only two small moves along the current edge, using this round's
 * consumed-food and experienced-attack centroids. No map knowledge or RNG.
 * A food-distance reduction estimates savings on one future round trip;
 * a danger-distance increase values the same extra round-trip clearance.
 * Negative changes offset positive ones. Their combined energy equivalent
 * must exceed the full one-time walking cost and improve distance by .01.
 * The cost includes baseline metabolism and full-speed movement. Keep a
 * quarter starting reserve after paying it. Staying wins ties.
 */
export function chooseHomeMove(c:Creature,cfg:Config,availableEnergy:number):Omit<HomeMove,'generation'>|null{
  const e=c.homeExperience
  if(cfg.ecologyMode==='classic'||!e||(!e.foodCount&&!e.dangerCount)||!Number.isFinite(availableEnergy))return null
  const low=.025,high=.975,epsilon=1e-9
  if(c.homeX<low-epsilon||c.homeX>high+epsilon||c.homeY<low-epsilon||c.homeY>high+epsilon)return null
  // Corners use the vertical edge consistently, without crossing onto another edge.
  const vertical=Math.abs(c.homeX-low)<epsilon||Math.abs(c.homeX-high)<epsilon
  const horizontal=Math.abs(c.homeY-low)<epsilon||Math.abs(c.homeY-high)<epsilon
  if(!vertical&&!horizontal)return null
  const rate=restingEnergyRate(c,cfg)+cfg.moveEnergyFactor*c.size**3*c.speed**2
  const energyPerDistance=rate/Math.max(.001,movementScale(cfg)*c.speed)
  let best:Omit<HomeMove,'generation'>|null=null,bestBenefit=0
  for(const direction of [-1,1]){
    const toX=vertical?c.homeX:Math.max(low,Math.min(high,c.homeX+direction*.06))
    const toY=vertical?Math.max(low,Math.min(high,c.homeY+direction*.06)):c.homeY
    const distance=Math.hypot(toX-c.homeX,toY-c.homeY)
    if(distance<epsilon)continue
    const foodGain=e.foodCount?Math.hypot(c.homeX-e.foodX,c.homeY-e.foodY)-Math.hypot(toX-e.foodX,toY-e.foodY):0
    const dangerGain=e.dangerCount?Math.hypot(toX-e.dangerX,toY-e.dangerY)-Math.hypot(c.homeX-e.dangerX,c.homeY-e.dangerY):0
    const gain=foodGain+dangerGain,energyCost=distance*energyPerDistance
    const benefit=2*gain*energyPerDistance-energyCost
    if(gain<.01||benefit<=bestBenefit+epsilon||availableEnergy-energyCost<=cfg.startingEnergy*.25)continue
    bestBenefit=benefit
    best={fromX:c.homeX,fromY:c.homeY,toX,toY,energyCost,reason:foodGain>epsilon&&dangerGain>epsilon?'food-and-danger':foodGain>epsilon?'food':'danger'}
  }
  return best
}
