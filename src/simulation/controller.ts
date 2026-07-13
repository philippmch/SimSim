import {createWorld,runGeneration} from './engine'
import {runScheduled,scheduledTicks} from './scheduler'
import type {WorkerCommand,WorkerEvent} from './protocol'
import type {Config,World} from './types'
export interface SimulationController{send(command:WorkerCommand):void;dispose():void;readonly mode:'worker'|'fallback'}

export function controllerEventIsCurrent(eventToken:number,currentToken:number,eventEpoch:number,currentEpoch:number,disposed:boolean){return!disposed&&eventToken===currentToken&&eventEpoch===currentEpoch}
export function fallbackController(initial:Config|World,onSnapshot:(world:World)=>void):SimulationController{
  let world='creatures'in initial?structuredClone(initial):createWorld(initial),playing=false,speed=1,last=performance.now(),remainder=0
  const timer=setInterval(()=>{if(!playing)return;const now=performance.now(),s=scheduledTicks(Math.min(.1,(now-last)/1000),speed,remainder);last=now;remainder=s.remainder;runScheduled(world,s.count);if(!world.creatures.length)playing=false;onSnapshot({...world})},50)
  onSnapshot(world)
  return{mode:'fallback',send(command){if(command.type==='init'||command.type==='reset'){world=createWorld(command.config);playing=false;remainder=0;onSnapshot(world)}else if(command.type==='play'){playing=true;last=performance.now()}else if(command.type==='pause')playing=false;else if(command.type==='speed')speed=Math.max(.5,Math.min(4,command.speed));else if(command.type==='finish'){playing=false;runGeneration(world);onSnapshot({...world})}},dispose(){clearInterval(timer)}}
}

export function createController(config:Config,onSnapshot:(world:World)=>void,onFallback:()=>void):SimulationController{
  let active:SimulationController|undefined,disposed=false,currentConfig=config,latestWorld:World|undefined,playing=false,speed=1,session=0,runEpoch=0
  const switchToFallback=()=>{if(disposed||active?.mode==='fallback')return;session++;active?.dispose();onFallback();active=fallbackController(latestWorld??currentConfig,onSnapshot);active.send({type:'speed',speed});if(playing&&(latestWorld?.creatures.length??1)>0)active.send({type:'play'})}
  if(typeof Worker!=='undefined')try{
    const token=++session,worker=new Worker(new URL('./simulation.worker.ts',import.meta.url),{type:'module'})
    active={mode:'worker',send:c=>worker.postMessage(c),dispose:()=>worker.terminate()}
    worker.onmessage=(event:MessageEvent<WorkerEvent>)=>{if(!controllerEventIsCurrent(token,session,event.data.epoch,runEpoch,disposed))return;if(event.data.type==='snapshot'){latestWorld=event.data.world;onSnapshot(event.data.world)}else switchToFallback()}
    worker.onerror=()=>{if(!disposed&&token===session)switchToFallback()};worker.postMessage({type:'init',config,epoch:++runEpoch} satisfies WorkerCommand)
  }catch{switchToFallback()}
  if(!active){onFallback();active=fallbackController(config,onSnapshot)}
  return{get mode(){return active!.mode},send(command){if(command.type==='init'||command.type==='reset'){currentConfig=command.config;latestWorld=undefined;runEpoch++;active!.send({...command,epoch:runEpoch});return}if(command.type==='play')playing=true;if(command.type==='pause'||command.type==='finish')playing=false;if(command.type==='speed')speed=command.speed;active!.send(command)},dispose(){disposed=true;session++;active!.dispose()}}
}
