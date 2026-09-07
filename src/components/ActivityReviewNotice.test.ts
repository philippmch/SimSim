import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ActivityReviewNotice, { deriveActivityReviewNavigation } from './ActivityReviewNotice'
import { MAX_VISIBLE_ACTIVITY_ENTRIES, normalizeActivityMoment } from './SimulationActivity'

const record = (sequence: number, extra: Record<string, unknown> = {}) => ({ sequence, generation: 1, day: sequence / 10, tick: sequence, kind: 'natural-regrowth', summary: `Record ${sequence}.`, count: 1, actorIds: [], ...extra })
const selected = (value: ReturnType<typeof record>, sourceIndex = 0) => normalizeActivityMoment(value, sourceIndex)!
const render = (activity: unknown, moment = selected(record(2)), callback = true) => renderToStaticMarkup(createElement(ActivityReviewNotice, { activity, moment, creatures: [], onReturnToLatest: () => undefined, onReviewMoment: callback ? () => undefined : undefined }))

describe('retained review navigation', () => {
  it('orders cross-generation, aggregate and site-only records from earlier to later', () => {
    const activity = [record(3, { generation: 2, kind: 'energy-death', location: [.2, .4] }), record(1), record(2)]
    const result = deriveActivityReviewNavigation(activity, selected(activity[0], 80))
    expect(result.records.map(moment => moment.sequence)).toEqual([1, 2, 3])
    expect(result.index).toBe(2)
    expect(result.records[2].location).toEqual([.2, .4])
  })

  it('keeps distinct equal-sequence records and the newest duplicate representative', () => {
    const a = record(2), b = record(2, { summary: 'Different summary.' })
    const result = deriveActivityReviewNavigation([a, b, a], selected(a, 99))
    expect(result.records.map(moment => moment.summary)).toEqual(['Different summary.', 'Record 2.'])
    expect(result.records[1].sourceIndex).toBe(2)
    expect(result.index).toBe(1)
  })

  it('omits fabricated legacy identities and remains bounded', () => {
    const legacy = record(1, { sequence: undefined })
    expect(deriveActivityReviewNavigation([legacy], selected(legacy))).toEqual({ records: [], index: -1 })
    const activity = Array.from({ length: MAX_VISIBLE_ACTIVITY_ENTRIES + 3 }, (_, i) => record(i + 1))
    const result = deriveActivityReviewNavigation(activity, selected(activity[0]))
    expect(result.records).toHaveLength(MAX_VISIBLE_ACTIVITY_ENTRIES)
    expect(result.index).toBe(-1)
  })

  it('rejects a legacy record even when its repaired identity matches a retained raw record', () => {
    const valid = record(2)
    const legacy = { ...valid, sequence: undefined, day: 99, location: [.9, .9] }
    const result = deriveActivityReviewNavigation([valid, legacy], selected(valid))
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({ sourceIndex: 0, day: .2, location: null })
  })

  it('skips throwing slots and hostile inputs without hiding valid records', () => {
    const activity = [record(1), record(2)]
    Object.defineProperty(activity, 0, { get() { throw new Error('bad slot') } })
    expect(deriveActivityReviewNavigation(activity, selected(record(2))).records.map(value => value.sequence)).toEqual([2])
    for (const input of [null, {}, new Proxy([], { get() { throw new Error('bad array') } })]) {
      expect(deriveActivityReviewNavigation(input, selected(record(2)))).toEqual({ records: [], index: -1 })
    }
  })

  it('uses canonical duplicate provenance, site and actors throughout the notice', () => {
    const old = record(2, { day: 3, location: [.1, .2], actorIds: [1] })
    const canonical = record(2, { day: 7, location: null, actorIds: [] })
    const markup = renderToStaticMarkup(createElement(ActivityReviewNotice, {
      activity: [old, canonical], moment: selected(old), creatures: [{ individualId: 1, alive: true }] as never,
      onReturnToLatest: () => undefined, onReviewMoment: () => undefined,
    }))
    expect(markup).toContain('day 7.00')
    expect(markup).not.toContain('day 3.00')
    expect(markup).toContain('This event has no recorded location')
    expect(markup).toContain('No creatures from this event are visible now')
    expect(markup).not.toContain('no longer alive')
  })

  it('renders one-based range values and descriptive provenance with an initially empty live status', () => {
    const markup = render([record(1), record(2), record(3)])
    expect(markup).toContain('aria-label="Browse retained events"')
    expect(markup).toContain('min="1" max="3"')
    expect(markup).toContain('value="2"')
    expect(markup).toContain('aria-valuetext="Record 2 of 3: Generation 1')
    expect(markup).toContain('tick 2 · Record 2.')
    expect(markup).toContain('not simulation time; this is not a replay.')
    expect(markup).toContain('id="arena-review-announcement" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></span>')
    expect(markup).not.toContain('disabled=""')
  })

  it('handles empty, missing, single and boundary selections without invalid controls', () => {
    expect(render([])).not.toContain('type="range"')
    expect(render([record(1)])).not.toContain('type="range"')
    expect(render([record(1), record(2)], selected(record(2)), false)).not.toContain('type="range"')
    const single = render([record(2)])
    expect(single.match(/disabled=""/g)).toHaveLength(3)
    for (const boundary of [1, 3]) {
      const markup = render([record(1), record(2), record(3)], selected(record(boundary)))
      expect(markup.match(/disabled=""/g)).toHaveLength(1)
      expect(markup).toContain(`value="${boundary}"`)
    }
  })
})
