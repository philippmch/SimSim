import type {Config,InterventionKind,World} from './types'
export type WorkerCommand={type:'init'|'reset';config:Config;epoch?:number}|{type:'play'|'pause'|'finish'}|{type:'speed';speed:number}|{type:'inspect';individualId:number|null}|{type:'intervene';kind:InterventionKind;commandId?:number}
export type WorkerEvent={type:'snapshot';world:World;epoch:number;lastCommandId?:number}|{type:'error';message:string;epoch:number}
