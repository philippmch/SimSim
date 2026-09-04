import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import type {WorldActivityEntry} from '../simulation/types'
import {FirstGenerationGuide,ObservedStepStory,formatFirstGenerationGuide,formatStepActivitySummary,type StepActivityEvidence} from './ObservedStepStory'

const moment=(sequence:number,kind:WorldActivityEntry['kind']='food-collected'):WorldActivityEntry=>({sequence,generation:1,day:sequence/100,tick:sequence,kind,summary:`record ${sequence}`,count:1})
const evidence=(activity:WorldActivityEntry[],startSequence:number,endSequence:number):StepActivityEvidence=>({activity,window:{startSequence,endSequence,recordedCount:endSequence-startSequence,sequenceReset:false}})

describe('manual-step event story',()=>{
  it('distinguishes an unfinished step, no new moment, and unavailable telemetry',()=>{
    expect(formatStepActivitySummary(null)).toBe('')
    expect(formatStepActivitySummary(evidence([],4,4))).toBe('During this step: No key moments were recorded; movement or decisions may still have changed.')
    expect(formatStepActivitySummary({activity:[],window:undefined})).toBe('During this step: Event telemetry was unavailable for this step.')
    expect(formatStepActivitySummary({activity:[],window:{startSequence:Number.MAX_SAFE_INTEGER,endSequence:2,recordedCount:0,sequenceReset:true}})).toBe('During this step: Event telemetry was unavailable for this step.')
  })

  it('groups only the captured step tail and reports retained omissions',()=>{
    const activity=[moment(3,'intervention'),moment(4),moment(5),moment(6,'attack-failure')]
    expect(formatStepActivitySummary(evidence(activity,3,6))).toBe('During this step: 3 key moments · Food collected ×2 · Attack failed.')
    expect(formatStepActivitySummary(evidence(activity.slice(-1),3,6))).toBe('During this step: 3 key moments · Attack failed. 2 earlier moments fell outside retained run history.')
    expect(formatStepActivitySummary(evidence([],8,9))).toContain('its detail fell outside retained run history')
    expect(formatStepActivitySummary(evidence([moment(4),moment(6)],3,6))).toContain('telemetry was unavailable')
  })

  it('stays unchanged when later run activity evicts the captured records',()=>{
    const captured=evidence([moment(4),moment(5,'attack-success')],3,5),before=formatStepActivitySummary(captured)
    const later=Array.from({length:24},(_,index)=>moment(6+index,'natural-regrowth'))
    expect(formatStepActivitySummary(captured)).toBe(before)
    expect(formatStepActivitySummary({...captured,activity:later})).not.toBe(before)
  })

  it('uses one atomic live region and omits unfinished evidence',()=>{
    const initial=renderToStaticMarkup(createElement(ObservedStepStory,{observedPath:'Choose Next action.',evidence:null}))
    const complete=renderToStaticMarkup(createElement(ObservedStepStory,{observedPath:'Observed path: Individual 1 foraged.',evidence:evidence([moment(1)],0,1)}))
    expect(initial).not.toContain('During this step')
    expect(complete).toContain('Latest manual action')
    expect(complete).toContain('During this step: 1 key moment')
    expect(complete.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(complete).toContain('aria-atomic="true"')
  })
})

describe('first-generation guide',()=>{
  const guide=(overrides:Partial<Parameters<typeof formatFirstGenerationGuide>[0]>={})=>formatFirstGenerationGuide({playbackStatus:'Paused',selection:'none',stepState:'ready',...overrides}).join(' ')

  it('walks through pause, inspection, one decision, evidence, and settlement',()=>{
    expect(guide({playbackStatus:'Running'})).toContain('pause the run')
    expect(guide()).toContain('choose a creature in Inspect')
    expect(guide({selection:'creature'})).toContain('Next action')
    expect(guide({playbackStatus:'Running',selection:'creature'})).not.toContain('inspect a creature')
    expect(guide({selection:'creature',stepState:'pending'})).toContain('perception → decision → outcome')
    expect(guide({selection:'creature',stepState:'observed'})).toContain('read Observed path')
    expect(guide({playbackStatus:'Awaiting settlement'})).toContain('change one parameter')
    expect(guide({stepState:'finishing'})).toContain('recording the cohort')
  })

  it('explains a selected patch before returning to creature decisions',()=>{
    expect(guide({selection:'patch',stepState:'observed'})).toContain('live food, energy, and regrowth')
  })

  it('renders as a discoverable note without another live announcement',()=>{
    const markup=renderToStaticMarkup(createElement(FirstGenerationGuide,{playbackStatus:'Paused',selection:'creature',stepState:'ready'}))
    expect(markup).toContain('role="note"')
    expect(markup).toContain('aria-label="First generation guide"')
    expect(markup).not.toContain('aria-live')
  })
})
