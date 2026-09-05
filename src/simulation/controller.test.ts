import{afterEach,describe,expect,it,vi}from'vitest'
import{controllerEventIsCurrent,createController,fallbackController as lazyFallbackController}from'./controller'
import{fallbackController}from'./fallbackController'
import{applyIntervention,createWorld,defaultConfig,finishGeneration,setInspectedIndividual}from'./engine'
import type{WorkerCommand,WorkerEvent}from'./protocol'

class FakeWorker{
  static instances:FakeWorker[]=[]
  sent:WorkerCommand[]=[];onmessage:((event:MessageEvent<WorkerEvent>)=>void)|null=null;onerror:(()=>void)|null=null;terminated=false
  constructor(){FakeWorker.instances.push(this)}postMessage(command:WorkerCommand){this.sent.push(command)}terminate(){this.terminated=true}
  emit(data:WorkerEvent){this.onmessage?.({data}as MessageEvent<WorkerEvent>)}fail(){this.onerror?.()}
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();FakeWorker.instances=[]})
const settleLazyFallback=()=>vi.dynamicImportSettled()

describe('controller failover and ordering',()=>{
  it('starts fallback from the latest world snapshot without resetting progress',()=>{const world=createWorld({...defaultConfig,seed:78});world.generation=7;world.dayTime=4.25;world.creatures[0].food=1;let observed=world;const controller=fallbackController(world,value=>{observed=value});expect(observed.generation).toBe(7);expect(observed.dayTime).toBe(4.25);expect(observed.creatures[0].food).toBe(1);expect(observed).not.toBe(world);controller.dispose()})
  it('lazily starts fallback and queues every command issued before it is ready',async()=>{
    vi.stubGlobal('Worker',undefined)
    const initial={...defaultConfig,seed:401,initialPopulation:2,foodPerDay:0},reset={...initial,seed:402}
    const snapshots:ReturnType<typeof createWorld>[]=[],metas:unknown[]=[],fallbacks:number[]=[]
    const controller=createController(initial, (world,meta)=>{snapshots.push(world);metas.push(meta)},()=>fallbacks.push(1))
    expect(controller.mode).toBe('fallback')
    expect(fallbacks).toHaveLength(1)
    expect(snapshots).toHaveLength(0)
    controller.send({type:'speed',speed:2})
    controller.send({type:'play'})
    controller.send({type:'pause'})
    controller.send({type:'reset',config:reset})
    controller.send({type:'inspect',individualId:null})
    controller.send({type:'intervene',kind:'resource-bloom'})
    controller.send({type:'step',stepId:401})
    controller.send({type:'finish',finishId:402})
    expect(snapshots).toHaveLength(0)
    await settleLazyFallback()
    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots.at(-1)?.config.seed).toBe(reset.seed)
    expect(metas.some(meta=>meta&&typeof meta==='object'&&'stepId'in meta&&(meta as {stepId?:number}).stepId===401)).toBe(true)
    expect(metas.some(meta=>meta&&typeof meta==='object'&&'finishId'in meta&&(meta as {finishId?:number}).finishId===402)).toBe(true)
    expect(snapshots.at(-1)?.events.filter(event=>event.kind==='resource-bloom')).toHaveLength(1)
    controller.dispose()
  })
  it('keeps direct fallback compatibility as a lazy synchronous facade',async()=>{
    const snapshots:ReturnType<typeof createWorld>[]=[]
    const controller=lazyFallbackController({...defaultConfig,seed:403},world=>snapshots.push(world))
    expect(controller.mode).toBe('fallback')
    expect(snapshots).toHaveLength(0)
    controller.send({type:'intervene',kind:'resource-bloom'})
    await settleLazyFallback()
    expect(snapshots.at(-1)?.events.at(-1)?.kind).toBe('resource-bloom')
    controller.dispose()
  })
  it('cleans the fallback interval when initial snapshot delivery fails',()=>{
    vi.useFakeTimers()
    const failure=new Error('snapshot consumer failed')
    expect(()=>fallbackController(defaultConfig,()=>{throw failure})).toThrow(failure)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('enters a terminal no-op state when the lazy fallback module cannot load',async()=>{
    vi.resetModules()
    vi.doMock('./fallbackController',()=>{throw new Error('fallback chunk unavailable')})
    const error=vi.spyOn(console,'error').mockImplementation(()=>{})
    vi.stubGlobal('Worker',undefined)
    try {
      const {createController:isolatedCreateController}=await import('./controller')
      const snapshots:ReturnType<typeof createWorld>[]=[],fallbacks:number[]=[]
      const controller=isolatedCreateController(defaultConfig,world=>snapshots.push(world),()=>fallbacks.push(1))
      controller.send({type:'intervene',kind:'resource-bloom'})
      await settleLazyFallback()
      controller.send({type:'step',stepId:999})
      controller.send({type:'intervene',kind:'drought'})
      expect(error).toHaveBeenCalledWith('[simulation] fallback module load failed',expect.any(Error))
      expect(fallbacks).toHaveLength(1)
      expect(snapshots).toHaveLength(0)
      controller.dispose()
    } finally {
      error.mockRestore()
      vi.doUnmock('./fallbackController')
      vi.resetModules()
    }
  })
  it('cleans up and terminally stops when fallback replay throws',async()=>{
    vi.resetModules()
    const replayFailure=new Error('replay failed'),send=vi.fn((command:WorkerCommand)=>{
      if(command.type==='intervene') throw replayFailure
    }),dispose=vi.fn()
    vi.doMock('./fallbackController',()=>({fallbackController:vi.fn(()=>({mode:'fallback',send,dispose}))}))
    const error=vi.spyOn(console,'error').mockImplementation(()=>{})
    vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker)
    try {
      const {createController:isolatedCreateController}=await import('./controller')
      const controller=isolatedCreateController(defaultConfig,()=>{},()=>{}),worker=FakeWorker.instances.at(-1)!
      worker.emit({type:'snapshot',world:createWorld(defaultConfig),epoch:1,lastCommandId:0})
      controller.send({type:'intervene',kind:'resource-bloom'})
      worker.fail()
      await settleLazyFallback()
      expect(send).toHaveBeenCalledWith({type:'speed',speed:1})
      expect(send).toHaveBeenCalledWith({type:'intervene',kind:'resource-bloom'})
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledWith('[simulation] fallback initialization failed',replayFailure)
      const calls=send.mock.calls.length
      controller.send({type:'step',stepId:1000})
      controller.send({type:'intervene',kind:'drought'})
      expect(send).toHaveBeenCalledTimes(calls)
      controller.dispose()
    } finally {
      error.mockRestore()
      vi.doUnmock('./fallbackController')
      vi.resetModules()
    }
  })
  it('requires both current worker session and run epoch',()=>{expect(controllerEventIsCurrent(2,2,4,4,false)).toBe(true);expect(controllerEventIsCurrent(1,2,4,4,false)).toBe(false);expect(controllerEventIsCurrent(2,2,3,4,false)).toBe(false);expect(controllerEventIsCurrent(2,2,4,4,true)).toBe(false)})
  it('enters fallback once for a worker error event and replays post-error commands in order',async()=>{
    vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker)
    const snapshots:ReturnType<typeof createWorld>[]=[],fallbacks:number[]=[]
    const controller=createController({...defaultConfig,seed:404},world=>snapshots.push(structuredClone(world)),()=>fallbacks.push(1)),worker=FakeWorker.instances[0]
    const latest=createWorld({...defaultConfig,seed:404})
    worker.emit({type:'snapshot',world:latest,epoch:1,lastCommandId:0})
    controller.send({type:'intervene',kind:'resource-bloom'})
    worker.emit({type:'error',message:'worker failed',epoch:1})
    controller.send({type:'intervene',kind:'drought'})
    worker.fail()
    expect(controller.mode).toBe('fallback')
    expect(fallbacks).toHaveLength(1)
    await settleLazyFallback()
    const events=snapshots.at(-1)?.events.slice(-2).map(event=>event.kind)
    expect(events).toEqual(['resource-bloom','drought'])
    expect(snapshots.filter(world=>world.events.length>0)).toHaveLength(2)
    controller.dispose()
  })
  it('ignores a disposed lazy fallback completion',async()=>{
    vi.stubGlobal('Worker',undefined)
    const snapshots:ReturnType<typeof createWorld>[]=[],fallbacks:number[]=[]
    const controller=createController(defaultConfig,world=>snapshots.push(world),()=>fallbacks.push(1))
    controller.dispose()
    await settleLazyFallback()
    expect(fallbacks).toHaveLength(1)
    expect(snapshots).toHaveLength(0)
  })
  it('ignores a queued pre-reset snapshot and preserves only the new epoch on failover',async()=>{
    vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker);const config={...defaultConfig,seed:101};let observed=createWorld(config),fallbacks=0
    const controller=createController(config,world=>{observed=world},()=>fallbacks++),worker=FakeWorker.instances[0]
    expect(worker.sent[0]).toMatchObject({type:'init',epoch:1})
    const first=createWorld(config);worker.emit({type:'snapshot',world:first,epoch:1})
    const resetConfig={...config,seed:202};controller.send({type:'reset',config:resetConfig});expect(worker.sent.at(-1)).toMatchObject({type:'reset',epoch:2})
    const stale=createWorld(config);stale.generation=99;worker.emit({type:'snapshot',world:stale,epoch:1});expect(observed.generation).not.toBe(99)
    const current=createWorld(resetConfig);current.generation=4;worker.emit({type:'snapshot',world:current,epoch:2});expect(observed.generation).toBe(4)
    worker.fail();expect(fallbacks).toBe(1);await settleLazyFallback();expect(observed.generation).toBe(4);expect(observed.config.seed).toBe(202)
    worker.emit({type:'snapshot',world:stale,epoch:1});expect(observed.generation).toBe(4);controller.dispose()
  })
  it('keeps failover paused after resetting a previously playing worker',async()=>{
    vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker)
    const config={...defaultConfig,seed:404};let observed=createWorld(config)
    const controller=createController(config,world=>{observed=world},()=>{}),worker=FakeWorker.instances[0]
    controller.send({type:'play'})
    const resetConfig={...config,seed:505};controller.send({type:'reset',config:resetConfig})
    worker.fail()
    expect(controller.mode).toBe('fallback')
    await settleLazyFallback()
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
  it('replays only unacknowledged interventions during worker failover',async()=>{
    vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker);let observed=createWorld(defaultConfig)
    const controller=createController(defaultConfig,world=>{observed=structuredClone(world)},()=>{}),worker=FakeWorker.instances[0]
    const baseline=createWorld(defaultConfig);worker.emit({type:'snapshot',world:baseline,epoch:1,lastCommandId:0})
    controller.send({type:'intervene',kind:'resource-bloom'})
    worker.fail()
    await settleLazyFallback()
    expect(observed.events).toHaveLength(1)
    expect(observed.events[0].kind).toBe('resource-bloom')
    controller.dispose()
  })
  it('does not replay an intervention acknowledged by the latest worker snapshot',async()=>{
    vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker);let observed=createWorld(defaultConfig)
    const controller=createController(defaultConfig,world=>{observed=structuredClone(world)},()=>{}),worker=FakeWorker.instances[0]
    const applied=createWorld(defaultConfig);applyIntervention(applied,'resource-bloom')
    controller.send({type:'intervene',kind:'resource-bloom'})
    worker.emit({type:'snapshot',world:applied,epoch:1,lastCommandId:1})
    worker.fail()
    await settleLazyFallback()
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
  it('correlates only the fallback snapshot caused by an explicit finish',()=>{
    const snapshots:ReturnType<typeof createWorld>[]=[],metas:unknown[]=[]
    const controller=fallbackController({...defaultConfig,seed:310,initialPopulation:2},(world,meta)=>{snapshots.push(world);metas.push(meta)})
    expect(metas.at(-1)).toBeUndefined()
    controller.send({type:'finish',finishId:73})
    expect(snapshots.at(-1)!.ledger.at(-1)?.generation).toBe(1)
    expect(metas.at(-1)).toEqual({finishId:73})
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
  it('captures fallback step context from its internal world before advancing',()=>{
    const source=createWorld({...defaultConfig,seed:309,initialPopulation:2,foodPerDay:0})
    const selected=source.creatures[0]
    setInspectedIndividual(source,selected.individualId)
    const snapshots:ReturnType<typeof createWorld>[]=[],metas:unknown[]=[]
    const controller=fallbackController(source,(world,meta)=>{snapshots.push(world);metas.push(meta)})
    snapshots[0].creatures[0].home=true
    controller.send({type:'step',stepId:43})
    expect(metas.at(-1)).toMatchObject({stepId:43,stepContext:{selectedIndividualId:selected.individualId,selectedWasActive:true}})
    expect((metas.at(-1) as {stepResult?:{activity?:unknown}}).stepResult?.activity).toEqual({startSequence:0,endSequence:0,recordedCount:0,sequenceReset:false})
    controller.dispose()
  })
  it('keeps fallback step activity metadata primitive and detached',()=>{
    const source=createWorld({...defaultConfig,seed:311,initialPopulation:2,foodPerDay:0}),selected=source.creatures[0]
    setInspectedIndividual(source,selected.individualId)
    Object.assign(selected,{x:selected.homeX,y:selected.homeY,returning:true,mode:'returning'})
    const metas:unknown[]=[]
    const controller=fallbackController(source,(_world,meta)=>metas.push(meta))

    controller.send({type:'step',stepId:1})
    const first=metas.at(-1) as {stepResult:{activity:{startSequence:number;endSequence:number;recordedCount:number;sequenceReset:boolean}}}
    expect(first.stepResult.activity).toEqual({startSequence:0,endSequence:1,recordedCount:1,sequenceReset:false})
    first.stepResult.activity.startSequence=999
    first.stepResult.activity.endSequence=999
    first.stepResult.activity.recordedCount=999
    first.stepResult.activity.sequenceReset=true

    controller.send({type:'step',stepId:2})
    const second=metas.at(-1) as {stepResult:{activity:{startSequence:number;endSequence:number;recordedCount:number;sequenceReset:boolean}}}
    expect(second.stepResult.activity.startSequence).toBe(1)
    expect(second.stepResult.activity.sequenceReset).toBe(false)
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
    controller.send({type:'finish',finishId:5})
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
  it('forwards next action to the worker and keeps failover paused',async()=>{
    vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker)
    let observed=createWorld({...defaultConfig,seed:305,initialPopulation:1,foodPerDay:0}),receivedStepId:number|undefined,receivedActivity:unknown
    const controller=createController(observed.config,(world,meta)=>{observed=world;receivedStepId=meta?.stepId;receivedActivity=meta?.stepResult?.activity},()=>{}),worker=FakeWorker.instances[0]
    const latest=createWorld({...defaultConfig,seed:305,initialPopulation:1,foodPerDay:0})
    worker.emit({type:'snapshot',world:latest,epoch:1,lastCommandId:0})
    controller.send({type:'play'})
    controller.send({type:'step',stepId:1})
    expect(worker.sent.at(-1)).toEqual({type:'step',stepId:1})
    const activity={startSequence:4,endSequence:6,recordedCount:2,sequenceReset:false}
    worker.emit({type:'snapshot',world:latest,epoch:1,lastCommandId:0,stepId:1,stepResult:{ticks:1,stop:'beat',activity}})
    expect(receivedStepId).toBe(1)
    expect(receivedActivity).toEqual(activity)
    worker.fail()
    expect(controller.mode).toBe('fallback')
    await settleLazyFallback()
    const before=observed.dayTime
    vi.advanceTimersByTime(250)
    expect(observed.dayTime).toBe(before)
    controller.dispose()
  })
  it('forwards a worker finish acknowledgement without tagging a queued autoplay snapshot',()=>{
    vi.stubGlobal('Worker',FakeWorker as unknown as typeof Worker)
    const metas:unknown[]=[]
    const controller=createController(defaultConfig,(_world,meta)=>metas.push(meta),()=>{}),worker=FakeWorker.instances[0]
    const queuedAutoplay=createWorld(defaultConfig);finishGeneration(queuedAutoplay)
    worker.emit({type:'snapshot',world:queuedAutoplay,epoch:1,lastCommandId:0})
    expect(metas.at(-1)).toBeUndefined()
    controller.send({type:'finish',finishId:74})
    expect(worker.sent.at(-1)).toEqual({type:'finish',finishId:74})
    const acknowledged=structuredClone(queuedAutoplay);finishGeneration(acknowledged)
    worker.emit({type:'snapshot',world:acknowledged,epoch:1,lastCommandId:0,finishId:74})
    expect(metas.at(-1)).toMatchObject({finishId:74})
    expect(acknowledged.ledger.at(-1)?.generation).toBe(2)
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
