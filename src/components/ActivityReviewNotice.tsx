import { useEffect, useRef } from 'react'
import type { World } from '../simulation/types'
import type { SimulationActivityMoment } from './SimulationActivity'

export default function ActivityReviewNotice({ moment, creatures, focusFrom, onReturnToLatest }: {
  moment: SimulationActivityMoment
  creatures: World['creatures']
  focusFrom?: Element | null
  onReturnToLatest: () => void
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    // A lazy notice must not steal focus if the user moved to another control
    // while its module was loading. Actor inspection keeps picker focus.
    if (focusFrom && (document.activeElement === focusFrom || document.activeElement === document.body)) ref.current?.focus()
  }, [moment, focusFrom])
  const actors = [...moment.actorIds, moment.attackerId, moment.preyId]
  const hasLivingActor = creatures.some(creature => creature.alive && actors.includes(creature.individualId))
  return <section ref={ref} tabIndex={-1} className="interventions inspector-focus-target" aria-label="Arena event review" aria-describedby="arena-review-provenance arena-review-summary arena-review-positions" style={{ flexWrap: 'wrap' }}>
    <span style={{ flex: '1 1 220px', whiteSpace: 'normal' }}>
      <strong>Reviewing retained event · playback paused</strong>
      <small id="arena-review-provenance">Recorded Generation {moment.generation} · day {moment.day.toFixed(2)} · tick {moment.tick}</small>
    </span>
    <button type="button" onClick={onReturnToLatest}>Return to latest event</button>
    <p id="arena-review-summary" style={{ flexBasis: '100%', fontSize: 12 }}>{moment.summary}</p>
    <p id="arena-review-positions" style={{ flexBasis: '100%', fontSize: 11, color: 'var(--muted)' }}>
      {moment.location ? 'The orange Then marker shows the recorded event site. ' : 'No historical site was recorded for this event. '}
      {hasLivingActor ? 'Living actors are shown at their current positions, not their past positions.' : 'No involved actor has a current living position to show.'}
      {' '}This is event review, not a replay. Play, Next action, Finish generation, and live shocks return to the latest event.
    </p>
  </section>
}
