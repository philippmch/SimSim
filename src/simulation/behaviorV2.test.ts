import {describe,expect,it} from 'vitest'
import {createWorld,defaultConfig,finishGeneration,SIMULATION_TIMESTEP,tick} from './engine'
import {decide} from './behavior'
import {proposeMotion} from './motion'
import {advanceFoodBudget,seasonalTarget} from './environment'
import type {Creature} from './types'
import {CLASSIC_MODES} from './config'

const world=(n=3,extra={})=>createWorld({...defaultConfig,...CLASSIC_MODES,initialPopulation:n,foodPerDay:0,obstacleCount:0,foodPatchCount:2,founderPhysicalVariation:0,founderBehaviorVariation:0,...extra})
const food=(id:number,x:number,y:number)=>({id,x,y,patchId:null,energy:22})

describe('two-phase ecology',()=>{
  it('is invariant to creature array permutation',()=>{
    const a=createWorld({...defaultConfig,seed:818,initialPopulation:10}),b=createWorld({...defaultConfig,seed:818,initialPopulation:10})
    b.creatures.reverse();tick(a,SIMULATION_TIMESTEP);tick(b,SIMULATION_TIMESTEP)
    const sorted=(items:Creature[])=>[...items].sort((x,y)=>x.id-y.id)
    expect(sorted(a.creatures)).toEqual(sorted(b.creatures));expect(a.food).toEqual(b.food)
  })
  it('resolves contested food by distance then stable id',()=>{
    const w=world(2),[a,b]=w.creatures
    for(const c of [a,b])Object.assign(c,{x:.5,y:.5,angle:0,vx:0,vy:0,sense:.2})
    w.food=[food(999,.5,.5)];tick(w,SIMULATION_TIMESTEP)
    expect(a.id).toBeLessThan(b.id);expect([a.food,b.food]).toEqual([1,0]);expect(w.food).toHaveLength(0)
  })
  it('allows a killed predator to complete its pre-decided contact',()=>{
    const w=world(3,{predatorRatio:1.2}),[large,middle,small]=w.creatures
    Object.assign(large,{x:.5,y:.5,size:2,sense:.04,aggression:1,caution:0})
    Object.assign(middle,{x:.525,y:.5,size:1.5,sense:.04,aggression:1,caution:0})
    Object.assign(small,{x:.55,y:.5,size:1,sense:.04,aggression:1,caution:0})
    tick(w,SIMULATION_TIMESTEP)
    expect(middle.alive).toBe(false);expect(small.alive).toBe(false);expect(large.food).toBe(1);expect(middle.food).toBe(1)
  })
  it('consumes at most one resource per actor per tick and caps intake at two',()=>{
    const w=world(2),[actor,prey]=w.creatures
    Object.assign(actor,{x:.5,y:.5,size:2,sense:.3,aggression:1,food:1});Object.assign(prey,{x:.5,y:.5,size:1});w.food=[food(700,.5,.5)]
    tick(w,SIMULATION_TIMESTEP)
    expect(actor.food).toBe(2);expect(prey.food).toBeLessThanOrEqual(1)
    tick(w,SIMULATION_TIMESTEP);expect(actor.food).toBe(2)
  })
  it('allows a hungry predator to consume a full creature outside sanctuary',()=>{
    const w=world(2),[predator,fullPrey]=w.creatures
    Object.assign(predator,{x:.5,y:.5,size:2,sense:.25,aggression:1,caution:0,food:0})
    Object.assign(fullPrey,{x:.51,y:.5,size:1,food:2,home:false})
    tick(w,SIMULATION_TIMESTEP)
    expect(fullPrey.alive).toBe(false);expect(predator.food).toBe(1)
  })
})

describe('motion',()=>{
  const decision=(c:Creature,targetX:number,targetY:number)=>({id:c.id,targetX,targetY,targetId:null,targetType:'explore' as const,mode:'exploring' as const,memory:c.memory,commitUntil:0,wanderAngle:0,wanderTurn:0})

  it('bounds acceleration and turning while preserving momentum',()=>{
    const w=world(1),c=w.creatures[0],d=decision(c,c.x-1,c.y)
    c.angle=0;c.vx=.01
    const m=proposeMotion(c,d,w.config,[],.1)
    expect(Math.abs(m.angle-c.angle)).toBeLessThanOrEqual(w.config.turnRate*.1+1e-12)
    expect(Math.hypot(m.vx-c.vx,m.vy-c.vy)).toBeLessThanOrEqual(w.config.acceleration*.1/c.size+1e-12)
    expect(m.vx).toBeGreaterThan(-.01)
  })
  it('prevents obstacle penetration and bounds escape',()=>{
    const w=world(1),c=w.creatures[0],o={id:77,x:.5,y:.5,radius:.1}
    Object.assign(c,{x:.39,y:.5,vx:.08,vy:0,angle:0})
    const d=decision(c,.6,.5)
    const m=proposeMotion(c,d,w.config,[o],.5)
    expect(Math.hypot(m.x-o.x,m.y-o.y)).toBeGreaterThanOrEqual(o.radius+.01*c.size-1e-9)
    Object.assign(c,{x:.987,y:.5,vx:.1,vy:0});const edge=proposeMotion(c,d,w.config,[],.5)
    expect(edge.x).toBeLessThanOrEqual(.988);expect(edge.vx).toBeLessThanOrEqual(0)
  })
  it('resolves overlapping max-size clearances independently of obstacle order',()=>{
    const w=world(1),c=w.creatures[0];Object.assign(c,{x:.55,y:.5,size:2.8,vx:0,vy:0,angle:0})
    const obstacles=[{id:2,x:.65,y:.5,radius:.08},{id:1,x:.45,y:.5,radius:.08}]
    const d=decision(c,.55,.5)
    const forward=proposeMotion(c,d,w.config,obstacles,.025),reversed=proposeMotion(c,d,w.config,[...obstacles].reverse(),.025)
    expect(forward).toEqual(reversed)
    for(const o of obstacles)expect(Math.hypot(forward.x-o.x,forward.y-o.y)).toBeGreaterThanOrEqual(o.radius+.01*c.size-1e-8)
  })
  it('rounds a rock when the target is directly behind it',()=>{
    const w=world(1),c=w.creatures[0],o={id:77,x:.5,y:.5,radius:.1},d=decision(c,.7,.5)
    Object.assign(c,{x:.32,y:.5,homeX:.05,homeY:.05,speed:2.8,size:1,angle:0,vx:0,vy:0})
    const clearance=o.radius+.01*c.size;let minimum=Infinity,previousDistance=Math.hypot(c.x-d.targetX,c.y-d.targetY),progress=0
    for(let tick=0;tick<2000;tick++){
      const m=proposeMotion(c,d,w.config,[o],.025);minimum=Math.min(minimum,Math.hypot(m.x-o.x,m.y-o.y))
      const distance=Math.hypot(m.x-d.targetX,m.y-d.targetY);if(distance<previousDistance)progress++
      Object.assign(c,{x:m.x,y:m.y,vx:m.vx,vy:m.vy,angle:m.angle});previousDistance=distance
      if(distance<.025)break
    }
    expect(progress).toBeGreaterThan(40)
    expect(Math.hypot(c.x-d.targetX,c.y-d.targetY)).toBeLessThan(.05)
    expect(minimum).toBeGreaterThanOrEqual(clearance-1e-8)
  })
  it('keeps detours order-independent and mirrors the tangent tie consistently',()=>{
    const w=world(1),c=w.creatures[0],d=decision(c,.7,.46),obstacles=[{id:77,x:.5,y:.5,radius:.1},{id:78,x:.25,y:.8,radius:.05}]
    Object.assign(c,{x:.4,y:.46,homeX:.05,homeY:.05,speed:2.8,size:1,angle:0,vx:0,vy:0})
    const forward=proposeMotion(c,d,w.config,obstacles,.1),reversed=proposeMotion({...c},d,w.config,[...obstacles].reverse(),.1)
    expect(reversed).toEqual(forward)
    expect(Math.abs(forward.y-.46)).toBeGreaterThan(0)
    const mirrored={...c,y:.5-(c.y-.5),angle:-c.angle,vy:-c.vy},mirroredDecision=decision(mirrored,.7,.54)
    const mirroredMotion=proposeMotion(mirrored,mirroredDecision,w.config,[{...obstacles[0],y:.5}],.1)
    expect(mirroredMotion.x).toBeCloseTo(forward.x,12)
    expect(mirroredMotion.y).toBeCloseTo(1-forward.y,12)
    const tied={...c,y:.5},tiedDecision=decision(tied,.7,.5),tieA=proposeMotion(tied,tiedDecision,w.config,[obstacles[0]],.1),tieB=proposeMotion({...tied},tiedDecision,w.config,[{...obstacles[0]}],.1)
    expect(tieA).toEqual(tieB)
    expect(Math.abs(tieA.y-.5)).toBeGreaterThan(0)
  })
  it('leaves no-obstacle motion numerically unchanged',()=>{
    const w=world(1),c=w.creatures[0],d=decision(c,.8,.2)
    Object.assign(c,{x:.36,y:.71,homeX:.05,homeY:.05,angle:-.7,vx:.012,vy:-.008,size:1.4,speed:1.7})
    const expectedAngle=c.angle+Math.max(-w.config.turnRate*.13/Math.sqrt(Math.max(.35,c.size)),Math.min(w.config.turnRate*.13/Math.sqrt(Math.max(.35,c.size)),((Math.atan2(d.targetY-c.y,d.targetX-c.x)-c.angle+Math.PI*3)%(Math.PI*2))-Math.PI))
    const m=proposeMotion(c,d,w.config,[],.13)
    expect(m.angle).toBe(expectedAngle)
    expect(m.x).toBe(c.x+m.vx*.13)
    expect(m.y).toBe(c.y+m.vy*.13)
  })
  it('keeps a chained overlapping detour bounded and clear',()=>{
    const w=world(1),c=w.creatures[0],d=decision(c,.82,.5),obstacles=[{id:1,x:.45,y:.5,radius:.09},{id:2,x:.58,y:.5,radius:.09},{id:3,x:.71,y:.5,radius:.09}]
    Object.assign(c,{x:.3,y:.5,homeX:.05,homeY:.05,speed:2.8,size:1.8,angle:0,vx:0,vy:0})
    const clearance=.01*c.size
    for(let tick=0;tick<1200;tick++){
      const m=proposeMotion(c,d,w.config,obstacles,.05)
      for(const o of obstacles)expect(Math.hypot(m.x-o.x,m.y-o.y)).toBeGreaterThanOrEqual(o.radius+clearance-1e-8)
      expect(m.x).toBeGreaterThanOrEqual(.012);expect(m.x).toBeLessThanOrEqual(.988);expect(m.y).toBeGreaterThanOrEqual(.012);expect(m.y).toBeLessThanOrEqual(.988)
      Object.assign(c,{x:m.x,y:m.y,vx:m.vx,vy:m.vy,angle:m.angle})
      if(Math.hypot(c.x-d.targetX,c.y-d.targetY)<.03)break
    }
    expect(Math.hypot(c.x-d.targetX,c.y-d.targetY)).toBeLessThan(.08)
  })
  it('stress-checks direct and diagonal routes around one obstacle',()=>{
    const cases=[[.32,.5,.7,.5],[.5,.32,.5,.7],[.32,.32,.7,.7],[.68,.5,.3,.5],[.32,.68,.68,.32]] as const
    for(const [startX,startY,targetX,targetY] of cases){
      const w=world(1),c=w.creatures[0],o={id:17,x:.5,y:.5,radius:.1},d=decision(c,targetX,targetY)
      Object.assign(c,{x:startX,y:startY,homeX:.05,homeY:.05,speed:2.8,size:1,angle:Math.atan2(targetY-startY,targetX-startX),vx:0,vy:0})
      const clearance=o.radius+.01*c.size
      for(let tick=0;tick<2400;tick++){
        const m=proposeMotion(c,d,w.config,[o],.025)
        expect(Math.hypot(m.x-o.x,m.y-o.y)).toBeGreaterThanOrEqual(clearance-1e-8)
        Object.assign(c,{x:m.x,y:m.y,vx:m.vx,vy:m.vy,angle:m.angle})
        if(Math.hypot(c.x-targetX,c.y-targetY)<.04)break
      }
      expect(Math.hypot(c.x-targetX,c.y-targetY),`${startX},${startY} -> ${targetX},${targetY}`).toBeLessThan(.08)
    }
  })
})

describe('utility, memory, and commitment',()=>{
  it('aggression favors prey while caution lets danger override it',()=>{
    const w=world(3),[actor,prey,threat]=w.creatures
    Object.assign(actor,{x:.5,y:.5,size:1.5,sense:.25,aggression:1,caution:0})
    Object.assign(prey,{x:.58,y:.5,size:1});Object.assign(threat,{x:.47,y:.5,size:2})
    const bold=decide(actor,w.creatures,[],w.config,0,1)
    actor.caution=1;const cautious=decide(actor,w.creatures,[],w.config,0,1)
    expect(bold.mode).toBe('hunting');expect(cautious.mode).toBe('fleeing')
    actor.aggression=0;actor.caution=0;const foodDecision=decide(actor,[actor,prey],[food(90,.58,.5)],w.config,0,1)
    expect(foodDecision.mode).toBe('foraging')
  })
  it('uses and expires food memory',()=>{
    const w=world(1),c=w.creatures[0];Object.assign(c,{x:.5,y:.5,sense:.2})
    const seen=decide(c,[c],[food(90,.58,.5)],w.config,0,1);c.memory=seen.memory
    const remembered=decide(c,[c],[],w.config,1,2);expect(remembered.targetType).toBe('memory')
    c.memory=remembered.memory;const expired=decide(c,[c],[],w.config,10,3)
    expect(expired.memory.foodX).toBeNull();expect(expired.targetType).toBe('explore')
  })
  it('remembers a threat location briefly after it leaves sight',()=>{
    const w=world(2),[c,threat]=w.creatures;Object.assign(c,{x:.5,y:.5,size:1,sense:.2,caution:1});Object.assign(threat,{x:.55,y:.5,size:2})
    const seen=decide(c,[c,threat],[],w.config,0,1);c.memory=seen.memory
    const remembered=decide(c,[c],[],w.config,.5,2);expect(remembered.memory.threatX).not.toBeNull();expect(remembered.mode).toBe('fleeing')
    c.memory=remembered.memory;expect(decide(c,[c],[],w.config,10,3).memory.threatX).toBeNull()
  })
  it('holds a committed target but urgent return overrides it',()=>{
    const w=world(1),c=w.creatures[0];Object.assign(c,{x:.5,y:.5,sense:.3,targetType:'food',targetId:91,commitUntil:5})
    const held=decide(c,[c],[food(90,.59,.5),food(91,.6,.5)],w.config,1,2)
    expect(held.targetId).toBe(91)
    c.food=2;const safe=decide(c,[c],[],w.config,1,3);expect(safe.mode).toBe('returning')
  })
  it('produces deterministic correlated wandering affected by exploration',()=>{
    const w=world(1),c=w.creatures[0];c.exploration=1
    const a=decide(c,[c],[],w.config,0,20),again=decide(c,[c],[],w.config,0,20)
    expect(a).toEqual(again)
    Object.assign(c,{wanderAngle:a.wanderAngle,wanderTurn:a.wanderTurn});const b=decide(c,[c],[],w.config,.025,21)
    expect(Math.abs(b.wanderAngle-a.wanderAngle)).toBeLessThan(.05);expect(b.wanderAngle).not.toBe(a.wanderAngle)
    const low={...c,id:c.id+100,exploration:0,wanderAngle:0,wanderTurn:.5,memory:{...c.memory}},high={...low,exploration:1}
    const lowDecision=decide(low,[low],[],w.config,0,30),highDecision=decide(high,[high],[],w.config,0,30)
    expect(Math.abs(highDecision.wanderAngle)).toBeGreaterThan(Math.abs(lowDecision.wanderAngle))
  })
})

describe('seeded environment and behavior inheritance',()=>{
  it('reproduces patches, obstacles, and clustered valid food',()=>{
    const cfg={...defaultConfig,seed:501,foodPatchiness:1,foodPatchSpread:.04,initialPopulation:2}
    const a=createWorld(cfg),b=createWorld(cfg);expect(a.environment).toEqual(b.environment);expect(a.food).toEqual(b.food)
    for(const o of a.environment.obstacles){expect(o.x-o.radius).toBeGreaterThan(.1);expect(o.x+o.radius).toBeLessThan(.9)}
    for(const f of a.food){expect(f.x).toBeGreaterThan(0);expect(f.x).toBeLessThan(1);expect(a.environment.obstacles.every(o=>Math.hypot(f.x-o.x,f.y-o.y)>o.radius)).toBe(true);expect(Math.min(...a.environment.patches.map(p=>Math.hypot(f.x-p.x,f.y-p.y)))).toBeLessThan(.1)}
  })
  it('varies seasonal targets and smooths toward them gradually',()=>{
    const cfg={...defaultConfig,seasonAmplitude:.5,seasonLength:8,environmentResponse:.25},w=createWorld(cfg)
    expect(seasonalTarget(cfg,3)).toBeGreaterThan(seasonalTarget(cfg,1));const before=w.environment.foodBudget;advanceFoodBudget(w.environment,cfg,3)
    expect(w.environment.foodBudget).toBeGreaterThan(before);expect(w.environment.foodBudget).toBeLessThan(w.environment.targetFood)
  })
  it('inherits behavior toggles exactly and keeps mutated genes bounded',()=>{
    const disabled=world(1,{mutationRate:1,mutationStrength:.4,mutateAggression:false,mutateCaution:false,mutateExploration:false}),p=disabled.creatures[0]
    Object.assign(p,{food:2,home:true,aggression:.2,caution:.7,exploration:.4});finishGeneration(disabled)
    expect(disabled.creatures.every(c=>c.aggression===.2&&c.caution===.7&&c.exploration===.4)).toBe(true)
    const enabled=world(1,{mutationRate:1,mutationStrength:2}),q=enabled.creatures[0];Object.assign(q,{food:2,home:true});finishGeneration(enabled)
    expect(enabled.creatures.every(c=>[c.aggression,c.caution,c.exploration].every(v=>v>=0&&v<=1))).toBe(true)
  })
  it('allows enabled endpoint behavior genes to mutate into the interior',()=>{
    let zeroMoved=false,oneMoved=false
    for(let seed=1;seed<=80&&(!zeroMoved||!oneMoved);seed++){
      const w=world(1,{seed,mutationRate:1,mutationStrength:.5,mutateSpeed:false,mutateSize:false,mutateSense:false}),p=w.creatures[0]
      Object.assign(p,{food:2,home:true,aggression:0,caution:1,exploration:0});finishGeneration(w)
      const child=w.creatures[1];zeroMoved ||= child.aggression>0||child.exploration>0;oneMoved ||= child.caution<1
    }
    expect(zeroMoved).toBe(true);expect(oneMoved).toBe(true)
  })
})
