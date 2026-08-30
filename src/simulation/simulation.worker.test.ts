import {afterEach,describe,expect,it,vi} from 'vitest'
import {defaultConfig} from './engine'
import type {WorkerCommand,WorkerEvent} from './protocol'

type WorkerScope={onmessage:((event:MessageEvent<WorkerCommand>)=>void)|null;postMessage:(event:WorkerEvent)=>void}
type Snapshot=Extract<WorkerEvent,{type:'snapshot'}>
const snapshot=(event:WorkerEvent|undefined):Snapshot=>{if(!event||event.type!=='snapshot')throw new Error('Expected a worker snapshot');return event}

afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals()})

describe('simulation worker transport',()=>{
  it('runs init/play/step, reports the result, and stays paused after stepping',async()=>{
    vi.useFakeTimers({toFake:['setInterval','clearInterval','Date','performance']})
    vi.resetModules()
    const messages:WorkerEvent[]=[]
    const scope:WorkerScope={onmessage:null,postMessage:event=>messages.push(structuredClone(event))}
    vi.stubGlobal('self',scope)
    await import('./simulation.worker')
    const send=(command:WorkerCommand)=>scope.onmessage?.({data:command}as MessageEvent<WorkerCommand>)

    const config={...defaultConfig,seed:511,initialPopulation:2,foodPerDay:0}
    send({type:'init',config,epoch:7})
    expect(messages).toHaveLength(1)
    const initial=snapshot(messages[0])
    expect(initial).toMatchObject({type:'snapshot',epoch:7,lastCommandId:0})
    const initialTick=initial.world.tickIndex
    const selectedIndividualId=initial.world.creatures[0].individualId
    send({type:'inspect',individualId:selectedIndividualId})
    const inspected=snapshot(messages.at(-1))
    inspected.world.creatures[0].home=true

    send({type:'play'})
    vi.advanceTimersByTime(100)
    expect(messages.length).toBeGreaterThan(1)
    expect(snapshot(messages.at(-1)).world.tickIndex).toBeGreaterThan(initialTick)

    send({type:'step',stepId:1})
    const stepped=snapshot(messages.at(-1))
    expect(stepped).toMatchObject({type:'snapshot',epoch:7,lastCommandId:0,stepId:1,stepResult:{stop:'beat'},stepContext:{selectedIndividualId,selectedWasActive:true}})
    expect(stepped.world.tickIndex).toBeGreaterThan(initialTick)
    const messageCount=messages.length,steppedTick=stepped.world.tickIndex
    vi.advanceTimersByTime(250)
    expect(messages).toHaveLength(messageCount)
    expect(snapshot(messages.at(-1)).world.tickIndex).toBe(steppedTick)

    const boundaryConfig={...defaultConfig,ecologyMode:'classic' as const,perceptionMode:'perfect' as const,predationMode:'threshold' as const,seed:512,initialPopulation:1,foodPerDay:0,startingEnergy:500,dayLength:5}
    send({type:'reset',config:boundaryConfig,epoch:8})
    send({type:'play'})
    vi.advanceTimersByTime(4950)
    send({type:'pause'})
    send({type:'step',stepId:2})
    send({type:'step',stepId:3})
    const boundaryBeat=snapshot(messages.at(-2)),boundary=snapshot(messages.at(-1))
    expect(boundaryBeat).toMatchObject({type:'snapshot',epoch:8,lastCommandId:0,stepId:2,stepResult:{stop:'beat'},stepContext:{selectedIndividualId:null,selectedWasActive:false}})
    expect(boundary).toMatchObject({type:'snapshot',epoch:8,lastCommandId:0,stepId:3,stepResult:{stop:'generation-boundary'},stepContext:{selectedIndividualId:null,selectedWasActive:false}})
    expect(boundary.world.generation).toBe(2)
  })
})
