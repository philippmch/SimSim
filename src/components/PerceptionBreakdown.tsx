import type { PerceptionCounts, PerceptionDiagnostics } from '../simulation/types'

const outcomes = [
  ['detected', 'Detected'],
  ['range', 'Out of range'],
  ['fov', 'Outside view'],
  ['occlusion', 'Blocked by obstacles'],
  ['detection', 'Detection miss'],
] as const

/** A partial or contradictory sample must not look like measured zeroes. */
export function validPerceptionCounts(value: unknown, mode?: unknown): PerceptionCounts | null {
  if (!value || typeof value !== 'object') return null
  const counts = value as PerceptionCounts
  const keys = ['total', ...outcomes.map(([key]) => key)] as const
  if (!keys.every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) return null
  const accounted = outcomes.reduce((sum, [key]) => sum + counts[key], 0)
  return Number.isSafeInteger(accounted) && accounted === counts.total && (mode !== 'perfect' || counts.detected === counts.total) ? counts : null
}

export default function PerceptionBreakdown({ diagnostics }: { diagnostics: PerceptionDiagnostics }) {
  const perfect = diagnostics.mode === 'perfect'
  const knownMode = perfect || diagnostics.mode === 'realistic'
  const food = validPerceptionCounts(diagnostics.food, diagnostics.mode), creatures = validPerceptionCounts(diagnostics.creatures, diagnostics.mode)
  return <details className="utility-breakdown" data-perception-breakdown="true" style={{ maxWidth: 560, overflow: 'visible' }}>
    <summary style={{ minHeight: 44, padding: '10px 0', fontSize: 11 }}>Perception breakdown · food and creatures</summary>
    {knownMode ? <>
      <p>{perfect
        ? 'Perfect perception passes all supplied food and creatures to the decision stage. Target choices still use sensing range.'
        : 'Each item is counted once: detected, or at the first failed check in this order: range, view, obstacles, detection. A detection miss passed the other checks.'}</p>
      <table style={{ tableLayout: 'fixed', fontSize: 11, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
        <caption style={{ textAlign: 'left', padding: '8px 0', color: 'var(--muted)' }}>Recorded perception sample. Creature counts exclude this individual, dead creatures, and creatures at home.</caption>
        <thead><tr><th scope="col" style={{ width: '48%' }}>Outcome</th><th scope="col">Food</th><th scope="col">Other creatures</th></tr></thead>
        <tbody>{outcomes.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{food?.[key] ?? 'Unavailable'}</td><td>{creatures?.[key] ?? 'Unavailable'}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">Total in sample</th><td>{food?.total ?? 'Unavailable'}</td><td>{creatures?.total ?? 'Unavailable'}</td></tr></tfoot>
      </table>
      {(!food || !creatures) && <p>Unavailable counts are missing or inconsistent in this snapshot.</p>}
    </> : <p>Perception breakdown unavailable: the sample has no recognized perception mode.</p>}
  </details>
}
