import { useEffect, useState } from 'react'
import type { LastInspectedOutcome, TerminalEndCause } from '../simulation/types'

export const TERMINAL_OUTCOME_LABELS:Record<TerminalEndCause,string>={
  hunted:'Hunted',
  energy:'Energy depleted',
  unfed:'No food at settlement',
  late:'Missed return deadline',
  aged:'Old age',
}

const TERMINAL_OUTCOME_EXPLANATIONS:Record<TerminalEndCause,string>={
  hunted:'A successful hunt removed this individual from the population.',
  energy:'It had no usable energy remaining during the generation or at settlement.',
  unfed:'It ended the generation without the food required to survive.',
  late:'It did not reach home before the generation ended.',
  aged:'It reached the configured maximum age at settlement.',
}

export interface TerminalOutcomeCopy{
  individualLabel:string
  endingGeneration:string
  label:string
  status:string
  explanation:string
  announcement:string
}

export function formatTerminalOutcome(outcome:LastInspectedOutcome):TerminalOutcomeCopy{
  const individualLabel=`Individual ${outcome.individualId}`
  return{
    individualLabel,
    endingGeneration:`Generation ${outcome.generation} terminal outcome`,
    label:TERMINAL_OUTCOME_LABELS[outcome.cause],
    status:`${individualLabel} is no longer in the living population.`,
    explanation:TERMINAL_OUTCOME_EXPLANATIONS[outcome.cause],
    announcement:`${individualLabel}, Generation ${outcome.generation} terminal outcome: ${TERMINAL_OUTCOME_LABELS[outcome.cause]}. This individual is no longer in the living population.`,
  }
}

export function TerminalOutcome({outcome,onDismiss}:{outcome:LastInspectedOutcome;onDismiss:()=>void}){
  const copy=formatTerminalOutcome(outcome)
  const [announcement,setAnnouncement]=useState('')
  useEffect(()=>setAnnouncement(copy.announcement),[copy.announcement])
  return <section className="inspector utility-breakdown" aria-label={`${copy.individualLabel} terminal outcome`}>
    <div className="inspector-head"><div><h2>{copy.individualLabel} · {copy.label}</h2><p>{copy.endingGeneration}</p></div><button type="button" onClick={onDismiss} aria-label={`Dismiss terminal outcome for ${copy.individualLabel}`}>×</button></div>
    <p>{copy.status}</p>
    <span>{copy.explanation}</span>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
  </section>
}

export default TerminalOutcome
