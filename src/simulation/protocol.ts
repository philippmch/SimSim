import type {Config,World} from './types'
export type WorkerCommand={type:'init'|'reset';config:Config;epoch?:number}|{type:'play'|'pause'|'finish'}|{type:'speed';speed:number}|{type:'inspect';individualId:number|null}
export type WorkerEvent={type:'snapshot';world:World;epoch:number}|{type:'error';message:string;epoch:number}
