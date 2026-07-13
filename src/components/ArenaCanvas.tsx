import { useEffect, useRef } from 'react'
import type React from 'react'
import type { World } from '../simulation/types'

interface Props { world: World; revision: number;selectedIndividualId:number|null;onSelect:(individualId:number|null)=>void }

function speedColor(speed: number) {
  const t=Math.max(0,Math.min(1,(speed-.55)/1.15))
  const hue=175+(54-175)*t
  return `hsl(${hue} 58% ${42+t*14}%)`
}

export function ArenaCanvas({world,revision,selectedIndividualId,onSelect}:Props) {
  const ref=useRef<HTMLCanvasElement>(null)
  const drawRef=useRef<()=>void>(()=>{})
  useEffect(()=>{
    const canvas=ref.current
    if(!canvas) return
    const draw=()=>{
      const rect=canvas.getBoundingClientRect(), dpr=Math.min(2,window.devicePixelRatio||1)
      if(canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){
        canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr)
      }
      const ctx=canvas.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0)
      const w=rect.width,h=rect.height,pad=Math.max(20,Math.min(w,h)*.055)
      ctx.clearRect(0,0,w,h)
      const grad=ctx.createLinearGradient(0,0,w,h);grad.addColorStop(0,'#e8eee4');grad.addColorStop(1,'#dce7d8')
      ctx.fillStyle=grad;ctx.beginPath();ctx.roundRect(pad,pad,w-pad*2,h-pad*2,Math.min(34,w*.05));ctx.fill()
      ctx.strokeStyle='rgba(47,78,65,.18)';ctx.lineWidth=1;ctx.stroke()
      ctx.save();ctx.setLineDash([4,8]);ctx.strokeStyle='rgba(37,75,62,.22)';ctx.strokeRect(pad+10,pad+10,w-pad*2-20,h-pad*2-20);ctx.restore()
      const sx=(x:number)=>pad+x*(w-pad*2), sy=(y:number)=>pad+y*(h-pad*2)
      for(const patch of world.environment.patches){
        const x=sx(patch.x),y=sy(patch.y),r=Math.max(24,Math.min(w,h)*world.config.foodPatchSpread*.72)
        const halo=ctx.createRadialGradient(x,y,0,x,y,r);halo.addColorStop(0,'rgba(183,190,88,.16)');halo.addColorStop(1,'rgba(183,190,88,0)')
        ctx.fillStyle=halo;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()
      }
      for(const obstacle of world.environment.obstacles){
        const x=sx(obstacle.x),y=sy(obstacle.y),r=obstacle.radius*Math.min(w-pad*2,h-pad*2)
        ctx.fillStyle='rgba(28,48,39,.16)';ctx.beginPath();ctx.ellipse(x+2,y+r*.72,r*1.04,r*.36,0,0,Math.PI*2);ctx.fill()
        const rock=ctx.createRadialGradient(x-r*.25,y-r*.3,2,x,y,r);rock.addColorStop(0,'#93a594');rock.addColorStop(1,'#526b5d')
        ctx.fillStyle=rock;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(32,53,44,.3)';ctx.stroke()
      }
      for(const f of world.food){
        const x=sx(f.x),y=sy(f.y),r=Math.max(3.5,Math.min(w,h)*.008)
        ctx.fillStyle='rgba(31,55,38,.18)';ctx.beginPath();ctx.ellipse(x+1,y+r*.9,r*1.2,r*.38,0,0,Math.PI*2);ctx.fill()
        const g=ctx.createRadialGradient(x-r*.25,y-r*.35,1,x,y,r);g.addColorStop(0,'#e9d77d');g.addColorStop(.4,'#a2b95d');g.addColorStop(1,'#5f7133')
        ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()
      }
      const sorted=[...world.creatures].filter(c=>c.alive).sort((a,b)=>a.y-b.y)
      for(const c of sorted){
        const x=sx(c.x),y=sy(c.y),base=Math.max(7,Math.min(w,h)*.017*c.size), height=base*1.55
        ctx.fillStyle='rgba(22,38,30,.16)';ctx.beginPath();ctx.ellipse(x,y+base*.46,base*.9,base*.3,0,0,Math.PI*2);ctx.fill()
        if(c.individualId===selectedIndividualId){ctx.strokeStyle='#f2c94c';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y-height*.35,base*1.5,0,Math.PI*2);ctx.stroke()}
        const orientation=Math.hypot(c.vx,c.vy)>.001?Math.atan2(c.vy,c.vx):c.angle
        ctx.save();ctx.translate(x,y);ctx.rotate(orientation+Math.PI/2)
        if(c.returning){ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,-height*.15,base*1.15,0,Math.PI*2);ctx.stroke()}
        const g=ctx.createLinearGradient(-base,-height,base,base*.45);g.addColorStop(0,'rgba(255,255,255,.35)');g.addColorStop(.25,speedColor(c.speed));g.addColorStop(1,'#304b35')
        ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(-base*.78,base*.35);ctx.bezierCurveTo(-base*1.05,-height*.18,-base*.56,-height,0,-height);ctx.bezierCurveTo(base*.56,-height,base*1.05,-height*.18,base*.78,base*.35);ctx.quadraticCurveTo(0,base*.65,-base*.78,base*.35);ctx.fill()
        const look=Math.cos(c.angle)*base*.1
        ctx.fillStyle='#132019';ctx.beginPath();ctx.arc(-base*.25+look,-height*.55,Math.max(1.2,base*.075),0,Math.PI*2);ctx.arc(base*.25+look,-height*.55,Math.max(1.2,base*.075),0,Math.PI*2);ctx.fill()
        if(c.food>0){ctx.fillStyle='#f2d45d';ctx.font=`600 ${Math.max(8,base*.55)}px system-ui`;ctx.textAlign='center';ctx.fillText(String(c.food),0,base*.15)}
        ctx.restore()
      }
      const pct=Math.min(1,world.dayTime/world.config.dayLength)
      ctx.fillStyle='rgba(16,34,28,.16)';ctx.fillRect(pad,pad-9,w-pad*2,3)
      ctx.fillStyle='#d9b940';ctx.fillRect(pad,pad-9,(w-pad*2)*pct,3)
    }
    drawRef.current=draw;draw()
  },[world,revision])
  useEffect(()=>{const canvas=ref.current;if(!canvas||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>drawRef.current());observer.observe(canvas);return()=>observer.disconnect()},[])
  const chooseAt=(event:React.MouseEvent<HTMLCanvasElement>)=>{const canvas=ref.current;if(!canvas)return;const rect=canvas.getBoundingClientRect(),pad=Math.max(20,Math.min(rect.width,rect.height)*.055),x=(event.clientX-rect.left-pad)/(rect.width-pad*2),y=(event.clientY-rect.top-pad)/(rect.height-pad*2);let best:World['creatures'][number]|undefined,bestD=.05;for(const c of world.creatures.filter(c=>c.alive)){const d=Math.hypot(c.x-x,c.y-y);if(d<bestD){best=c;bestD=d}}onSelect(best?.individualId??null)}
  return <><canvas ref={ref} className="arena" role="img" onClick={chooseAt} aria-label={`Simulation arena, generation ${world.generation}, ${world.creatures.filter(c=>c.alive).length} living creatures, ${world.food.length} of ${Math.round(world.environment.foodBudget)} food remaining, ${world.environment.patches.length} food patches, and ${world.environment.obstacles.length} obstacles. Click a creature or use the inspector list to select it.`}>
    Natural selection simulation arena. Live counts are available in the statistics region.
  </canvas><label className="creature-picker">Inspect <select value={selectedIndividualId??''} onChange={e=>onSelect(e.target.value?Number(e.target.value):null)}><option value="">No creature selected</option>{[...world.creatures].filter(c=>c.alive).sort((a,b)=>a.individualId-b.individualId).map(c=><option key={c.individualId} value={c.individualId}>Individual {c.individualId}, lineage {c.lineageId}, {c.mode}</option>)}</select></label></>
}

export { speedColor }
