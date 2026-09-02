import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArenaCanvasFallback, canStartSimulationCommand, formatCompactNextActionLabel, formatFounderMigrationCopy, formatNextActionCopy, formatPlaybackControlLabel, formatPlaybackPhaseAnnouncement, formatStepCompletion, GenerationAccountingFallback, hasOwnActivityField, initialManualStepStoryState, INITIAL_OBSERVED_PATH, InterventionFeedFallback, isManualStepStoryGenerationBoundary, ObservedStepStoryFallback, ParametersPanelFallback, PlaybackPhaseStatus, resolveAcknowledgedFinishGeneration, resolveManualStepStoryTransition, resolveTerminalOutcome, reviewSettlementAndNavigate, SelectedInspectorShell, shouldFocusSelectedInspector, SimulationActivityFallback, SimulationEventStory, simulationCommandAcknowledged, stepActivityAnnouncementSequence, transitionManualStepStoryState, type ManualStepStoryState, type NextActionCopyInput, type PendingSimulationCommand, type TerminalOutcomeCreature } from './App'
import { formatPerceptionTelemetry } from './components/CreatureInspector'
import { createWorld, defaultConfig, finishGeneration as settleGeneration } from './simulation/engine'
import { MAX_FOUNDER_MIGRATION_BATCH, MAX_POPULATION } from './simulation/config'
import type { LastInspectedOutcome, PerceptionDiagnostics, World } from './simulation/types'

const ready = (overrides: Partial<NextActionCopyInput> = {}): NextActionCopyInput => ({
  extinct: false,
  hasActiveCreatures: true,
  pending: false,
  selectedIndividualId: null,
  selectedIsActive: false,
  livingCreatures: 1,
  ...overrides,
})

const terminal = (overrides: Partial<LastInspectedOutcome> = {}): LastInspectedOutcome => ({
  individualId: 17,
  generation: 4,
  cause: 'hunted',
  ...overrides,
})

const creature = (overrides: Partial<TerminalOutcomeCreature> = {}): TerminalOutcomeCreature => ({
  individualId: 17,
  alive: false,
  deathCause: null,
  ...overrides,
})

describe('next action control copy', () => {
  it('keeps narrow controls short without hiding unavailable or pending state', () => {
    expect(formatCompactNextActionLabel(ready())).toBe('Next action')
    expect(formatCompactNextActionLabel(ready({ pending: true }))).toBe('Advancing…')
    expect(formatCompactNextActionLabel(ready({ selectedIndividualId: 17, selectedIsActive: true }))).toBe('Next selected')
    expect(formatCompactNextActionLabel(ready({ pending: true, selectedIndividualId: 17, selectedIsActive: true }))).toBe('Advancing selected…')
    expect(formatCompactNextActionLabel(ready({ hasActiveCreatures: false }))).toBe('No actions')
    expect(formatCompactNextActionLabel(ready({ extinct: true }))).toBe('Extinct')
  })

  it('only requests inspector focus for an explicit matching selection that rendered', () => {
    expect(shouldFocusSelectedInspector({ requestedIndividualId: 17, selectedIndividualId: 17, inspectorRendered: true })).toBe(true)
    expect(shouldFocusSelectedInspector({ requestedIndividualId: null, selectedIndividualId: 17, inspectorRendered: true })).toBe(false)
    expect(shouldFocusSelectedInspector({ requestedIndividualId: 17, selectedIndividualId: 18, inspectorRendered: true })).toBe(false)
    expect(shouldFocusSelectedInspector({ requestedIndividualId: 17, selectedIndividualId: 17, inspectorRendered: false })).toBe(false)
  })

  it('names an active inspected individual without claiming other creatures stop moving', () => {
    const copy = formatNextActionCopy(ready({ selectedIndividualId: 17, selectedIsActive: true }))

    expect(copy.buttonLabel).toBe("Advance until Individual 17's next decision")
    expect(copy.ariaLabel).toContain('advance the simulation until Individual 17')
    expect(copy.ariaLabel).toContain('other creatures may also move and react')
    expect(copy.title).toContain('other creatures may also move and react')
    expect(copy.title).not.toContain('only Individual 17')
  })

  it('explains the simulation-wide action beat when no individual is active', () => {
    expect(formatNextActionCopy(ready())).toEqual({
      buttonLabel: 'Advance action beat',
      ariaLabel: 'Pause and advance the simulation to the next action beat',
      title: 'Advance the simulation to the next decision beat.',
    })
  })

  it('keeps pending, inactive, and extinct states truthful', () => {
    expect(formatNextActionCopy(ready({ pending: true, selectedIndividualId: 17, selectedIsActive: true }))).toEqual({
      buttonLabel: "Advancing to Individual 17's next decision",
      ariaLabel: 'Advancing the simulation until Individual 17 reaches its next action beat; other creatures may also move and react',
      title: 'Advancing the simulation until Individual 17 reaches its next action beat.',
    })
    expect(formatNextActionCopy(ready({ hasActiveCreatures: false }))).toEqual({
      buttonLabel: 'No active creatures',
      ariaLabel: 'Next action unavailable during awaiting settlement; use Finish generation to settle this cohort',
      title: 'No active creature actions remain; use Finish generation to settle this cohort.',
    })
    expect(formatNextActionCopy(ready({ extinct: true }))).toEqual({
      buttonLabel: 'Population extinct',
      ariaLabel: 'Next action unavailable: population extinct',
      title: 'Population extinct; no next action is available.',
    })
  })

  it('distinguishes awaiting-home and awaiting-dead guidance for a disabled next action', () => {
    const home = formatNextActionCopy(ready({ hasActiveCreatures: false, livingCreatures: 2 }))
    expect(home.ariaLabel).toContain('use Finish generation to settle this cohort')
    expect(home.title).toContain('No active creature actions remain')

    const dead = formatNextActionCopy(ready({ hasActiveCreatures: false, livingCreatures: 0 }))
    expect(dead.title).toContain('All creatures in this generation are dead')
    expect(dead.title).toContain('Finish generation to record it')
  })

  it('keeps playback controls and the phase announcement truthful at settlement', () => {
    expect(formatPlaybackControlLabel('Running', true)).toBe('Pause simulation')
    expect(formatPlaybackControlLabel('Paused', false)).toBe('Play simulation')
    expect(formatPlaybackControlLabel('Awaiting settlement', true)).toBe('Pause playback before settlement')
    expect(formatPlaybackControlLabel('Awaiting settlement', false)).toBe('Resume playback toward settlement')
    expect(formatPlaybackControlLabel('Extinct', true)).toBe('Playback unavailable: population extinct')
    const detail = 'Awaiting settlement. Finish generation to settle this cohort.'
    expect(formatPlaybackPhaseAnnouncement('Awaiting settlement', detail, true)).toContain('Playback continues toward automatic settlement')
    expect(formatPlaybackPhaseAnnouncement('Awaiting settlement', detail, false)).toContain('Playback is paused before settlement')
    expect(formatPlaybackPhaseAnnouncement('Extinct', 'Extinct. The last settlement produced no creatures.', false)).toBe('')
  })

  it('renders one stable atomic phase region with distinct awaiting pause and resume text', () => {
    const detail = 'Awaiting settlement. Finish generation to settle this cohort.'
    const paused = renderToStaticMarkup(createElement(PlaybackPhaseStatus, { status: 'Awaiting settlement', detail, playing: false }))
    const running = renderToStaticMarkup(createElement(PlaybackPhaseStatus, { status: 'Awaiting settlement', detail, playing: true }))
    const suppressed = renderToStaticMarkup(createElement(PlaybackPhaseStatus, { status: 'Awaiting settlement', detail, playing: false, suppressed: true }))
    expect(paused).toContain('id="playback-phase-status"')
    expect(paused).toContain('role="status"')
    expect(paused).toContain('aria-live="polite"')
    expect(paused).toContain('aria-atomic="true"')
    expect(paused).toContain('Playback is paused before settlement')
    expect(running).toContain('Playback continues toward automatic settlement')
    expect(suppressed).not.toContain('Awaiting settlement')
  })

  it('describes a stopped manual step as awaiting settlement until the cohort is recorded', () => {
    const home = createWorld({ ...defaultConfig, initialPopulation: 2 })
    for (const individual of home.creatures) individual.home = true
    expect(formatStepCompletion(home, { stepResult: { ticks: 0, stop: 'no-active' } })).toContain('Awaiting settlement')
    expect(formatStepCompletion(home, { stepResult: { ticks: 0, stop: 'no-active' } })).toContain('all living creatures are home')

    const dead = createWorld({ ...defaultConfig, initialPopulation: 2 })
    for (const individual of dead.creatures) individual.alive = false
    expect(formatStepCompletion(dead, { stepResult: { ticks: 0, stop: 'no-active' } })).toContain('All creatures in this generation are dead')
    expect(formatStepCompletion(dead, { stepResult: { ticks: 0, stop: 'no-active' } })).not.toContain('Extinct')

    dead.creatures = []
    expect(formatStepCompletion(dead, { stepResult: { ticks: 0, stop: 'no-active' } })).toContain('Extinct')
  })

  it('does not claim an inactive inspected individual is the step subject', () => {
    const copy = formatNextActionCopy(ready({ selectedIndividualId: 17 }))

    expect(copy.buttonLabel).not.toContain('17')
    expect(copy.ariaLabel).not.toContain('Individual 17')
  })
})

describe('settlement review orchestration', () => {
  it('reveals only the settlement acknowledged by the matching explicit Finish command', () => {
    const queuedAutoplay = createWorld({ ...defaultConfig, seed: 612, initialPopulation: 2 })
    settleGeneration(queuedAutoplay)
    expect(resolveAcknowledgedFinishGeneration(17, undefined, queuedAutoplay.ledger)).toBeNull()
    expect(resolveAcknowledgedFinishGeneration(17, { finishId: 16 }, queuedAutoplay.ledger)).toBeNull()

    const explicitFinish = structuredClone(queuedAutoplay)
    settleGeneration(explicitFinish)
    expect(resolveAcknowledgedFinishGeneration(17, { finishId: 17 }, explicitFinish.ledger)).toBe(2)
  })

  it('selects the generation before opening the exact journal review helper', async () => {
    const calls: string[] = []
    const result = await reviewSettlementAndNavigate(7, {
      onSelectGeneration: generation => calls.push(`select:${generation}`),
      loadReviewHelper: async () => () => {
        calls.push('exact-review')
        return true
      },
      fallbackNavigate: () => {
        calls.push('fallback')
        return true
      },
    })

    expect(result).toBe(true)
    expect(calls).toEqual(['select:7', 'exact-review'])
  })

  it('falls back to the stable journal section when the exact helper returns false or rejects', async () => {
    for (const loadReviewHelper of [
      async () => () => false,
      async () => { throw new Error('lazy chunk unavailable') },
    ]) {
      const calls: string[] = []
      const result = await reviewSettlementAndNavigate(8, {
        onSelectGeneration: generation => calls.push(`select:${generation}`),
        loadReviewHelper,
        fallbackNavigate: () => {
          calls.push('fallback')
          return true
        },
      })
      expect(result).toBe(true)
      expect(calls).toEqual(['select:8', 'fallback'])
    }
  })

  it('does nothing for an invalid generation', async () => {
    const calls: string[] = []
    const result = await reviewSettlementAndNavigate(Number.NaN, {
      onSelectGeneration: () => calls.push('select'),
      loadReviewHelper: async () => {
        calls.push('load')
        return () => true
      },
      fallbackNavigate: () => {
        calls.push('fallback')
        return true
      },
    })

    expect(result).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('founder migration control copy', () => {
  const liveConfig = (founderPhysicalVariation = defaultConfig.founderPhysicalVariation, founderBehaviorVariation = defaultConfig.founderBehaviorVariation) => ({ founderPhysicalVariation, founderBehaviorVariation })

  it('shows the exact available batch and clamps live population counts safely', () => {
    expect(MAX_FOUNDER_MIGRATION_BATCH).toBe(8)
    expect(formatFounderMigrationCopy({ livingCreatures: 0, liveConfig: liveConfig(0, 0) })).toMatchObject({ available: 8, buttonLabel: 'Founder migration (up to 8)' })
    expect(formatFounderMigrationCopy({ livingCreatures: 112, liveConfig: liveConfig(0, 0) })).toMatchObject({ available: 8, buttonLabel: 'Founder migration (up to 8)' })
    expect(formatFounderMigrationCopy({ livingCreatures: 119, liveConfig: liveConfig(0, 0) })).toMatchObject({ available: 1, buttonLabel: 'Founder migration (up to 1)' })
    for (const livingCreatures of [MAX_POPULATION, MAX_POPULATION + 20, Number.NaN, Number.POSITIVE_INFINITY]) {
      const copy = formatFounderMigrationCopy({ livingCreatures, liveConfig: liveConfig(0, 0) })
      expect(copy).toMatchObject({ available: 0, buttonLabel: 'Founder migration (full)' })
      expect(copy.title.toLowerCase()).toContain(`population is at ${MAX_POPULATION}/${MAX_POPULATION}`)
      expect(copy.ariaLabel.toLowerCase()).toContain(`population is at ${MAX_POPULATION}/${MAX_POPULATION}`)
    }
    expect(formatFounderMigrationCopy({ livingCreatures: -20, liveConfig: liveConfig(0, 0) }).buttonLabel).toBe('Founder migration (up to 8)')
  })

  it('describes live founder variation without genetic claims or staged-config leakage', () => {
    const clonal = formatFounderMigrationCopy({ livingCreatures: 10, liveConfig: liveConfig(0, 0) })
    const varied = formatFounderMigrationCopy({ livingCreatures: 10, liveConfig: liveConfig(.2, .3) })
    expect(clonal.title).toContain('clonal founders')
    expect(clonal.ariaLabel).toContain('clonal founders')
    expect(varied.title).toContain('founders with configured trait variation')
    expect(varied.ariaLabel).toContain('founders with configured trait variation')
    expect(`${clonal.buttonLabel} ${clonal.title} ${clonal.ariaLabel} ${varied.buttonLabel} ${varied.title} ${varied.ariaLabel}`).not.toMatch(/genetic/i)

    const stagedDraft = liveConfig(.2, .3)
    const liveWorldConfig = liveConfig(0, 0)
    const copy = formatFounderMigrationCopy({ livingCreatures: 10, liveConfig: liveWorldConfig })
    expect(copy.title).toContain('clonal founders')
    expect(copy.title).not.toContain('configured trait variation')
    expect(stagedDraft).not.toEqual(liveWorldConfig)
  })
})

describe('terminal outcome resolution', () => {
  it('accepts a matching recorded outcome, including after later generations', () => {
    const record = terminal({ generation: 2 })

    expect(resolveTerminalOutcome({
      selectedIndividualId: 17,
      creatures: [],
      recordedOutcome: record,
      currentGeneration: 5,
    })).toEqual(record)
  })

  it('rejects a stale or future record that cannot describe the selected individual', () => {
    expect(resolveTerminalOutcome({
      selectedIndividualId: 17,
      creatures: [creature()],
      recordedOutcome: terminal({ individualId: 18 }),
      currentGeneration: 4,
    })).toBeNull()
    expect(resolveTerminalOutcome({
      selectedIndividualId: 17,
      creatures: [],
      recordedOutcome: terminal({ generation: 5 }),
      currentGeneration: 4,
    })).toBeNull()
  })

  it('falls back to the selected dead creature cause when the record is absent', () => {
    for (const cause of ['hunted', 'energy'] as const) {
      expect(resolveTerminalOutcome({
        selectedIndividualId: 17,
        creatures: [creature({ deathCause: cause })],
        recordedOutcome: null,
        currentGeneration: 4,
      })).toEqual({ individualId: 17, generation: 4, cause })
    }
  })

  it('does not resolve living or nonselected creatures into a terminal outcome', () => {
    expect(resolveTerminalOutcome({
      selectedIndividualId: 17,
      creatures: [creature({ alive: true })],
      recordedOutcome: terminal(),
      currentGeneration: 4,
    })).toBeNull()
    expect(resolveTerminalOutcome({
      selectedIndividualId: 17,
      creatures: [creature({ individualId: 18, deathCause: 'energy' })],
      recordedOutcome: terminal({ individualId: 18 }),
      currentGeneration: 4,
    })).toBeNull()
    expect(resolveTerminalOutcome({
      selectedIndividualId: null,
      creatures: [creature({ deathCause: 'energy' })],
      recordedOutcome: terminal(),
      currentGeneration: 4,
    })).toBeNull()
  })
})

describe('perception telemetry copy', () => {
  const diagnostics: PerceptionDiagnostics = {
    mode: 'realistic',
    reactionWindow: 7,
    creatures: { total: 5, detected: 3, range: 1, fov: 0, occlusion: 1, detection: 0 },
    food: { total: 4, detected: 2, range: 0, fov: 1, occlusion: 0, detection: 1 },
  }

  it('names the creature cohort and reconciles combined not-detected buckets', () => {
    expect(formatPerceptionTelemetry(diagnostics)).toEqual({
      creatures: 'Other active creatures detected 3/5',
      food: 'Food detected 2/4',
      notDetected: 'Not detected: 4 total · 1 out of range · 1 outside view · 1 blocked · 1 detection miss',
    })
  })

  it('uses plural detection misses while preserving zero rejection buckets', () => {
    expect(formatPerceptionTelemetry({
      ...diagnostics,
      creatures: { total: 2, detected: 0, range: 1, fov: 0, occlusion: 0, detection: 1 },
      food: { total: 0, detected: 0, range: 0, fov: 0, occlusion: 0, detection: 0 },
    }).notDetected).toBe('Not detected: 2 total · 1 out of range · 0 outside view · 0 blocked · 1 detection miss')
    expect(formatPerceptionTelemetry({
      ...diagnostics,
      creatures: { total: 3, detected: 0, range: 0, fov: 0, occlusion: 0, detection: 3 },
      food: { total: 0, detected: 0, range: 0, fov: 0, occlusion: 0, detection: 0 },
    }).notDetected).toContain('3 detection misses')
  })
})

describe('generation accounting loading state', () => {
  it('keeps both lazy sections visibly present and marked busy', () => {
    const markup = renderToStaticMarkup(createElement(GenerationAccountingFallback))
    expect(markup).toContain('Resource pressure')
    expect(markup).toContain('Loading resource pressure…')
    expect(markup).toContain('Generation accounting')
    expect(markup).toContain('Loading generation accounting…')
    expect(markup.match(/aria-busy="true"/g)).toHaveLength(2)
  })
})

describe('parameters loading state', () => {
  it('keeps the static settings shell useful while the controls load', () => {
    const markup = renderToStaticMarkup(createElement(ParametersPanelFallback))
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('Opening parameter controls…')
  })
})

describe('arena loading state', () => {
  it('preserves the arena footprint with concise accessible loading copy', () => {
    const markup = renderToStaticMarkup(createElement(ArenaCanvasFallback))
    expect(markup).toContain('data-arena-canvas-fallback="true"')
    expect(markup).toContain('Opening live arena…')
    expect(markup).toContain('Creature positions and action paths will appear shortly.')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('height:100%')
  })
})

describe('selected inspector shell',()=>{
  it('keeps the same local cohort controls and header mounted around dense details',()=>{
    const selected=createWorld({...defaultConfig,initialPopulation:1}).creatures[0]
    const actionControls={
      nextAction:()=>{},
      finishGeneration:()=>{},
      nextActionLabel:'Next selected',
      nextActionAriaLabel:'Pause and advance the simulation until Individual 17 reaches its next action beat',
      nextActionTitle:'Advance the simulation until Individual 17 reaches its next decision beat.',
      nextActionDisabled:false,
      finishGenerationDisabled:false,
      finishGenerationAriaLabel:'Pause and finish the current generation',
      finishGenerationTitle:'Pause and finish the current generation',
    }
    const markup=renderToStaticMarkup(createElement(SelectedInspectorShell,{selected,actionControls,onClose:()=>{},children:createElement('p',null,'Dense details')}))
    expect(markup).toContain('Continue simulation from selected individual details')
    expect(markup).toContain('Continue observing')
    expect(markup).toContain('Same simulation controls as above')
    expect(markup).toContain('Next selected')
    expect(markup).toContain('Individual 1')
    expect(markup).toContain('Dense details')
    expect(markup).toContain('Finish generation')
    expect(markup).not.toContain('aria-live')
  })

  it('keeps loading copy noninteractive while dense details suspend',()=>{
    const selected=createWorld({...defaultConfig,initialPopulation:1}).creatures[0]
    const actionControls={
      nextAction:()=>{},
      finishGeneration:()=>{},
      nextActionLabel:'Next selected',
      nextActionAriaLabel:'Advance Individual 1',
      nextActionTitle:'Advance Individual 1.',
      nextActionDisabled:false,
      finishGenerationDisabled:false,
      finishGenerationAriaLabel:'Pause and finish the current generation',
      finishGenerationTitle:'Pause and finish the current generation',
    }
    const Suspended=()=>{throw new Promise(()=>{})}
    const markup=renderToStaticMarkup(createElement(SelectedInspectorShell,{selected,actionControls,onClose:()=>{},children:createElement(Suspended)}))

    expect(markup).toContain('Opening individual details…')
    expect(markup).toContain('Next selected')
    expect(markup).toContain('Finish generation')
    expect(markup).not.toContain('aria-live')
  })
})

describe('simulation command coordination',()=>{
  const step:PendingSimulationCommand={kind:'step',id:41}
  const finish:PendingSimulationCommand={kind:'finish',id:42}

  it('accepts only one synchronous command and rejects either attempted order',()=>{
    expect(canStartSimulationCommand(null)).toBe(true)
    expect(canStartSimulationCommand(step)).toBe(false)
    expect(canStartSimulationCommand(finish)).toBe(false)
  })

  it('only clears the matching command acknowledgement',()=>{
    expect(simulationCommandAcknowledged(step,{stepId:41})).toBe(true)
    expect(simulationCommandAcknowledged(step,{stepId:40})).toBe(false)
    expect(simulationCommandAcknowledged(step,{finishId:41})).toBe(false)
    expect(simulationCommandAcknowledged(finish,{finishId:42})).toBe(true)
    expect(simulationCommandAcknowledged(finish,{finishId:41})).toBe(false)
    expect(simulationCommandAcknowledged(finish,{stepId:42})).toBe(false)
    expect(simulationCommandAcknowledged(null,{finishId:42})).toBe(false)
  })

  it('makes finish-pending copy visible and keeps both controls blocked',()=>{
    const input=ready({pending:true,pendingCommand:'finish',selectedIndividualId:17,selectedIsActive:true})
    expect(formatCompactNextActionLabel(input)).toBe('Finishing…')
    expect(formatNextActionCopy(input)).toEqual({
      buttonLabel:'Finishing generation…',
      ariaLabel:'Finish generation pending; wait for the current cohort to settle',
      title:'Finish generation is in progress; wait for settlement before starting another action.',
    })
  })
})

describe('live event story selection', () => {
  it('uses own activity-field presence to distinguish modern and legacy snapshots', () => {
    expect(hasOwnActivityField({ activity: [] })).toBe(true)
    expect(hasOwnActivityField({ events: [] })).toBe(false)
    expect(hasOwnActivityField(null)).toBe(false)
  })

  it('keeps both lazy fallbacks explicit and accessible', () => {
    const modern = renderToStaticMarkup(createElement(SimulationActivityFallback))
    const legacy = renderToStaticMarkup(createElement(InterventionFeedFallback))
    expect(modern).toContain('What happened')
    expect(modern).toContain('Opening retained run moments…')
    expect(legacy).toContain('Recent shocks')
    expect(legacy).toContain('Opening recorded shocks…')
    expect(modern).toContain('aria-busy="true"')
    expect(legacy).toContain('aria-busy="true"')
  })

  it('renders exactly one modern or legacy story branch', () => {
    const modern = renderToStaticMarkup(createElement(SimulationEventStory, { world: { activity: [], events: [] } as unknown as World }))
    const legacy = renderToStaticMarkup(createElement(SimulationEventStory, { world: { events: [] } as unknown as World }))
    expect(modern).toContain('What happened')
    expect(modern).not.toContain('Recent shocks')
    expect(legacy).toContain('Recent shocks')
    expect(legacy).not.toContain('What happened')
  })
})

describe('manual-step announcement coordination', () => {
  it('keeps the current observed path visible and live while step details load',()=>{
    const markup=renderToStaticMarkup(createElement(ObservedStepStoryFallback,{observedPath:'Next action pending…'}))
    expect(markup).toContain('Observed path')
    expect(markup).toContain('Opening step details…')
    expect(markup).toContain('Next action pending…')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
  })

  it('suppresses the global announcement only for a represented monotonic step event',()=>{
    const activity=[{sequence:2,generation:1,day:0,tick:1,kind:'food-collected' as const,summary:'Food collected.',count:1}]
    expect(stepActivityAnnouncementSequence({activity,window:{startSequence:1,endSequence:2,recordedCount:1,sequenceReset:false}})).toBe(2)
    expect(stepActivityAnnouncementSequence({activity,window:{startSequence:Number.MAX_SAFE_INTEGER,endSequence:2,recordedCount:0,sequenceReset:true}})).toBeNull()
    expect(stepActivityAnnouncementSequence({activity:[],window:{startSequence:1,endSequence:2,recordedCount:1,sequenceReset:false}})).toBeNull()
    expect(stepActivityAnnouncementSequence({activity,window:{startSequence:2,endSequence:2,recordedCount:0,sequenceReset:false}})).toBeNull()
  })
})

describe('manual-step story visibility lifecycle',()=>{
  const acknowledged=()=>transitionManualStepStoryState(initialManualStepStoryState(),{type:'step-acknowledged',observedPath:'Individual 1 foraged.',evidence:{activity:[],window:undefined}})

  it('shows the instructional card initially and restores it on reset',()=>{
    const initial=initialManualStepStoryState(),afterReset=transitionManualStepStoryState(acknowledged(),{type:'reset'})
    expect(initial).toMatchObject({visible:true,observedPath:INITIAL_OBSERVED_PATH,evidence:null})
    expect(afterReset).toEqual(initial)
  })

  it('hides stale manual narration and clears evidence for an explicitly acknowledged finish',()=>{
    const state=acknowledged(),finished=transitionManualStepStoryState(state,{type:'generation-snapshot',previousGeneration:1,nextGeneration:2,finishAcknowledged:true})
    expect(finished).toEqual({visible:false,observedPath:INITIAL_OBSERVED_PATH,evidence:null})
  })

  it('honors an explicit Finish acknowledgement even when the delivered generation is unchanged',()=>{
    const state=acknowledged(),finished=transitionManualStepStoryState(state,{type:'generation-snapshot',previousGeneration:2,nextGeneration:2,finishAcknowledged:true})
    expect(finished).toEqual({visible:false,observedPath:INITIAL_OBSERVED_PATH,evidence:null})
  })

  it('hides stale manual narration at an autoplay generation boundary',()=>{
    const state=acknowledged(),advanced=transitionManualStepStoryState(state,{type:'generation-snapshot',previousGeneration:1,nextGeneration:2})
    expect(advanced.visible).toBe(false)
    expect(advanced.evidence).toBeNull()
  })

  it('restores a hidden story immediately when a new manual Next action starts',()=>{
    const hidden=transitionManualStepStoryState(acknowledged(),{type:'generation-snapshot',previousGeneration:1,nextGeneration:2}),pending=transitionManualStepStoryState(hidden,{type:'next-action'})
    expect(pending).toEqual({visible:true,observedPath:'Next action pending…',evidence:null})
  })

  it('keeps acknowledged evidence on same-generation snapshots',()=>{
    const state=acknowledged(),sameGeneration=transitionManualStepStoryState(state,{type:'generation-snapshot',previousGeneration:1,nextGeneration:1})
    expect(sameGeneration).toBe(state)
  })

  it('lets a generation boundary win over a crossing acknowledged step, while same-generation acknowledgement restores the story',()=>{
    const state=acknowledged()
    const crossing=resolveManualStepStoryTransition({previousGeneration:1,nextGeneration:2,finishAcknowledged:false,stepAcknowledged:true,stepObservedPath:'New step path.',stepEvidence:state.evidence})
    const sameGeneration=resolveManualStepStoryTransition({previousGeneration:1,nextGeneration:1,finishAcknowledged:false,stepAcknowledged:true,stepObservedPath:'New step path.',stepEvidence:state.evidence})
    expect(crossing).toMatchObject({type:'generation-snapshot'})
    expect(sameGeneration).toEqual({type:'step-acknowledged',observedPath:'New step path.',evidence:state.evidence})
    expect(transitionManualStepStoryState(state,crossing!)).toMatchObject({visible:false,evidence:null})
    expect(transitionManualStepStoryState(state,sameGeneration!)).toMatchObject({visible:true,observedPath:'New step path.'})
  })

  it('keeps an interrupted manual step visible and retryable',()=>{
    const interrupted=transitionManualStepStoryState(acknowledged(),{type:'step-interrupted'})
    expect(interrupted).toMatchObject({visible:true,observedPath:'Manual step interrupted; choose Next action to retry.',evidence:null})
  })

  it('does not treat invalid or unchanged generation values as a boundary',()=>{
    expect(isManualStepStoryGenerationBoundary(1,1)).toBe(false)
    expect(isManualStepStoryGenerationBoundary(1,2)).toBe(true)
    expect(isManualStepStoryGenerationBoundary(2,1)).toBe(false)
    expect(isManualStepStoryGenerationBoundary(Number.NaN,2)).toBe(false)
    expect(isManualStepStoryGenerationBoundary(1.5,2)).toBe(false)
  })
})
