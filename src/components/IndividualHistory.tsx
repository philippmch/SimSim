import type { Creature, World } from '../simulation/types'
import { MAX_INDIVIDUAL_ACTIVITY } from '../simulation/individualHistory'
import { isSameActivityReview } from './ActivityReviewModel'
import { deriveActivityActorTargets, deriveSimulationActivity, formatActivityProvenance, isActivityReviewSource, normalizeActivityMoment, resolveActivityReviewMoment, type SimulationActivityMoment } from './SimulationActivity'

/** Resolve duplicate metadata before testing actor membership; array positions never confer identity. */
export function deriveIndividualHistory(activity: unknown, individualId: number, activityDropped?: unknown, archive?: unknown) {
  const feed = deriveSimulationActivity(activity, activityDropped)
  const seen: SimulationActivityMoment[] = []
  const entries: { moment: SimulationActivityMoment; role: string; reviewable: boolean }[] = []
  const archiveSource = Array.isArray(archive) ? archive.slice(-MAX_INDIVIDUAL_ACTIVITY) : []
  const archived = archiveSource.map((entry, index) => normalizeActivityMoment(entry, index)).filter((entry): entry is SimulationActivityMoment => entry !== null).reverse()
  if (Number.isSafeInteger(individualId) && individualId > 0) {
    for (const source of [...feed.entries, ...archived]) {
      const fromLive = feed.entries.includes(source)
      const stable = isActivityReviewSource(fromLive ? activity : archiveSource, source)
      const live = stable ? resolveActivityReviewMoment(activity, source) : null
      const moment = live ?? source
      const reviewable = fromLive && stable && live !== null
      if (stable && seen.some(previous => isSameActivityReview(previous, moment))) continue
      if (stable) seen.push(moment)
      const actor = deriveActivityActorTargets(moment, []).find(actor => actor.individualId === individualId)
      if (actor) entries.push({ moment, role: actor.roleLabel, reviewable })
    }
  }
  // Sequence is the engine's append order, even when generations have different day lengths.
  entries.sort((a, b) => a.moment.sequence - b.moment.sequence || a.moment.sourceIndex - b.moment.sourceIndex)
  return { entries, feed }
}

export interface IndividualHistoryProps {
  selected: Pick<Creature, 'individualId' | 'birthGeneration' | 'parentIndividualId' | 'lineageId'>
  world: Pick<World, 'activity' | 'activityDropped' | 'individualActivity' | 'individualActivityDropped'>
  onReviewMoment?: (moment: SimulationActivityMoment) => void
}

export default function IndividualHistory({ selected, world, onReviewMoment }: IndividualHistoryProps) {
  const { entries } = deriveIndividualHistory(world.activity, selected.individualId, world.activityDropped, world.individualActivity)
  const dropped = world.individualActivityDropped
  return <details className="utility-breakdown" data-individual-history={selected.individualId}>
    <summary>Individual history · {entries.length} retained {entries.length === 1 ? 'event' : 'events'}</summary>
    <p>Born generation {selected.birthGeneration} · {selected.parentIndividualId === null ? 'founder' : `parent ${selected.parentIndividualId}`} · lineage {selected.lineageId}</p>
    <p style={{ color: 'var(--muted)' }}>Oldest first, across generations. Only key events naming individual {selected.individualId} appear; relatives and movement-only ticks are excluded. This is a shared archive of up to {MAX_INDIVIDUAL_ACTIVITY} actor events, not a complete lifetime record.</p>
    <p style={{ color: 'var(--muted)' }}>{Number.isSafeInteger(dropped) && dropped! >= 0 ? `${dropped} older actor events have left the archive across the whole run.` : 'Earlier retention history is unavailable in this snapshot.'} Reviewing a recent event pauses the run and marks its historical site; it does not rewind the world. Older archived events retain their details below.</p>
    {entries.length === 0 ? <p>No retained events name this individual yet. Earlier events may have left the archive.</p> : <ol style={{ paddingLeft: 20, maxHeight: 280, overflowY: 'auto', overflowWrap: 'anywhere' }} aria-label={`Retained history for individual ${selected.individualId}`}>
      {entries.map(({ moment, role, reviewable }, index) => <li key={`${moment.sequence}-${moment.sourceIndex}-${index}`} style={{ marginBottom: 10 }}>
        <strong>{formatActivityProvenance(moment)} · {moment.kindLabel}</strong>
        <p style={{ margin: '3px 0' }}>{role} · {moment.summary}</p>
        {reviewable && onReviewMoment ? <button className="settings-toggle" type="button" style={{ minHeight: 44 }} aria-label={`Review ${moment.kindLabel.toLowerCase()} in generation ${moment.generation}, day ${moment.day.toFixed(2)}, record ${moment.sequence}`} onClick={() => onReviewMoment(moment)}>Review in arena</button> : !reviewable && <small>Details only · outside the recent arena review trail or missing a stable record identity.</small>}
      </li>)}
    </ol>}
  </details>
}
