import { describe, expect, it } from 'vitest'
import { INITIAL_ARENA_VIEW, arenaViewFromScreen, arenaViewToScreen, clampArenaView, panArenaView } from './ArenaView'
import { arenaSelectedCreatureCalloutGeometry, arenaActivitySpotlightTagGeometry } from './ArenaCanvasRenderer'

describe('arena viewport', () => {
  it('keeps picking aligned after zoom and pan, including padded canvas coordinates', () => {
    const view = panArenaView({ zoom: 3, x: .5, y: .5 }, .18, -.12)
    const point = { x: .24, y: .61 }
    const screen = arenaViewToScreen(view, point)
    expect(screen.x).not.toBe(point.x)
    const restored = arenaViewFromScreen(view, screen)
    expect(restored.x).toBeCloseTo(point.x)
    expect(restored.y).toBeCloseTo(point.y)
  })
  it('keeps canvas edges in the viewport when panning and zooming out', () => {
    expect(panArenaView({ zoom: 2, x: .5, y: .5 }, 100, -100)).toEqual({ zoom: 2, x: .25, y: .75 })
    expect(clampArenaView({ zoom: .5, x: .2, y: .9 })).toEqual(INITIAL_ARENA_VIEW)
    expect(clampArenaView({ zoom: 20, x: 0, y: 1 })).toEqual({ zoom: 4, x: .125, y: .875 })
  })
  it('does not move the unzoomed arena', () => {
    expect(panArenaView(INITIAL_ARENA_VIEW, .3, -.2)).toEqual(INITIAL_ARENA_VIEW)
    expect(arenaViewFromScreen(INITIAL_ARENA_VIEW, { x: .2, y: .8 })).toEqual({ x: .2, y: .8 })
  })
  it('keeps mobile explanatory text at screen size while reserving zoomed actor space', () => {
    const input = { width: 320, height: 450, pad: 20, x: .5, y: .5, size: 1, compact: true, explanationsOutside: true, compactControls: true }
    const normal = arenaSelectedCreatureCalloutGeometry(input)
    const zoomed = arenaSelectedCreatureCalloutGeometry({ ...input, visualScale: 4 })
    expect(zoomed.width).toBe(148)
    expect(zoomed.height).toBe(normal.height)
    expect(zoomed.leaderStartY).toBeLessThan(normal.leaderStartY)
    expect(zoomed.x).toBeGreaterThanOrEqual(20)
    expect(zoomed.x + zoomed.width).toBeLessThanOrEqual(300)
    const tagInput = { ...input, role: 'collector' as const, individualId: 1, label: 'Now · collector 1' }
    const tag = arenaActivitySpotlightTagGeometry({ ...tagInput, visualScale: 4 })
    expect(tag).not.toBeNull()
    expect(tag!.width).toBeLessThanOrEqual(96)
    expect(tag!.height).toBe(18)
  })
})
