export function random(state:{rngState:number}){
  let t=state.rngState+=0x6D2B79F5
  t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61)
  return((t^t>>>14)>>>0)/4294967296
}
export function keyedNoise(seed:number,id:number,tick:number,channel=0){
  let x=(seed^Math.imul(id,0x9E3779B1)^Math.imul(tick+channel*7919,0x85EBCA6B))>>>0
  x^=x>>>16;x=Math.imul(x,0x7FEB352D);x^=x>>>15;x=Math.imul(x,0x846CA68B);x^=x>>>16
  return(x/4294967295)*2-1
}
export const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v))
export const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y)
