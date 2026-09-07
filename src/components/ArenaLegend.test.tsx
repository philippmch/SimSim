import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ArenaLegend from './ArenaLegend'
import { CREATURE_STATE_METADATA } from './ArenaCanvasModel'
import type { EcologyMode } from '../simulation/types'

const render = (ecologyMode: EcologyMode = 'energy-regrowth') => renderToStaticMarkup(createElement(ArenaLegend, { ecologyMode }))

describe('arena visual guide', () => {
  it('starts collapsed with recognizable named subjects in its summary', () => {
    const markup = render()
    expect(markup.match(/<details[^>]*>/)?.[0]).not.toContain('open=')
    const summary = markup.match(/<summary[\s\S]*?<\/summary>/)?.[0]
    for (const text of ['How to read the arena', 'Creatures', 'Food', 'Rocks', 'Food patches']) expect(summary).toContain(text)
    for (const text of ['Teardrop-shaped creature', 'Small lime food balls', 'Large shaded rock', 'Food patch circle with stock ring and 1.0× multiplier']) expect(markup).toContain(`aria-label="${text}"`)
    expect(markup.match(/role="img"/g)).toHaveLength(4)
  })

  it('explains both effects of patch quality and how to read remaining food', () => {
    const markup = render()
    expect(markup).toContain('1.0× means normal')
    expect(markup).toContain('Higher means faster regrowth and more energy per food; lower means less of both.')
    expect(markup).toContain('inner ring fills as the patch contains more food')
  })

  it('does not teach energy, stock rings or regrowth multipliers in classic mode', () => {
    const markup = render('classic')
    expect(markup).toContain('places where food tends to appear')
    expect(markup).toContain('Soft shaded food patch area')
    expect(markup).not.toContain('stroke-dasharray=')
    expect(markup).not.toContain('dashed circle')
    for (const text of ['regrowth', '1.0×', 'inner ring', 'energy per food', 'gain energy']) expect(markup).not.toContain(text)
  })

  it('keeps action colors in sync with the arena and explains selection without implying a travelled path', () => {
    const markup = render()
    for (const state of Object.values(CREATURE_STATE_METADATA)) {
      expect(markup).toContain(state.label)
      expect(markup).toContain(state.color)
    }
    expect(markup).toContain('teal is slower, yellow is faster')
    expect(markup).toContain('arena’s edge')
    expect(markup).toContain('try to find food')
    expect(markup).toContain('number inside the body counts food carried')
    expect(markup).toContain('survivors may have offspring that inherit their traits')
    expect(markup).toContain('last chosen destination, rather than tracing its journey')
    expect(markup).toContain('Next action advances to a noticeable action')
    expect(markup).toContain('Finish generation settles the current round')
  })
})
