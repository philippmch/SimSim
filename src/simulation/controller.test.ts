import{afterEach,describe,expect,it,vi}from'vitest'
import{controllerEventIsCurrent,createController,fallbackController}from'./controller'
import{applyIntervention,createWorld,defaultConfig,finishGeneration}from'./engine'
import type{WorkerCommand,WorkerEvent}from'./protocol'

class FakeWorker{
  static instances:FakeWorker[]=[]
  sent:WorkerCommand[]=[];onmessage:((event:MessageEvent<WorkerEvent>)=>void)|null=null;onerror:(()=>void)|null=null;terminated=false
  constructor(){FakeWorker.instances.push(this)}postMessage(command:WorkerCommand){this.sent.push(command)}terminate(){this.terminated=true}
  emit(data:WorkerEvent){this.onmessage?.({data}as MessageEvent<WorkerEvent>)}fail(){this.onerror?.()}
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();FakeWorker.instances=[]})

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
  it('keeps failover paused after resetting a previously playing worker',()=>{
    vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker)
    const config={...defaultConfig,seed:404};let observed=createWorld(config)
    const controller=createController(config,world=>{observed=world},()=>{}),worker=FakeWorker.instances[0]
    controller.send({type:'play'})
    const resetConfig={...config,seed:505};controller.send({type:'reset',config:resetConfig})
    worker.fail()
    expect(controller.mode).toBe('fallback')
    vi.advanceTimersByTime(250)
    expect(observed.dayTime).toBe(0)
    controller.dispose()
  })
  it('tags intervention commands so worker snapshots can acknowledge them',()=>{
    vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker);const controller=createController(defaultConfig,()=>{},()=>{}),worker=FakeWorker.instances[0]
    controller.send({type:'intervene',kind:'resource-bloom'})
    expect(worker.sent.at(-1)).toEqual({type:'intervene',kind:'resource-bloom',commandId:1})
    controller.dispose()
  })
  it('replays only unacknowledged interventions during worker failover',()=>{
    vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker);let observed=createWorld(defaultConfig)
    const controller=createController(defaultConfig,world=>{observed=structuredClone(world)},()=>{}),worker=FakeWorker.instances[0]
    const baseline=createWorld(defaultConfig);worker.emit({type:'snapshot',world:baseline,epoch:1,lastCommandId:0})
    controller.send({type:'intervene',kind:'resource-bloom'})
    worker.fail()
    expect(observed.events).toHaveLength(1)
    expect(observed.events[0].kind).toBe('resource-bloom')
    controller.dispose()
  })
  it('does not replay an intervention acknowledged by the latest worker snapshot',()=>{
    vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker);let observed=createWorld(defaultConfig)
    const controller=createController(defaultConfig,world=>{observed=structuredClone(world)},()=>{}),worker=FakeWorker.instances[0]
    const applied=createWorld(defaultConfig);applyIntervention(applied,'resource-bloom')
    controller.send({type:'intervene',kind:'resource-bloom'})
    worker.emit({type:'snapshot',world:applied,epoch:1,lastCommandId:1})
    worker.fail()
    expect(observed.events).toHaveLength(1)
    controller.dispose()
  })
  it('applies intervention commands and emits snapshots in fallback mode',()=>{
    const snapshots:ReturnType<typeof createWorld>[]=[]
    const controller=fallbackController({...defaultConfig,seed:303},world=>snapshots.push(structuredClone(world)))
    const before=snapshots.at(-1)!.food.length
    controller.send({type:'intervene',kind:'resource-bloom'})
    expect(snapshots.at(-1)!.food.length).toBeGreaterThan(before)
    expect(snapshots.at(-1)!.events.at(-1)).toMatchObject({kind:'resource-bloom'})
    controller.dispose()
  })
  it('advances one deterministic next action in fallback mode',()=>{
    const snapshots:ReturnType<typeof createWorld>[]=[]
    const controller=fallbackController({...defaultConfig,seed:304,initialPopulation:1,foodPerDay:0},world=>snapshots.push(structuredClone(world)))
    const before=snapshots.at(-1)!
    controller.send({type:'step'})
    const after=snapshots.at(-1)!
    expect(after.tickIndex).toBe(before.tickIndex+1)
    expect(after.dayTime).toBeCloseTo(before.dayTime+.025)
    expect(after.creatures[0].reactionWindow).toBe(0)
    controller.dispose()
  })
  it('detaches every fallback snapshot while preserving action metadata and prior state',()=>{
    vi.useFakeTimers()
    const source=createWorld({...defaultConfig,seed:306,initialPopulation:1,dayLength:5,foodPerDay:8})
    finishGeneration(source)
    source.events.push({generation:source.generation,day:0,kind:'resource-bloom',summary:'Seed event',count:1})
    const snapshots:ReturnType<typeof createWorld>[]=[],metas:unknown[]=[]
    const controller=fallbackController(source,(world,meta)=>{snapshots.push(world);metas.push(meta)})
    const initial=snapshots[0],initialCreature=initial.creatures[0],initialFood=initial.food[0],initialPatch=initial.environment.patches[0],initialHistory=initial.history[0],initialEvent=initial.events[0],initialLedger=initial.ledger[0]
    const initialValues={generation:initial.generation,dayTime:initial.dayTime,creatureSpeed:initialCreature?.speed,foodX:initialFood?.x,patchStock:initialPatch?.stock,historyPopulation:initialHistory?.population,eventSummary:initialEvent?.summary,ledgerPopulation:initialLedger?.startPopulation}

    controller.send({type:'step',stepId:42})
    const afterStep=snapshots.at(-1)!
    expect(metas.at(-1)).toMatchObject({stepId:42,stepResult:{ticks:expect.any(Number),stop:expect.any(String)}})
    controller.send({type:'inspect',individualId:afterStep.creatures[0]?.individualId??null})
    controller.send({type:'intervene',kind:'resource-bloom'})
    controller.send({type:'play'})
    const beforeTimer=snapshots.length
    vi.advanceTimersByTime(50)
    expect(snapshots.length).toBeGreaterThan(beforeTimer)
    controller.send({type:'pause'})
    controller.send({type:'finish'})
    controller.send({type:'reset',config:{...defaultConfig,seed:307,initialPopulation:1,dayLength:5,foodPerDay:8}})
    expect(snapshots.length).toBeGreaterThan(6)

    for(let index=0;index<snapshots.length-1;index++){
      const previous=snapshots[index],next=snapshots[index+1]
      expect(next).not.toBe(previous)
      expect(next.config).not.toBe(previous.config)
      expect(next.creatures).not.toBe(previous.creatures)
      expect(next.food).not.toBe(previous.food)
      expect(next.environment).not.toBe(previous.environment)
      expect(next.environment.patches).not.toBe(previous.environment.patches)
      expect(next.history).not.toBe(previous.history)
      expect(next.events).not.toBe(previous.events)
      expect(next.ledger).not.toBe(previous.ledger)
      if(previous.creatures[0]&&next.creatures[0]){
        expect(next.creatures[0]).not.toBe(previous.creatures[0])
        expect(next.creatures[0].memory).not.toBe(previous.creatures[0].memory)
      }
      if(previous.food[0]&&next.food[0])expect(next.food[0]).not.toBe(previous.food[0])
      if(previous.environment.patches[0]&&next.environment.patches[0])expect(next.environment.patches[0]).not.toBe(previous.environment.patches[0])
      if(previous.history[0]&&next.history[0])expect(next.history[0]).not.toBe(previous.history[0])
      if(previous.events[0]&&next.events[0])expect(next.events[0]).not.toBe(previous.events[0])
      if(previous.ledger[0]&&next.ledger[0])expect(next.ledger[0]).not.toBe(previous.ledger[0])
    }

    expect(initial.generation).toBe(initialValues.generation)
    expect(initial.dayTime).toBe(initialValues.dayTime)
    expect(initialCreature?.speed).toBe(initialValues.creatureSpeed)
    expect(initialFood?.x).toBe(initialValues.foodX)
    expect(initialPatch?.stock).toBe(initialValues.patchStock)
    expect(initialHistory?.population).toBe(initialValues.historyPopulation)
    expect(initialEvent?.summary).toBe(initialValues.eventSummary)
    expect(initialLedger?.startPopulation).toBe(initialValues.ledgerPopulation)
    controller.dispose()
  })
  it('does not let a caller mutate fallback internals through a delivered snapshot',()=>{
    const config={...defaultConfig,seed:308,initialPopulation:2,foodPerDay:8}
    const subjectSnapshots:ReturnType<typeof createWorld>[]=[],controlSnapshots:ReturnType<typeof createWorld>[]=[]
    const subject=fallbackController(config,world=>subjectSnapshots.push(world)),control=fallbackController(config,world=>controlSnapshots.push(world))
    const delivered=subjectSnapshots[0]
    delivered.config.seed=9999999
    delivered.creatures[0].speed=999
    delivered.creatures[0].memory.foodX=999
    delivered.food[0].x=999
    delivered.environment.patches[0].stock=999
    delivered.history[0].population=999
    delivered.events.push({generation:99,day:99,kind:'drought',summary:'Caller mutation',count:99})
    delivered.ledger.push(delivered.ledger[0]??({} as never))
    delivered.creatures.length=0
    delivered.food.length=0
    subject.send({type:'step',stepId:1})
    control.send({type:'step',stepId:1})
    expect(subjectSnapshots.at(-1)).toEqual(controlSnapshots.at(-1))
    expect(subjectSnapshots.at(-1)!.config.seed).toBe(config.seed)
    subject.dispose()
    control.dispose()
  })
  it('forwards next action to the worker and keeps failover paused',()=>{
    vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker)
    let observed=createWorld({...defaultConfig,seed:305,initialPopulation:1,foodPerDay:0}),receivedStepId:number|undefined
    const controller=createController(observed.config,(world,meta)=>{observed=world;receivedStepId=meta?.stepId},()=>{}),worker=FakeWorker.instances[0]
    const latest=createWorld({...defaultConfig,seed:305,initialPopulation:1,foodPerDay:0})
    worker.emit({type:'snapshot',world:latest,epoch:1,lastCommandId:0})
    controller.send({type:'play'})
    controller.send({type:'step',stepId:1})
    expect(worker.sent.at(-1)).toEqual({type:'step',stepId:1})
    worker.emit({type:'snapshot',world:latest,epoch:1,lastCommandId:0,stepId:1,stepResult:{ticks:1,stop:'beat'}})
    expect(receivedStepId).toBe(1)
    worker.fail()
    expect(controller.mode).toBe('fallback')
    const before=observed.dayTime
    vi.advanceTimersByTime(250)
    expect(observed.dayTime).toBe(before)
    controller.dispose()
  })
  it('invokes fallback before any worker step result when the worker fails',()=>{
    vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker)
    let fallbacks=0,stepResults=0
    const controller=createController(defaultConfig,(_world,meta)=>{if(meta?.stepResult)stepResults++},()=>fallbacks++),worker=FakeWorker.instances[0]
    controller.send({type:'step',stepId:9})
    worker.fail()
    expect(fallbacks).toBe(1)
    expect(stepResults).toBe(0)
    expect(controller.mode).toBe('fallback')
    controller.dispose()
  })
})
