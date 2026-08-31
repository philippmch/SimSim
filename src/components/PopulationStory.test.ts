import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildSelectionShiftRows, formatSelectionDelta, formatSelectionShiftContext, PopulationStory, POPULATION_TRAIT_ORDER } from './PopulationStory'
import type { LineageAnalytics, SelectionShift } from '../simulation/types'

describe('population story selection-shift helpers',()=>{
  it('formats signed finite cohort deltas and keeps invalid values readable',()=>{
    expect(formatSelectionDelta(1.2344)).toBe('+1.234')
    expect(formatSelectionDelta(-1.2344)).toBe('-1.234')
    expect(formatSelectionDelta(0)).toBe('0.000')
    expect(formatSelectionDelta(.0004)).toBe('0.000')
    expect(formatSelectionDelta(.001)).toBe('+0.001')
    expect(formatSelectionDelta(null)).toBe('n/a')
    expect(formatSelectionDelta(Number.NaN)).toBe('n/a')
    expect(formatSelectionDelta(Number.POSITIVE_INFINITY)).toBe('n/a')
  })

  it('normalizes all six traits in stable order, including unavailable cohorts',()=>{
    const shifts:SelectionShift[]=[
      {trait:'exploration',survivor:-.2,reproducer:null},
      {trait:'speed',survivor:.1,reproducer:-.05},
      {trait:'caution',survivor:Number.NaN,reproducer:Number.POSITIVE_INFINITY},
    ]
    const rows=buildSelectionShiftRows(shifts)
    expect(rows.map(row=>row.trait)).toEqual(POPULATION_TRAIT_ORDER)
    expect(rows.map(row=>row.label)).toEqual(['Speed','Size','Sense','Aggression','Caution','Exploration'])
    expect(rows[0]).toMatchObject({survivor:'+0.100',reproducer:'-0.050'})
    expect(rows[1]).toMatchObject({survivor:'n/a',reproducer:'n/a'})
    expect(rows[4]).toMatchObject({survivor:'n/a',reproducer:'n/a'})
    expect(rows[5]).toMatchObject({survivor:'-0.200',reproducer:'n/a'})
    expect(JSON.stringify(rows)).not.toMatch(/NaN|Infinity/)
  })

  it('explains latest-generation context and the pre-generation empty state',()=>{
    expect(formatSelectionShiftContext(null)).toContain('No completed generation yet')
    expect(formatSelectionShiftContext(undefined)).toContain('after the first generation')
    expect(formatSelectionShiftContext(7)).toContain('Latest completed generation: 7')
    expect(formatSelectionShiftContext(7)).toContain('Positive values mean a higher cohort mean')
    expect(formatSelectionShiftContext(7)).toContain('negative values mean a lower cohort mean')
  })

  it('builds a safe six-row view model from a lineage analytics payload',()=>{
    const analytics:LineageAnalytics={
      livingLineages:2,effectiveDiversity:1.5,topLineages:[],latestGeneration:4,
      selectionShifts:[{trait:'speed',survivor:.2,reproducer:-.1}],
    }
    expect(buildSelectionShiftRows(analytics.selectionShifts)).toHaveLength(6)
    expect(buildSelectionShiftRows(undefined).every(row=>row.survivor==='n/a'&&row.reproducer==='n/a')).toBe(true)
  })

  it('renders the complete six-trait table, cohort labels, disclaimer, and live lineage list',()=>{
    const analytics:LineageAnalytics={
      livingLineages:2,effectiveDiversity:1.6,latestGeneration:4,
      topLineages:[{lineageId:7,count:3,share:.75},{lineageId:9,count:1,share:.25}],
      selectionShifts:[
        {trait:'speed',survivor:.1,reproducer:-.05},
        {trait:'size',survivor:null,reproducer:null},
        {trait:'sense',survivor:.001,reproducer:.002},
        {trait:'aggression',survivor:-.003,reproducer:.004},
        {trait:'caution',survivor:0,reproducer:0},
        {trait:'exploration',survivor:.02,reproducer:Number.NaN},
      ],
    }
    const markup=renderToStaticMarkup(createElement(PopulationStory,{lineage:analytics}))
    expect(markup).toContain('<h2 id="evolution-story-title">Current population · lineages</h2>')
    expect(markup).toContain('<h3 id="selection-shifts-title"')
    expect(markup).toContain('Parents of newborns Δ')
    expect(markup).toContain('<th scope="row">Speed</th><td>+0.100</td><td>-0.050</td>')
    expect(markup).toContain('<th scope="row">Size</th><td>n/a</td><td>n/a</td>')
    expect(markup.match(/<th scope="row">/g)).toHaveLength(6)
    expect(markup).toContain('descriptive associations, not proof of cause')
    expect(markup).toContain('Lineage 7')
    expect(markup).toContain('even when the journal above is pinned to an older one')
    expect(markup).not.toContain('NaN')
  })

  it('renders an explicit pre-generation state without an empty selection table',()=>{
    const analytics:LineageAnalytics={livingLineages:1,effectiveDiversity:1,topLineages:[{lineageId:3,count:1,share:1}],latestGeneration:null,selectionShifts:[]}
    const markup=renderToStaticMarkup(createElement(PopulationStory,{lineage:analytics}))
    expect(markup).toContain('No completed generation yet')
    expect(markup).toContain('Finish a generation to compare survivor and parent cohort means')
    expect(markup).not.toContain('<table')
    expect(markup).toContain('Lineage 3')
  })
})
