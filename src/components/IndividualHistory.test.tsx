import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorldActivityEntry } from '../simulation/types'
import IndividualHistory, { deriveIndividualHistory } from './IndividualHistory'

const record = (sequence: number, generation = 1, actorIds = [7]): WorldActivityEntry => ({ sequence, generation, day: 2, tick: sequence, kind: 'food-collected', summary: `Meal ${sequence}`, count: 1, actorIds, location: [.2, .3] })
const selected = { individualId: 7, birthGeneration: 1, parentIndividualId: null, lineageId: 7 }

describe('individual retained history', () => {
  it('follows stable individuals chronologically across generations without adding relatives or unrelated settlements', () => {
    const attack = { ...record(3, 2, []), kind: 'attack-failure' as const, attackerId: 8, preyId: 7 }
    const activity = [record(4, 3), record(2, 2, [8]), attack, record(1)]
    const result = deriveIndividualHistory(activity, 7, 0)
    expect(result.entries.map(entry => [entry.moment.sequence, entry.moment.generation, entry.role])).toEqual([[1, 1, 'Collector'], [3, 2, 'Prey'], [4, 3, 'Collector']])
    expect(result.entries.every(entry => entry.reviewable)).toBe(true)
    expect(deriveIndividualHistory(activity, NaN).entries).toEqual([])
  })

  it('uses newest canonical duplicate metadata before actor filtering and returns the canonical site', () => {
    const first = record(1)
    const moved = { ...first, actorIds: [8], day: 3, location: [.8, .9] as [number, number] }
    expect(deriveIndividualHistory([first, moved], 7).entries).toEqual([])
    const entries = deriveIndividualHistory([first, moved], 8).entries
    expect(entries).toHaveLength(1)
    expect(entries[0].moment).toMatchObject({ sourceIndex: 1, day: 3, location: [.8, .9], actorIds: [8] })
    expect(deriveIndividualHistory([first, { ...moved, count: -1 }], 7).entries).toHaveLength(1)
  })

  it('never allows a fabricated legacy sequence to borrow a real record identity', () => {
    const legacy = { ...record(1), sequence: undefined }
    const entries = deriveIndividualHistory([legacy, record(1)], 7).entries
    expect(entries).toHaveLength(2)
    expect(entries[0].reviewable).toBe(false)
    expect(entries[1].reviewable).toBe(true)
  })

  it('states archive limits, presents accessible review controls, and starts collapsed', () => {
    const markup = renderToStaticMarkup(createElement(IndividualHistory, { selected, world: { activity: [record(1), record(2, 2)], activityDropped: 12, individualActivityDropped: 12 }, onReviewMoment: () => {} }))
    expect(markup).toContain('Individual history · 2 retained events')
    expect(markup).toContain('Oldest first, across generations')
    expect(markup).toContain('not a complete lifetime record')
    expect(markup).toContain('12 older actor events')
    expect(markup).toContain('aria-label="Review food collected in generation 2, day 2.00, record 2"')
    expect(markup.match(/<details[^>]*>/)?.[0]).not.toContain('open=')
    expect(markup).not.toContain('aria-live')
  })

  it('does not invent events when none survive and handles malformed or absent telemetry', () => {
    expect(deriveIndividualHistory([null, record(1, 1, [8])], 7).entries).toEqual([])
    expect(deriveIndividualHistory(undefined, 7).feed.activityDroppedKnown).toBe(false)
    const markup = renderToStaticMarkup(createElement(IndividualHistory, { selected, world: { activity: [], activityDropped: 0 } }))
    expect(markup).toContain('No retained events name this individual yet')
    expect(markup).not.toContain('<button')
  })

  it('preserves older generations beyond the recent trail and only reviews recent records', () => {
    const recent = record(100, 4)
    const history = deriveIndividualHistory([recent], 7, 76, [record(1), record(50, 2), recent])
    expect(history.entries.map(entry => [entry.moment.generation, entry.reviewable])).toEqual([[1, false], [2, false], [4, true]])
    expect(deriveIndividualHistory([{ ...recent, actorIds: [8] }], 7, 76, [recent]).entries).toEqual([])
    expect(deriveIndividualHistory([], 7, 100, [record(1), { ...record(1), actorIds: [8] }]).entries).toEqual([])
  })
})
