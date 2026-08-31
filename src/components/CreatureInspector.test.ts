import { describe, expect, it } from 'vitest'
import { decisionCandidateMatches, formatDecisionBasis, formatDecisionProvenance, formatDecisionTargetLabel } from './CreatureInspector'
import type { DecisionSummary } from '../simulation/types'

const summary:DecisionSummary={
  chosen:'prey',
  chosenTargetId:42,
  selectionBasis:'commitment',
  decidedAt:{generation:3,dayTime:1.25,reactionWindow:4},
  reason:'Target commitment',
  candidates:[
    {type:'food',targetId:9,mode:'foraging',score:12,reason:'Nearby food utility'},
    {type:'prey',targetId:42,mode:'hunting',score:8,reason:'Target commitment'},
  ],
}

describe('captured decision inspector helpers',()=>{
  it('labels each supported selection basis and captured provenance',()=>{
    expect(formatDecisionBasis('best-utility')).toContain('highest relative utility')
    expect(formatDecisionBasis('commitment')).toContain('target commitment')
    expect(formatDecisionBasis('urgent-override')).toContain('urgent safety override')
    expect(formatDecisionProvenance(summary.decidedAt)).toBe('Captured decision · Generation 3 · day 1.25 · reaction window 4')
  })

  it('resolves stable target copy without exposing runtime IDs',()=>{
    expect(formatDecisionTargetLabel(summary,'Prey · Individual 17')).toBe('Prey · Individual 17')
    expect(formatDecisionTargetLabel({...summary,chosen:'home',chosenTargetId:null},'')).toBe('Home location')
    expect(formatDecisionTargetLabel({...summary,chosen:'food',chosenTargetId:99},undefined)).toBe('Food item · unavailable')
  })

  it('marks the selected semantic candidate and supports legacy summaries',()=>{
    expect(decisionCandidateMatches(summary,summary.candidates[0])).toBe(false)
    expect(decisionCandidateMatches(summary,summary.candidates[1])).toBe(true)
    const legacy:DecisionSummary={chosen:'food',reason:'legacy',candidates:[summary.candidates[0]]}
    expect(decisionCandidateMatches(legacy,legacy.candidates[0])).toBe(true)
    expect(formatDecisionBasis(undefined)).toBe('Selection basis unavailable')
    expect(formatDecisionProvenance({generation:0,dayTime:Number.NaN,reactionWindow:-1})).toBe('Decision capture time unavailable')
  })
})
