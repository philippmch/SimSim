import { lazy, Suspense } from 'react'
import type { World } from '../simulation/types'
import { getStats, getModeCounts, getLineageAnalytics } from '../simulation/engine'
import { MAX_FOOD } from '../simulation/config'
import { CREATURE_STATE_METADATA, type CreatureState } from './ArenaCanvasModel'
import DashboardNavigation, { DASHBOARD_SECTION_IDS, DASHBOARD_SECTION_SCROLL_STYLE } from './DashboardNavigation'
const GenerationJournal=lazy(()=>import('./GenerationJournal'))
const InsightsPanel=lazy(()=>import('./InsightsPanel'))
const LivePulse=lazy(()=>import('./LivePulse'))
const PopulationStory=lazy(()=>import('./PopulationStory'))
const GenerationAccounting=lazy(()=>import('./GenerationAccounting'))

export default function DashboardPanels({world,livePulseRun,requestedGeneration,onSelectGeneration}:{world:World;livePulseRun:number;requestedGeneration:number|null;onSelectGeneration:(generation:number|null)=>void}){
const stats=getStats(world),lineage=getLineageAnalytics(world),living=world.creatures.filter(c=>c.alive).length,modes=getModeCounts(world)
const stateCounts:Record<CreatureState,number>={safe:living-Object.values(modes).reduce((sum,n)=>sum+n,0),...modes}
const creatureStates=Object.entries(CREATURE_STATE_METADATA) as [CreatureState,(typeof CREATURE_STATE_METADATA)[CreatureState]][]
return <>        <DashboardNavigation/>

        <div className="dashboard">
          <details className="workspace-disclosure"><summary>Live statistics<small>Counts, traits, energy, and activity</small></summary>
          <section id={DASHBOARD_SECTION_IDS.liveOverview} tabIndex={-1} className="dashboard" aria-label="Live statistics" style={DASHBOARD_SECTION_SCROLL_STYLE}>
          <div className="summary-strip">
            <div className="population-summary"><span>Living population</span><strong>{living}</strong><small>Generation {world.generation}</small></div>
            <dl className="trait-summary">
              <div><dt>Average speed</dt><dd>{stats.avgSpeed.toFixed(2)}</dd></div>
              <div><dt>Average size</dt><dd>{stats.avgSize.toFixed(2)}</dd></div>
              <div><dt>Average sense</dt><dd>{stats.avgSense.toFixed(2)}</dd></div>
            </dl>
          </div>
          <div className="behavior-summary" aria-label="Live behavior gene averages">
            <strong>Inherited behavior</strong><span>Aggression <b>{stats.avgAggression.toFixed(2)}</b></span><span>Caution <b>{stats.avgCaution.toFixed(2)}</b></span><span>Exploration <b>{stats.avgExploration.toFixed(2)}</b></span>
          </div>
          <div className="mode-line activity-line" aria-label={`What creatures are doing now. ${living} living creatures total.`}><strong>What creatures are doing now</strong>{creatureStates.map(([state,metadata])=><span key={state}><i aria-hidden="true" style={{backgroundColor:metadata.color}}/><b>{stateCounts[state]}</b> {metadata.label.toLowerCase()}</span>)}</div>
          <Suspense fallback={<div className="ecology-line activity-line" role="group" aria-label="Live simulation pulse. Waiting for the next simulation update."><strong>Live pulse</strong><span>Waiting for the next simulation update.</span></div>}><LivePulse key={livePulseRun} world={world}/></Suspense>
          <div className="ecology-line" aria-label="Current model and energy statistics"><strong>{world.config.ecologyMode==='energy-regrowth'?'Ecological model':'Classic model'}</strong><span>{world.config.perceptionMode==='realistic'?'Directional vision':'Perfect local vision'}</span><span>{world.config.predationMode==='contest'?'Hunts can fail':'Larger creatures catch smaller prey'}</span><span>mean energy <b>{stats.avgEnergy.toFixed(1)}</b></span><span>mean age <b>{stats.avgAge.toFixed(1)}</b></span></div>
          <Suspense fallback={<p>Opening generation accounting…</p>}><GenerationAccounting world={world} globalFoodCap={MAX_FOOD}/></Suspense>
          </section>
          </details>
          <details className="workspace-disclosure"><summary>Generation journal<small>Review each generation in detail</small></summary>
          <section id={DASHBOARD_SECTION_IDS.generationJournal} tabIndex={-1} aria-label="Generation journal review" style={DASHBOARD_SECTION_SCROLL_STYLE}><Suspense fallback={<div className="evolution-story generation-journal" aria-busy="true"><p className="journal-empty" role="status">Opening generation journal…</p></div>}><GenerationJournal ledgers={world.ledger} events={world.events} requestedGeneration={requestedGeneration} onRequestedGenerationChange={onSelectGeneration}/></Suspense></section>
          </details>
          <details className="workspace-disclosure"><summary>Families and inheritance<small>Explore lineages and inherited traits</small></summary>
          <section id={DASHBOARD_SECTION_IDS.populationLineages} tabIndex={-1} aria-label="Population & lineages" style={DASHBOARD_SECTION_SCROLL_STYLE}><Suspense fallback={<div className="evolution-story" aria-busy="true"><p className="journal-empty" role="status">Opening population story…</p></div>}><PopulationStory lineage={lineage}/></Suspense></section>
          </details>
          <details className="workspace-disclosure"><summary>Charts and comparisons<small>Explore how the population changes</small></summary>
          <section id={DASHBOARD_SECTION_IDS.insightsCharts} tabIndex={-1} aria-label="Insights & charts" style={DASHBOARD_SECTION_SCROLL_STYLE}><Suspense fallback={<div className="evolution-story generation-journal" aria-busy="true"><p className="journal-empty" role="status">Opening insights…</p></div>}><InsightsPanel world={world} requestedGeneration={requestedGeneration} onSelectGeneration={onSelectGeneration}/></Suspense></section>
          </details>
        </div>
</>
}
