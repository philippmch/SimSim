import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createWorld } from '../simulation/engine'
import { defaultConfig } from '../simulation/config'
import { perceive } from '../simulation/perception'
import type { PerceptionDiagnostics } from '../simulation/types'
import PerceptionBreakdown, { validPerceptionCounts } from './PerceptionBreakdown'
import { CreatureInspector, formatPerceptionTelemetry } from './CreatureInspector'

const diagnostics: PerceptionDiagnostics = {
  mode: 'realistic', reactionWindow: 4,
  food: { total: 7, detected: 2, range: 1, fov: 1, occlusion: 1, detection: 2 },
  creatures: { total: 3, detected: 1, range: 2, fov: 0, occlusion: 0, detection: 0 },
}
const render = (sample = diagnostics) => renderToStaticMarkup(createElement(PerceptionBreakdown, { diagnostics: sample }))

describe('perception breakdown', () => {
  it('separates the two cohorts and reconciles outcomes to their sample totals', () => {
    const markup = render()
    expect(markup).toContain('<th scope="row">Detected</th><td>2</td><td>1</td>')
    expect(markup).toContain('<th scope="row">Detection miss</th><td>2</td><td>0</td>')
    expect(markup).toContain('<th scope="row">Total in sample</th><td>7</td><td>3</td>')
    expect(markup).toContain('first failed check in this order: range, view, obstacles, detection')
    expect(markup).toContain('A detection miss passed the other checks')
    expect(markup).toContain('exclude this individual, dead creatures, and creatures at home')
    expect(markup).not.toContain('aria-live')
    expect(markup.match(/<details[^>]*>/)?.[0]).not.toContain('open=')
  })

  it('uses actual perfect-mode samples without inventing range rejections', () => {
    const world = createWorld({ ...defaultConfig, perceptionMode: 'perfect', initialPopulation: 2 })
    const observer = world.creatures[0]
    observer.sense = .01
    const target = { ...world.creatures[1], x: observer.x + 1, y: observer.y }
    const sample = perceive(observer, [observer, target], world.food, [], world.config, 1, 0, 0).diagnostics
    expect(sample.creatures).toMatchObject({ total: 1, detected: 1, range: 0 })
    const markup = render(sample)
    expect(markup).toContain('Perfect perception passes all supplied food and creatures')
    expect(markup).toContain('Target choices still use sensing range')
    expect(markup).not.toContain('first failed check')
    expect(validPerceptionCounts(sample.food, 'perfect')).not.toBeNull()
  })

  it('keeps empty cohorts as measured zeroes', () => {
    const zero = { total: 0, detected: 0, range: 0, fov: 0, occlusion: 0, detection: 0 }
    expect(render({ ...diagnostics, food: zero, creatures: zero })).toContain('<th scope="row">Total in sample</th><td>0</td><td>0</td>')
    expect(validPerceptionCounts(zero)).toEqual(zero)
  })

  it('marks incomplete, contradictory and invalid counts unavailable while preserving the valid cohort', () => {
    for (const bad of [null, {}, { ...diagnostics.food, total: 99 }, { ...diagnostics.food, range: undefined }, { ...diagnostics.food, detected: -1 }, { ...diagnostics.food, fov: .5 }, { ...diagnostics.food, detection: NaN }, { ...diagnostics.food, total: Infinity }]) {
      const sample = { ...diagnostics, food: bad } as PerceptionDiagnostics
      expect(validPerceptionCounts(bad)).toBeNull()
      const markup = render(sample)
      expect(markup).toContain('<th scope="row">Detected</th><td>Unavailable</td><td>1</td>')
      expect(markup).not.toMatch(/NaN|Infinity|undefined/)
      expect(formatPerceptionTelemetry(sample)).toMatchObject({ food: 'Food counts unavailable', creatures: 'Other active creatures detected 1/3' })
    }
    expect(validPerceptionCounts(diagnostics.food, 'perfect')).toBeNull()
    expect(render({ ...diagnostics, mode: 'perfect' })).toContain('missing or inconsistent')
    expect(render({ ...diagnostics, mode: 'unknown' } as never)).toContain('no recognized perception mode')
  })

  it('integrates with the inspector without breaking partial legacy telemetry', () => {
    const world = createWorld(defaultConfig)
    const selected = { ...world.creatures[0], perceptionDiagnostics: { ...diagnostics, food: null } as never }
    const markup = renderToStaticMarkup(createElement(CreatureInspector, { selected, ecologyMode: world.config.ecologyMode, dayTime: 0, stateLabel: 'Exploring', targetLabel: 'No current target', huntContactRule: '', onClose: () => {} }))
    expect(markup).toContain('Perception breakdown · food and creatures')
    expect(markup).toContain('Food counts unavailable')
    expect(markup).toContain('Other active creatures detected 1/3')
  })
})
