/// <reference lib="webworker" />
import {applyIntervention,createWorld,runGeneration,setInspectedIndividual} from './engine'
import {advanceToNextAction,captureNextActionContext,runScheduled,scheduledTicks} from './scheduler'
import type {WorkerCommand,WorkerEvent} from './protocol'
import type {World} from './types'
let world:World|undefined,playing=false,speed=1,last=performance.now(),remainder=0,epoch=0,lastCommandId=0
const emit=(event:WorkerEvent)=>self.postMessage(event)
setInterval(()=>{if(!world||!playing)return;const now=performance.now(),schedule=scheduledTicks(Math.min(.1,(now-last)/1000),speed,remainder);last=now;remainder=schedule.remainder;runScheduled(world,schedule.count);if(!world.creatures.length)playing=false;emit({type:'snapshot',world,epoch,lastCommandId})},50)
self.onmessage=(event:MessageEvent<WorkerCommand>)=>{try{const command=event.data
  if(command.type==='init'||command.type==='reset'){epoch=command.epoch??epoch+1;lastCommandId=0;world=createWorld(command.config);playing=false;remainder=0;emit({type:'snapshot',world,epoch,lastCommandId})}
  else if(command.type==='play'){playing=true;last=performance.now()}
  else if(command.type==='pause')playing=false
  else if(command.type==='step'&&world){playing=false;last=performance.now();remainder=0;const stepContext=captureNextActionContext(world),stepResult=advanceToNextAction(world);emit({type:'snapshot',world,epoch,lastCommandId,stepId:command.stepId,stepResult,stepContext})}
  else if(command.type==='speed')speed=Math.max(.5,Math.min(4,command.speed))
  else if(command.type==='inspect'&&world){setInspectedIndividual(world,command.individualId);emit({type:'snapshot',world,epoch,lastCommandId})}
  else if(command.type==='intervene'&&world){applyIntervention(world,command.kind);lastCommandId=Math.max(lastCommandId,command.commandId??0);emit({type:'snapshot',world,epoch,lastCommandId})}
  else if(command.type==='finish'&&world){playing=false;runGeneration(world);emit({type:'snapshot',world,epoch,lastCommandId})}
}catch(error){emit({type:'error',message:error instanceof Error?error.message:'Simulation worker error',epoch})}}
