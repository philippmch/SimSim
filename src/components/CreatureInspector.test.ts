import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultConfig } from '../simulation/config'
import { createWorld } from '../simulation/engine'
import type { DecisionSummary } from '../simulation/types'
import { summarizeSelectedSettlementPreview, type SelectedSettlementPreview } from './GenerationForecast'
import type { CreatureInspectorProps } from './CreatureInspector'
import { CreatureInspector, decisionCandidateMatches, formatCandidateUtilitySummary, formatDecisionActionLabel, formatDecisionBasis, formatDecisionProvenance, formatDecisionTargetLabel, formatSelectedSettlementOutcome, formatSelectedSettlementReproduction } from './CreatureInspector'

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
  it('humanizes each captured action and formats candidate counts',()=>{
    expect(formatDecisionActionLabel('food')).toBe('Forage for food')
    expect(formatDecisionActionLabel('prey')).toBe('Hunt prey')
    expect(formatDecisionActionLabel('threat')).toBe('Flee from danger')
    expect(formatDecisionActionLabel('home')).toBe('Return home')
    expect(formatDecisionActionLabel('memory')).toBe('Follow remembered food')
    expect(formatDecisionActionLabel('explore')).toBe('Explore the arena')
    expect(formatDecisionActionLabel(undefined)).toBe('Action unavailable')
    expect(formatCandidateUtilitySummary(1)).toBe('Compare candidate utilities · 1 candidate')
    expect(formatCandidateUtilitySummary(2)).toBe('Compare candidate utilities · 2 candidates')
  })

  it('labels each supported selection basis and captured provenance',()=>{
    expect(formatDecisionBasis('best-utility')).toContain('highest relative utility')
    expect(formatDecisionBasis('commitment')).toContain('target commitment')
    expect(formatDecisionBasis('urgent-override')).toContain('urgent safety override')
    expect(formatDecisionProvenance(summary.decidedAt)).toBe('Captured decision · Generation 3 · day 1.25 · reaction window 4')
  })

  it('resolves stable target copy without exposing runtime IDs',()=>{
    expect(formatDecisionTargetLabel(summary,'Prey · Individual 17')).toBe('Prey · Individual 17')
    expect(formatDecisionTargetLabel({...summary,chosen:'home',chosenTargetId:null},'')).toBe('Home location')
    expect(formatDecisionTargetLabel({...summary,chosen:'food',chosenTargetId:99},undefined)).toBe('Food target · current status unavailable')
    expect(formatDecisionTargetLabel({...summary,chosen:'prey',chosenTargetId:99},undefined)).toBe('Prey target · current status unavailable')
    expect(formatDecisionTargetLabel({...summary,chosen:'threat',chosenTargetId:99},undefined)).toBe('Threat target · current status unavailable')
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

const renderInspector=(world:ReturnType<typeof createWorld>,selected=world.creatures[0],overrides:Partial<CreatureInspectorProps>={})=>renderToStaticMarkup(createElement(CreatureInspector,{selected,ecologyMode:world.config.ecologyMode,dayTime:world.dayTime,stateLabel:'Exploring',targetLabel:'No current target',huntContactRule:'Contact required',onClose:()=>{},...overrides}))

describe('progressive individual inspector disclosure',()=>{
  it('keeps the plain-language decision explanation ahead of both dense disclosures',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1})
    const selected=world.creatures[0]
    selected.decisionSummary=summary
    const markup=renderInspector(world,selected,{decisionTargetLabel:'Prey · Individual 17'})
    const firstDetails=markup.indexOf('<details')
    const secondDetails=markup.indexOf('<details',firstDetails+1)

    expect(markup).toContain('Latest decision: Hunt prey')
    expect(markup).toContain('Chosen target: Prey · Individual 17')
    expect(markup).toContain('Reason: Target commitment')
    expect(markup).toContain('Selection basis: Chosen by target commitment')
    expect(markup).toContain('Captured decision · Generation 3 · day 1.25 · reaction window 4')
    expect(firstDetails).toBeGreaterThan(markup.indexOf('Latest decision: Hunt prey'))
    expect(secondDetails).toBeGreaterThan(firstDetails)
    expect(markup).toContain('<summary>Trait profile · 6 values</summary>')
    expect(markup).toContain('<summary>Compare candidate utilities · 2 candidates</summary>')
    for(const trait of ['speed','size','sense','aggression','caution','exploration'])expect(markup).toContain(`<dt>${trait}</dt>`)
    expect(markup).toContain('Nearby food utility')
    expect(markup).toContain('Target commitment')
    expect(markup).toContain('· Chosen')
    expect(markup).toContain('scores rank candidates within this decision, not probability or biological fitness')
    expect(markup).toContain('perception can refresh before the next decision')
    expect([...markup.matchAll(/<details\b[^>]*>/g)].every(match=>!/\bopen(?:=|>)/.test(match[0]))).toBe(true)
  })

  it('distinguishes active and home creatures with no captured decision',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1})
    const active=world.creatures[0]
    delete active.decisionSummary
    const activeMarkup=renderInspector(world,active)
    expect(activeMarkup).toContain('No decision captured yet')
    expect(activeMarkup).toContain('Advance the simulation to capture its next decision.')

    active.home=true
    const homeMarkup=renderInspector(world,active)
    expect(homeMarkup).toContain('No active decision while home.')
    expect(homeMarkup).toContain('there is no active action to explain')
    expect(homeMarkup).not.toContain('Advance the simulation to capture its next decision.')
    expect(activeMarkup).not.toContain('aria-live')
    expect(homeMarkup).not.toContain('aria-live')
  })
})

const settlementPreview=(overrides:Partial<SelectedSettlementPreview>={}):SelectedSettlementPreview=>({
  individualId:1,generation:3,mode:'classic',outcome:'survived',nextAge:2,retainedEnergy:110,settledEnergy:110,
  reproductionStatus:'admitted',foodAtSettlement:2,reproductionCost:35,eligibleParentCount:1,availableBirthSlots:119,...overrides,
})

describe('selected individual settlement preview',()=>{
  it('explains classic admission and the strict energy reproduction threshold',()=>{
    expect(formatSelectedSettlementOutcome(settlementPreview())).toBe('Would survive → generation 4 · age 2 · 110.0 energy.')
    expect(formatSelectedSettlementReproduction(settlementPreview())).toBe('One offspring would be admitted · 2/2 food collected.')

    const threshold=settlementPreview({mode:'energy-regrowth',retainedEnergy:35,settledEnergy:35,reproductionCost:35,reproductionStatus:'not-eligible'})
    expect(formatSelectedSettlementReproduction(threshold)).toBe('No offspring · 35.0 retained energy must exceed the 35.0 cost.')
  })

  it('distinguishes eligibility from capacity admission',()=>{
    const blocked=settlementPreview({mode:'energy-regrowth',reproductionStatus:'eligible-capacity-blocked',eligibleParentCount:3,availableBirthSlots:1})
    expect(formatSelectedSettlementReproduction(blocked)).toBe('Eligible for offspring, but would not be admitted · 1 available birth slot for 3 eligible parents.')
  })

  it('names every authoritative loss cause without implying reproduction',()=>{
    const labels={hunted:'Hunted',energy:'Energy depleted',unfed:'No food at settlement',late:'Missed return deadline',aged:'Old age'} as const
    for(const [outcome,label] of Object.entries(labels) as [keyof typeof labels,string][]){
      const preview=settlementPreview({outcome,nextAge:null,retainedEnergy:null,settledEnergy:null,reproductionStatus:'not-eligible'})
      expect(formatSelectedSettlementOutcome(preview)).toBe(`Would not survive · ${label}.`)
      expect(formatSelectedSettlementReproduction(preview)).toBe('It would produce no offspring.')
    }
  })

  it('renders the current-state framing and consequence without live-announcement churn',()=>{
    const world=createWorld({...defaultConfig,initialPopulation:1,foodPerDay:0})
    const selected=world.creatures[0]
    Object.assign(selected,{alive:true,home:true,energy:100})
    const preview=summarizeSelectedSettlementPreview(world,selected.individualId)
    const markup=renderToStaticMarkup(createElement(CreatureInspector,{selected,ecologyMode:world.config.ecologyMode,dayTime:world.dayTime,stateLabel:'Safe at home',targetLabel:'No current target',huntContactRule:'Contact required',settlementPreview:preview,onClose:()=>{}}))

    expect(markup).toContain('role="note"')
    expect(markup).toContain('<strong>If generation ended now</strong>')
    expect(markup).toContain('Would survive')
    expect(markup).toContain('Counterfactual snapshot · not a prediction · updates as the cohort changes')
    expect(markup).not.toContain('aria-live')
  })
})
