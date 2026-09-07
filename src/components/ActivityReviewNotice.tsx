import { useEffect, useRef, useState } from 'react'
import type { World } from '../simulation/types'
import { deriveSimulationActivity, formatActivityProvenance, isActivityReviewSource, resolveActivityReviewMoment, type SimulationActivityMoment } from './SimulationActivity'
import { isSameActivityReview } from './ActivityReviewModel'

export function deriveActivityReviewNavigation(activity: unknown, selected: SimulationActivityMoment) {
  const records: SimulationActivityMoment[] = []
  for (const moment of deriveSimulationActivity(activity).entries) {
    if (isActivityReviewSource(activity, moment) && !records.some(record => isSameActivityReview(record, moment))) records.push(moment)
  }
  records.reverse()
  return { records, index: records.findIndex(record => isSameActivityReview(record, selected)) }
}

export default function ActivityReviewNotice({ moment, creatures, focusFrom, onReturnToLatest, activity, onReviewMoment }: {
  moment: SimulationActivityMoment
  creatures: World['creatures']
  focusFrom?: Element | null
  onReturnToLatest: () => void
  activity?: unknown
  onReviewMoment?: (moment: SimulationActivityMoment) => void
}) {
  const ref = useRef<HTMLElement>(null)
  const rangeRef = useRef<HTMLInputElement>(null)
  const browsingRef = useRef<HTMLElement | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const { records, index } = deriveActivityReviewNavigation(activity, moment)
  moment = resolveActivityReviewMoment(activity, moment) ?? moment
  const recordDescription = `Record ${index + 1} of ${records.length}: ${formatActivityProvenance(moment)} · tick ${moment.tick} · ${moment.summary}`
  const browse = (next: number, control: HTMLElement) => {
    if (!onReviewMoment || !records[next] || next === index) return
    browsingRef.current = control
    onReviewMoment(records[next])
  }
  useEffect(() => {
    const control = browsingRef.current
    browsingRef.current = null
    if (control) {
      setAnnouncement(control instanceof HTMLButtonElement ? recordDescription : '')
      if (control instanceof HTMLButtonElement && control.disabled && (document.activeElement === control || document.activeElement === document.body)) rangeRef.current?.focus()
      return
    }
    // A lazy notice must not steal focus if the user moved to another control
    // while its module was loading. Actor inspection keeps picker focus.
    if (focusFrom && (document.activeElement === focusFrom || document.activeElement === document.body)) ref.current?.focus()
  }, [moment.sequence, moment.sourceIndex, moment.generation, moment.tick, moment.kind, moment.summary, focusFrom, recordDescription])
  const actors = [...moment.actorIds, moment.attackerId, moment.preyId]
  const hasLivingActor = creatures.some(creature => creature.alive && actors.includes(creature.individualId))
  return <section ref={ref} tabIndex={-1} className="interventions inspector-focus-target" aria-label="Arena event review" aria-describedby="arena-review-provenance arena-review-summary arena-review-positions" style={{ flexWrap: 'wrap' }}>
    <span id="arena-review-announcement" className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    <span style={{ flex: '1 1 220px', whiteSpace: 'normal' }}>
      <strong>Past event · simulation paused</strong>
      <small id="arena-review-provenance">Recorded Generation {moment.generation} · day {moment.day.toFixed(2)} · tick {moment.tick}</small>
    </span>
    <button type="button" onClick={onReturnToLatest}>Return to latest event</button>
    {onReviewMoment && index >= 0 && <div role="group" aria-label="Browse retained events" style={{ flex: '1 1 100%', minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <button type="button" disabled={index === 0} onClick={event => browse(index - 1, event.currentTarget)} style={{ minHeight: 44 }}>Earlier</button>
      <label style={{ flex: '1 1 130px', minWidth: 0, fontSize: 11 }}>Record {index + 1} of {records.length}
        <input ref={rangeRef} type="range" aria-label="Browse retained events" aria-valuetext={recordDescription} min={1} max={records.length} value={index + 1} disabled={records.length < 2} onChange={event => browse(Number(event.target.value) - 1, event.currentTarget)} style={{ display: 'block', width: '100%', minHeight: 44 }}/>
      </label>
      <button type="button" disabled={index === records.length - 1} onClick={event => browse(index + 1, event.currentTarget)} style={{ minHeight: 44 }}>Later</button>
      <small style={{ flexBasis: '100%' }}>Earlier → later retained records. Browsing changes the event shown, not simulation time; this is not a replay.</small>
    </div>}
    <p id="arena-review-summary" style={{ flexBasis: '100%', fontSize: 12 }}>{moment.summary}</p>
    <p id="arena-review-positions" style={{ flexBasis: '100%', fontSize: 11, color: 'var(--muted)' }}>
      {moment.location ? '“Happened here” marks where this event occurred. ' : 'This event has no recorded location. '}
      {hasLivingActor ? 'Highlighted creatures show where they are now.' : 'No creatures from this event are visible now.'}
      {' '}The simulation has not rewound.
    </p>
  </section>
}
