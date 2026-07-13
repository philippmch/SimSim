import{afterEach,describe,expect,it,vi}from'vitest'
import{controllerEventIsCurrent,createController,fallbackController}from'./controller'
import{createWorld,defaultConfig}from'./engine'
import type{WorkerCommand,WorkerEvent}from'./protocol'

class FakeWorker{
  static instances:FakeWorker[]=[]
  sent:WorkerCommand[]=[];onmessage:((event:MessageEvent<WorkerEvent>)=>void)|null=null;onerror:(()=>void)|null=null;terminated=false
  constructor(){FakeWorker.instances.push(this)}postMessage(command:WorkerCommand){this.sent.push(command)}terminate(){this.terminated=true}
  emit(data:WorkerEvent){this.onmessage?.({data}as MessageEvent<WorkerEvent>)}fail(){this.onerror?.()}
}
afterEach(()=>{vi.unstubAllGlobals();FakeWorker.instances=[]})

describe('controller failover and ordering',()=>{
  it('starts fallback from the latest world snapshot without resetting progress',()=>{const world=createWorld({...defaultConfig,seed:78});world.generation=7;world.dayTime=4.25;world.creatures[0].food=1;let observed=world;const controller=fallbackController(world,value=>{observed=value});expect(observed.generation).toBe(7);expect(observed.dayTime).toBe(4.25);expect(observed.creatures[0].food).toBe(1);expect(observed).not.toBe(world);controller.dispose()})
  it('requires both current worker session and run epoch',()=>{expect(controllerEventIsCurrent(2,2,4,4,false)).toBe(true);expect(controllerEventIsCurrent(1,2,4,4,false)).toBe(false);expect(controllerEventIsCurrent(2,2,3,4,false)).toBe(false);expect(controllerEventIsCurrent(2,2,4,4,true)).toBe(false)})
  it('ignores a queued pre-reset snapshot and preserves only the new epoch on failover',()=>{
    vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker);const config={...defaultConfig,seed:101};let observed=createWorld(config),fallbacks=0
    const controller=createController(config,world=>{observed=world},()=>fallbacks++),worker=FakeWorker.instances[0]
    expect(worker.sent[0]).toMatchObject({type:'init',epoch:1})
    const first=createWorld(config);worker.emit({type:'snapshot',world:first,epoch:1})
    const resetConfig={...config,seed:202};controller.send({type:'reset',config:resetConfig});expect(worker.sent.at(-1)).toMatchObject({type:'reset',epoch:2})
    const stale=createWorld(config);stale.generation=99;worker.emit({type:'snapshot',world:stale,epoch:1});expect(observed.generation).not.toBe(99)
    const current=createWorld(resetConfig);current.generation=4;worker.emit({type:'snapshot',world:current,epoch:2});expect(observed.generation).toBe(4)
    worker.fail();expect(fallbacks).toBe(1);expect(observed.generation).toBe(4);expect(observed.config.seed).toBe(202)
    worker.emit({type:'snapshot',world:stale,epoch:1});expect(observed.generation).toBe(4);controller.dispose()
  })
})
