import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorldEvent } from '../simulation/types'
import InterventionFeed, { deriveInterventionFeed, formatInterventionAnnouncement, formatInterventionImpact, INTERVENTION_DAY_UNAVAILABLE, INTERVENTION_GENERATION_UNAVAILABLE, INTERVENTION_IMPACT_UNAVAILABLE, INTERVENTION_KIND_UNAVAILABLE, INTERVENTION_SUMMARY_UNAVAILABLE, MAX_VISIBLE_INTERVENTIONS, NO_INTERVENTIONS_RECORDED } from './InterventionFeed'

const event = (overrides: Partial<WorldEvent> = {}): WorldEvent => ({
  sequence: 1,
  generation: 1,
  day: 0,
  kind: 'resource-bloom',
  summary: 'Resource bloom added 3 food.',
  count: 3,
  ...overrides,
})

describe('intervention feed helpers', () => {
  it('shows the newest retained records first while preserving same-day append order in reverse', () => {
    const events = [
      event({ sequence: 1, kind: 'resource-bloom', summary: 'bloom command', count: 2 }),
      event({ sequence: 2, kind: 'drought', summary: 'drought command', count: 1 }),
      event({ sequence: 3, kind: 'founder-migration', summary: 'migration command', count: 4 }),
    ]
    const feed = deriveInterventionFeed(events)
    expect(feed.entries.map(entry => entry.summary)).toEqual(['migration command', 'drought command', 'bloom command'])
    expect(feed.entries.map(entry => entry.sourceIndex)).toEqual([2, 1, 0])
  })

  it('caps the visible feed at five and reports omitted retained records', () => {
    const events = Array.from({ length: MAX_VISIBLE_INTERVENTIONS + 2 }, (_, index) => event({ sequence: index + 1, day: index, summary: `event ${index}` }))
    const feed = deriveInterventionFeed(events)
    expect(feed.entries).toHaveLength(MAX_VISIBLE_INTERVENTIONS)
    expect(feed.entries.map(entry => entry.summary)).toEqual(['event 6', 'event 5', 'event 4', 'event 3', 'event 2'])
    expect(feed.totalRetained).toBe(7)
    expect(feed.omittedCount).toBe(2)
  })

  it('keeps zero-count actions visible with direct kind-aware impact copy', () => {
    expect(formatInterventionImpact('resource-bloom', 0)).toBe('No food added')
    expect(formatInterventionImpact('drought', 0)).toBe('No food removed')
    expect(formatInterventionImpact('founder-migration', 0)).toBe('No founders added')
    expect(formatInterventionImpact('founder-migration', 1)).toBe('+1 founder added')
    expect(formatInterventionImpact('legacy-shock', 0)).toBe('recorded count 0')
  })

  it('uses explicit placeholders for malformed values without leaking non-finite text', () => {
    const feed = deriveInterventionFeed([{
      generation: Number.NaN,
      day: Number.POSITIVE_INFINITY,
      kind: 'legacy-shock',
      summary: '   ',
      count: Number.NEGATIVE_INFINITY,
    }])
    const [entry] = feed.entries
    expect(entry).toMatchObject({
      kindLabel: INTERVENTION_KIND_UNAVAILABLE,
      generationLabel: INTERVENTION_GENERATION_UNAVAILABLE,
      dayLabel: INTERVENTION_DAY_UNAVAILABLE,
      impactLabel: INTERVENTION_IMPACT_UNAVAILABLE,
      summary: INTERVENTION_SUMMARY_UNAVAILABLE,
    })
    expect(JSON.stringify(feed)).not.toMatch(/NaN|Infinity/)
    expect(formatInterventionAnnouncement(entry)).not.toMatch(/NaN|Infinity/)
    expect(deriveInterventionFeed([{ kind: 'toString' }]).entries[0].kindLabel).toBe(INTERVENTION_KIND_UNAVAILABLE)
  })

  it('gives byte-identical same-cursor shocks distinct live announcement text', () => {
    const feed = deriveInterventionFeed([
      event({ sequence: 14, summary: 'Resource bloom added 24 food.', count: 24 }),
      event({ sequence: 15, summary: 'Resource bloom added 24 food.', count: 24 }),
    ])
    expect(formatInterventionAnnouncement(feed.entries[0])).toContain('Latest shock record 15')
    expect(formatInterventionAnnouncement(feed.entries[1])).toContain('Latest shock record 14')
    expect(formatInterventionAnnouncement(feed.entries[0])).not.toBe(formatInterventionAnnouncement(feed.entries[1]))
  })

  it('flags a full retention buffer conservatively', () => {
    const feed = deriveInterventionFeed(Array.from({ length: 60 }, (_, index) => event({ sequence: index + 1, day: index })))
    expect(feed.bufferFull).toBe(true)
    expect(feed.retentionLimit).toBe(60)
  })
})

describe('InterventionFeed SSR markup', () => {
  it('shows the initial empty state and exactly one polite live announcement', () => {
    const markup = renderToStaticMarkup(createElement(InterventionFeed, { events: [] }))
    expect(markup).toContain(NO_INTERVENTIONS_RECORDED)
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(markup).not.toContain('<ol')
  })

  it('renders exact summaries, provenance, direct impacts, count notes, and the full-buffer warning', () => {
    const events = Array.from({ length: 60 }, (_, index) => event({
      sequence: index + 1,
      generation: index + 1,
      day: index + .25,
      kind: index === 59 ? 'drought' : 'resource-bloom',
      summary: index === 59 ? 'Drought found no food to remove.' : `event ${index}`,
      count: index === 59 ? 0 : index,
    }))
    const markup = renderToStaticMarkup(createElement(InterventionFeed, { events }))
    expect(markup).toContain('Drought found no food to remove.')
    expect(markup).toContain('Generation 60')
    expect(markup).toContain('day 59.25')
    expect(markup).toContain('No food removed')
    expect(markup).toContain('Showing 5 newest of 60 retained shocks.')
    expect(markup).toContain('Earlier shocks may be unavailable because only the latest 60 are retained.')
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(markup.match(/<li/g)).toHaveLength(5)
  })

  it('does not treat the feed list as a live region', () => {
    const markup = renderToStaticMarkup(createElement(InterventionFeed, { events: [event()] }))
    expect(markup).toContain('<ol role="list" aria-label="Newest retained shocks"')
    expect(markup).not.toContain('aria-live="polite" aria-label="Newest retained shocks"')
  })
})
