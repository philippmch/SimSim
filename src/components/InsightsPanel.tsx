import { useState } from 'react'
import { BehaviorHistory, buildGenerationDelta, buildHistoryTimeline, formatGenerationDelta, Histogram, HistoryChart, resolveTimelineGeneration, summarizeDistribution } from './Charts'
import type { BiologicalTrait, World } from '../simulation/types'

export interface InsightsPanelProps {
  world: World
  requestedGeneration: number | null
  onSelectGeneration: (generation: number) => void
}

export function InsightsPanel({ world, requestedGeneration, onSelectGeneration }: InsightsPanelProps) {
  const [distributionTrait, setDistributionTrait] = useState<BiologicalTrait>('speed')
  const distribution = summarizeDistribution(world.creatures.filter(creature => creature.alive).map(creature => creature[distributionTrait]))
  const historyTimeline = buildHistoryTimeline(world.ledger, world.history, world.events)
  const historyStart = historyTimeline[0]?.generation ?? 0
  const historyEnd = historyTimeline.at(-1)?.generation ?? 0
  const selectedHistoryGeneration = resolveTimelineGeneration(historyTimeline, requestedGeneration)
  const generationDelta = buildGenerationDelta(world.history, selectedHistoryGeneration)

  return <div className="insights">
    <div className="chart-card histogram-card"><div className="card-head"><div><h2>Current trait distribution</h2><p>Mean {distribution.mean.toFixed(2)} · median {distribution.median.toFixed(2)} · IQR {distribution.iqr.toFixed(2)} · SD {distribution.sd.toFixed(2)}</p></div><label className="metric-select">Metric <select value={distributionTrait} onChange={e => setDistributionTrait(e.target.value as BiologicalTrait)}>{(['speed', 'size', 'sense', 'aggression', 'caution', 'exploration'] as BiologicalTrait[]).map(trait => <option key={trait}>{trait}</option>)}</select></label></div><Histogram world={world} trait={distributionTrait}/></div>
    <div className="chart-card history-card"><div className="card-head"><div><h2>Generational history</h2><p>Outcomes → next population; each row has its own scale</p></div>{historyTimeline.length > 0 && <span>Gen {historyStart}–{historyEnd}</span>}</div><HistoryChart world={world} requestedGeneration={requestedGeneration} onSelectGeneration={onSelectGeneration}/><div className="journal-takeaway"><strong>Observed change since previous generation</strong><span>{formatGenerationDelta(generationDelta)}</span></div></div>
    <div className="chart-card behavior-history-card"><div className="card-head"><div><h2>Behavior history</h2><p>Inherited tendencies in each next population, on a 0–1 scale</p></div>{historyTimeline.length > 0 && <span>Gen {historyStart}–{historyEnd}</span>}</div><BehaviorHistory world={world} requestedGeneration={requestedGeneration}/></div>
  </div>
}

export default InsightsPanel
