import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultConfig } from '../simulation/config'
import type { Config, WorldActivityEntry, WorldActivityKind } from '../simulation/types'
import SimulationActivity, { MAX_VISIBLE_ACTIVITY_ENTRIES, NO_ACTIVITY_MOMENTS, deriveActivityActorTargets, deriveActivityFeed, deriveSimulationActivity, formatActivityActorRelation, formatActivityAnnouncement, formatActivityContext, formatActivityMoment, formatActivityRetentionContext, hasWorldActivityTelemetry, normalizeActivityMoment } from './SimulationActivity'

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

const contextConfig: Partial<Config> = {
  ...defaultConfig,
  foodEnergy: 22,
  attackCost: 4,
  predationMode: 'threshold',
  patchCapacity: 60,
}

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

  it.each([
    ['food-collected', 'Classic mode awards one carried-food unit at contact and uses the legacy fixed 22-energy reward.'],
    ['attack-success', 'Threshold predation resolves an eligible contact meeting the size gate automatically; no contest energy cost is applied.'],
    ['attack-failure', 'Threshold predation should resolve an eligible contact meeting the size gate automatically; this failure is inconsistent or unavailable in threshold mode.'],
    ['energy-death', 'Energy reached zero; movement, sensing, and admitted contest attempts can spend it. Phase attribution is unavailable for this record.'],
    ['reached-home', 'In classic mode, carrying food and crossing the home radius ends the active day.'],
    ['natural-regrowth', 'Deterministic patch regrowth advances toward the configured capacity of 60 food per patch; this record has no per-patch breakdown.'],
    ['intervention', 'The recorded user-applied change takes effect immediately; no downstream evolutionary claim is made from this record.'],
    ['generation-settlement', 'The exact next population is 4 creatures; survivors carry forward and admitted births are added at this recorded boundary.'],
  ] as [WorldActivityKind, string][])('gives %s a factual model-context line', (kind, expected) => {
    const normalized = normalizeActivityMoment(moment({ kind, count: kind === 'generation-settlement' ? 4 : 1, contestChance: undefined }), 0)
    expect(normalized).not.toBeNull()
    expect(formatActivityContext(normalized!, { ...contextConfig, ecologyMode: 'classic' })).toBe(`Model context: ${expected}`)
  })

  it('distinguishes classic and energy-regrowth food rules and reports missing ecology mode', () => {
    const normalized = normalizeActivityMoment(moment({ kind: 'food-collected' }), 0)!
    expect(formatActivityContext(normalized, { ecologyMode: 'classic', foodEnergy: 99 })).toContain('legacy fixed 22-energy reward')
    expect(formatActivityContext(normalized, { ecologyMode: 'energy-regrowth', foodEnergy: 17 })).toContain('17 energy')
    expect(formatActivityContext(normalized, { ecologyMode: 'energy-regrowth' })).toContain('configured foodEnergy is unavailable')
    expect(formatActivityContext(normalized, {})).toContain('Ecology mode unavailable')
  })

  it('keeps threshold attacks automatic and gives contest attempts their recorded chance and cost', () => {
    const success = normalizeActivityMoment(moment({ kind: 'attack-success', contestChance: .63 }), 0)!
    const failure = normalizeActivityMoment(moment({ kind: 'attack-failure' }), 0)!
    const thresholdSuccess = formatActivityContext(success, { predationMode: 'threshold', attackCost: 99 })
    const thresholdFailure = formatActivityContext(failure, { predationMode: 'threshold', attackCost: 99 })
    const contestSuccess = formatActivityContext(success, { predationMode: 'contest', attackCost: 4 })
    const contestFailure = formatActivityContext(failure, { predationMode: 'contest', attackCost: 4 })
    expect(thresholdSuccess).toContain('resolves an eligible contact meeting the size gate automatically')
    expect(thresholdSuccess).toContain('no contest energy cost is applied')
    expect(thresholdSuccess).not.toContain('99')
    expect(thresholdFailure).toContain('inconsistent or unavailable')
    expect(contestSuccess).toContain('recorded contest chance 63%')
    expect(contestSuccess).toContain('admitted attempts pay 4 energy units')
    expect(contestSuccess).not.toMatch(/trait caused|because/i)
    expect(contestFailure).toContain('event-level contest chance unavailable')
    expect(formatActivityContext(failure, {})).toContain('Current predation mode unavailable')
  })

  it('reports the exact settlement accounting rule without parsing or repeating summary prose', () => {
    const complete = normalizeActivityMoment(moment({ kind: 'generation-settlement', count: 5, summary: 'Generation 1 settled: 3 survivors + 2 admitted births → generation 2 starts with 5 creatures.' }), 0)!
    const incomplete = normalizeActivityMoment(moment({ kind: 'generation-settlement', count: 5 }), 0)!
    expect(formatActivityContext(complete, contextConfig)).toBe('Model context: The exact next population is 5 creatures; survivors carry forward and admitted births are added at this recorded boundary.')
    expect(formatActivityContext(incomplete, contextConfig)).toBe(formatActivityContext(complete, contextConfig))
  })

  it('keeps energy, home, regrowth, and intervention context rule-relevant without non-finite or causal text', () => {
    const entries = (['energy-death', 'reached-home', 'natural-regrowth', 'intervention'] as WorldActivityKind[]).map((kind, index) => normalizeActivityMoment(moment({ kind, sequence: index + 1 }), index)!)
    const contexts = entries.map(entry => formatActivityContext(entry, { ecologyMode: 'energy-regrowth', patchCapacity: Number.NaN }))
    expect(contexts.join(' ')).not.toMatch(/NaN|Infinity|undefined/)
    expect(contexts.join(' ')).not.toMatch(/trait caused|because|led to/i)
    expect(contexts[0]).toContain('Phase attribution is unavailable')
    expect(contexts[1]).toContain('returning and crossing the home radius')
    expect(contexts[2]).toContain('no per-patch breakdown')
    expect(contexts[3]).toContain('takes effect immediately')
  })

  it('does not claim that a zero-count intervention changed the world', () => {
    const intervention = normalizeActivityMoment(moment({ kind: 'intervention', count: 0 }), 0)!
    const context = formatActivityContext(intervention, contextConfig)
    expect(context).toContain('resolved with no units changed')
    expect(context).not.toContain('takes effect immediately')
  })
})

describe('activity actor links', () => {
  it('orders explicit attack roles first, deduplicates IDs, and classifies current status by individualId', () => {
    const attack = normalizeActivityMoment(moment({
      kind: 'attack-success',
      attackerId: 2,
      preyId: 1,
      actorIds: [9, 2, 1, 3, 9],
    }), 0)!

    expect(deriveActivityActorTargets(attack, [
      { individualId: 1, alive: false },
      { individualId: 2, alive: true },
      { individualId: 3, alive: false },
      { id: 9, alive: true },
    ])).toEqual([
      { individualId: 2, role: 'attacker', roleLabel: 'Attacker', status: 'living' },
      { individualId: 1, role: 'prey', roleLabel: 'Prey', status: 'dead-but-present' },
      { individualId: 9, role: 'involved individual', roleLabel: 'Involved individual', status: 'absent' },
      { individualId: 3, role: 'involved individual', roleLabel: 'Involved individual', status: 'dead-but-present' },
    ])
  })

  it('uses event-specific collector and returning roles while tolerating malformed current data', () => {
    const malformedCreature = new Proxy({}, { get() { throw new Error('bad current creature getter') } })
    const food = normalizeActivityMoment(moment({ kind: 'food-collected', actorIds: [4, 5] }), 0)!
    const returned = normalizeActivityMoment(moment({ kind: 'reached-home', actorIds: [7] }), 1)!

    expect(deriveActivityActorTargets(food, [malformedCreature, { individualId: 4, alive: true }])).toMatchObject([
      { individualId: 4, role: 'collector', status: 'living' },
      { individualId: 5, role: 'involved individual', status: 'absent' },
    ])
    expect(deriveActivityActorTargets(returned, null)).toMatchObject([
      { individualId: 7, role: 'returning individual', status: 'absent' },
    ])
  })

  it('keeps relation copy selected-aware without inferring causation', () => {
    const targets = deriveActivityActorTargets(normalizeActivityMoment(moment({ actorIds: [2, 4] }), 0)!, [{ individualId: 2, alive: true }])

    expect(formatActivityActorRelation(2, targets)).toBe('Selected Individual 2 was involved in this moment.')
    expect(formatActivityActorRelation(8, targets)).toBe('Other individuals acted in this moment; Individual 8 was not an actor.')
    expect(formatActivityActorRelation(null, [])).toBe('Simulation-wide moment; no individual actor recorded.')
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
          moment({ sequence: 2, generation: 2, day: 1.5, kind: 'generation-settlement', count: 5, summary: 'Generation 1 settled: 3 survivors + 2 admitted births → generation 2 starts with 5 creatures.' }),
        ],
        activityDropped: 3,
      },
    }))

    expect(markup).toContain('What happened')
    expect(markup).toContain('Recent key moments')
    expect(markup).toContain('Generation 2 · day 1.50')
    expect(markup).toContain('Generation 1 settled: 3 survivors + 2 admitted births')
    expect(markup).toContain('<details>')
    expect(markup).toContain('Show 1 earlier retained key moment</summary>')
    expect(markup).toContain('Earlier retained key moments, newest first')
    expect(markup.match(/<li/g)).toHaveLength(1)
    expect(markup.match(/Generation 1 settled:/g)).toHaveLength(1)
    expect(markup.match(/Generation 2 · day 1\.50/g)).toHaveLength(1)
    expect(markup).toContain('Model context: The exact next population is 5 creatures; survivors carry forward and admitted births are added at this recorded boundary.')
    expect(markup).toContain('3 records dropped')
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(markup).not.toMatch(/NaN|Infinity|undefined/)
    expect(markup).toContain('min-height:44px')
    expect(markup).toContain('display:list-item')
  })

  it('labels and renders only the visible retained portion of an oversized legacy buffer', () => {
    const activity = Array.from({ length: MAX_VISIBLE_ACTIVITY_ENTRIES + 3 }, (_, index) => moment({ sequence: index + 1, summary: `moment ${index + 1}` }))
    const markup = renderToStaticMarkup(createElement(SimulationActivity, { world: { activity, activityDropped: 2 } }))

    expect(markup).toContain(`Show ${MAX_VISIBLE_ACTIVITY_ENTRIES - 1} earlier retained key moments</summary>`)
    expect(markup.match(/<li/g)).toHaveLength(MAX_VISIBLE_ACTIVITY_ENTRIES - 1)
    expect(markup).toContain('5 records dropped or unavailable')
    expect(markup).not.toContain(`Show all ${MAX_VISIBLE_ACTIVITY_ENTRIES + 3}`)
  })

  it('omits the disclosure when the latest event is the only retained moment', () => {
    const markup = renderToStaticMarkup(createElement(SimulationActivity, { world: { activity: [moment()], activityDropped: 0, config: contextConfig } }))

    expect(markup).not.toContain('<details')
    expect(markup).not.toContain('Show 0 earlier')
    expect(markup).toContain('What happened')
    expect(markup.match(/<strong/g)).toHaveLength(2)
  })

  it('does not render an activity panel for legacy worlds with no activity field', () => {
    expect(renderToStaticMarkup(createElement(SimulationActivity, { world: { events: [] } }))).toBe('')
  })

  it('labels attack roles separately and keeps stale actors factual and noninteractive', () => {
    const markup = renderToStaticMarkup(createElement(SimulationActivity, {
      world: {
        activity: [moment({ kind: 'attack-success', attackerId: 2, preyId: 1, actorIds: [2, 1] })],
        creatures: [{ individualId: 2, alive: true }, { individualId: 1, alive: false }],
      },
      selectedIndividualId: 2,
      onShowIndividual: () => undefined,
    }))

    expect(markup).toContain('Attacker · Individual 2 · current arena state')
    expect(markup).toContain('Prey · Individual 1 · dead in current cohort')
    expect(markup).toContain('Show current arena state for Attacker Individual 2')
    expect(markup).toContain('Selected Individual 2 was involved in this moment.')
    expect(markup.match(/<button/g)).toHaveLength(1)
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1)
  })

  it('uses one compact select for more than two actors and disables nonliving choices', () => {
    const markup = renderToStaticMarkup(createElement(SimulationActivity, {
      world: {
        activity: [moment({ actorIds: [1, 2, 3] })],
        creatures: [{ individualId: 1, alive: true }, { individualId: 2, alive: false }],
      },
      onShowIndividual: () => undefined,
    }))

    expect(markup).toContain('aria-label="Choose an event actor to show its current arena state"')
    expect(markup.match(/<select/g)).toHaveLength(1)
    expect(markup.match(/<option/g)).toHaveLength(4)
    expect(markup.match(/<option[^>]*disabled=""/g)).toHaveLength(2)
    expect(markup).toContain('Involved individual · Individual 2 · dead in current cohort')
    expect(markup).toContain('Involved individual · Individual 3 · not in current cohort')
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1)
  })

  it('shows factual statuses instead of an unusable select when every recorded actor is stale', () => {
    const markup = renderToStaticMarkup(createElement(SimulationActivity, {
      world: {
        activity: [moment({ actorIds: [1, 2, 3] })],
        creatures: [{ individualId: 1, alive: false }],
      },
      onShowIndividual: () => undefined,
    }))

    expect(markup).not.toContain('<select')
    expect(markup).toContain('Individual 1 · dead in current cohort')
    expect(markup).toContain('Individual 2 · not in current cohort')
    expect(markup).toContain('Individual 3 · not in current cohort')
  })
})
