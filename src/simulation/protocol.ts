import type {Config,InterventionKind,World} from './types'
import type {NextActionContext,NextActionResult} from './scheduler'
export type WorkerCommand={type:'init'|'reset';config:Config;epoch?:number}|{type:'play'|'pause'}|{type:'finish';finishId:number}|{type:'step';stepId?:number}|{type:'speed';speed:number}|{type:'inspect';individualId:number|null}|{type:'intervene';kind:InterventionKind;commandId?:number}
export type WorkerEvent={type:'snapshot';world:World;epoch:number;lastCommandId?:number;finishId?:number;stepId?:number;stepResult?:NextActionResult;stepContext?:NextActionContext}|{type:'error';message:string;epoch:number}
