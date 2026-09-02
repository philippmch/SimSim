import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorldActivityEntry } from '../simulation/types'
import SimulationActivity, { MAX_VISIBLE_ACTIVITY_ENTRIES, NO_ACTIVITY_MOMENTS, deriveActivityFeed, deriveSimulationActivity, formatActivityAnnouncement, formatActivityMoment, formatActivityRetentionContext, hasWorldActivityTelemetry, normalizeActivityMoment } from './SimulationActivity'

const moment = (overrides: Partial<WorldActivityEntry> = {}): WorldActivityEntry => ({
  sequence: 1,
  generation: 1,
  day: .25,
  tick: 10,
  kind: 'food-collected',
  summary: 'Individual 1 collected food.',
  count: 1,
  actorIds: [1],
  ...overrides,
})

describe('simulation activity helpers', () => {
  it('normalizes legacy missing sequence and keeps optional actor metadata safe', () => {
    const legacy = { ...moment({ actorIds: ['1', 2, Number.NaN] as unknown as number[] }), sequence: undefined }
    const normalized = normalizeActivityMoment(legacy, 4)

    expect(normalized).toMatchObject({ sequence: 5, actorIds: [2], attackerId: null, preyId: null, contestChance: null })
  })

  it('drops malformed entries without exposing throwing getters or non-finite values', () => {
    const throwing = new Proxy({}, { get() { throw new Error('legacy getter') } })
    const feed = deriveSimulationActivity([
      moment({ sequence: 1 }),
      { sequence: Number.NaN, generation: Number.POSITIVE_INFINITY, day: -1, tick: 'bad', kind: 'unknown', summary: undefined, count: Number.NEGATIVE_INFINITY },
      throwing,
    ], Number.POSITIVE_INFINITY)

    expect(feed.entries).toHaveLength(1)
    expect(feed.invalidCount).toBe(2)
    expect(feed.droppedCount).toBe(2)
    expect(JSON.stringify(feed)).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('orders newest sequence first and resolves equal-sequence ties by latest source position', () => {
    const feed = deriveActivityFeed([
      moment({ sequence: 4, summary: 'first tie' }),
      moment({ sequence: 2, summary: 'older' }),
      moment({ sequence: 4, summary: 'second tie' }),
      moment({ sequence: 5, summary: 'newest' }),
    ])

    expect(feed.entries.map(entry => entry.summary)).toEqual(['newest', 'second tie', 'first tie', 'older'])
  })

  it('keeps the engine-sized visible list and reports explicit plus overflow drops', () => {
    const feed = deriveSimulationActivity(Array.from({ length: MAX_VISIBLE_ACTIVITY_ENTRIES + 3 }, (_, index) => moment({ sequence: index + 1, summary: `moment ${index + 1}` })), 2)

    expect(feed.entries).toHaveLength(MAX_VISIBLE_ACTIVITY_ENTRIES)
    expect(feed.entries[0].summary).toBe(`moment ${MAX_VISIBLE_ACTIVITY_ENTRIES + 3}`)
    expect(feed.retainedCount).toBe(MAX_VISIBLE_ACTIVITY_ENTRIES)
    expect(feed.displayedCount).toBe(MAX_VISIBLE_ACTIVITY_ENTRIES)
    expect(feed.droppedCount).toBe(5)
    expect(formatActivityRetentionContext(feed)).toBe(`Showing ${MAX_VISIBLE_ACTIVITY_ENTRIES} retained key moments, newest first; 5 records dropped or unavailable.`)
  })

  it('returns an explicit empty state for absent or malformed buffers', () => {
    expect(deriveSimulationActivity(undefined)).toMatchObject({ entries: [], latest: null, rawCount: 0, retainedCount: 0, droppedCount: 0 })
    expect(deriveSimulationActivity({ bad: true })).toMatchObject({ entries: [], latest: null, rawCount: 0, retainedCount: 0, droppedCount: 0 })
    expect(hasWorldActivityTelemetry({ activity: [] })).toBe(true)
    expect(hasWorldActivityTelemetry({})).toBe(false)
  })

  it('formats provenance and a discrete-event announcement without outcome claims', () => {
    const entry = moment({ kind: 'attack-success', generation: 3, day: 1.375, summary: 'Individual 2 caught Individual 5.' })
    expect(formatActivityMoment(normalizeActivityMoment(entry, 0)!)).toBe('Attack success · Generation 3 · day 1.38 · Individual 2 caught Individual 5.')
    expect(formatActivityAnnouncement(normalizeActivityMoment(entry, 0))).toContain('New key moment 1: Attack success · Generation 3 · day 1.38')
    expect(formatActivityAnnouncement(normalizeActivityMoment(entry, 0))).not.toBe(formatActivityAnnouncement(normalizeActivityMoment({ ...entry, sequence: 2 }, 1)))
    expect(formatActivityAnnouncement(null)).toBe('')
  })
})

describe('SimulationActivity SSR markup', () => {
  it('renders empty/reset copy with one polite announcement surface', () => {
    const markup = renderToStaticMarkup(createElement(SimulationActivity, { world: { activity: [], activityDropped: 0 } }))

    expect(markup).toContain(NO_ACTIVITY_MOMENTS)
    expect(markup).toContain('Showing 0 retained key moments, newest first; 0 records dropped or unavailable.')
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(markup).not.toContain('<details')
  })

  it('renders the newest valid moment prominently and exposes the full newest-first archive accessibly', () => {
    const markup = renderToStaticMarkup(createElement(SimulationActivity, {
      world: {
        activity: [
          moment({ sequence: 1, generation: 1, summary: 'older moment' }),
          moment({ sequence: 2, generation: 2, day: 1.5, kind: 'generation-settlement', summary: 'Generation 1 settled.' }),
        ],
        activityDropped: 3,
      },
    }))

    expect(markup).toContain('Recent key moments')
    expect(markup).toContain('Generation 2 · day 1.50')
    expect(markup).toContain('Generation 1 settled.')
    expect(markup).toContain('<details>')
    expect(markup).toContain('Show all 2 retained key moments</summary>')
    expect(markup).toContain('Retained key moments, newest first')
    expect(markup.match(/<li/g)).toHaveLength(2)
    expect(markup).toContain('3 records dropped')
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(markup).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('labels and renders only the visible retained portion of an oversized legacy buffer', () => {
    const activity = Array.from({ length: MAX_VISIBLE_ACTIVITY_ENTRIES + 3 }, (_, index) => moment({ sequence: index + 1, summary: `moment ${index + 1}` }))
    const markup = renderToStaticMarkup(createElement(SimulationActivity, { world: { activity, activityDropped: 2 } }))

    expect(markup).toContain(`Show all ${MAX_VISIBLE_ACTIVITY_ENTRIES} retained key moments</summary>`)
    expect(markup.match(/<li/g)).toHaveLength(MAX_VISIBLE_ACTIVITY_ENTRIES)
    expect(markup).toContain('5 records dropped or unavailable')
    expect(markup).not.toContain(`Show all ${MAX_VISIBLE_ACTIVITY_ENTRIES + 3}`)
  })

  it('does not render an activity panel for legacy worlds with no activity field', () => {
    expect(renderToStaticMarkup(createElement(SimulationActivity, { world: { events: [] } }))).toBe('')
  })
})
