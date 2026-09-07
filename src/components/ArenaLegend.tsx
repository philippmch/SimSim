import { useId } from 'react'
import type { EcologyMode } from '../simulation/types'
import { CREATURE_STATE_METADATA } from './ArenaCanvasModel'
import './ArenaLegend.css'

type SymbolKind = 'creature' | 'food' | 'rock' | 'patch'

function ArenaSymbol({ kind, classic = false, decorative = false }: { kind: SymbolKind; classic?: boolean; decorative?: boolean }) {
  const gradientId = useId()
  const names = { creature: 'Teardrop-shaped creature', food: 'Small lime food balls', rock: 'Large shaded rock', patch: classic ? 'Soft shaded food patch area' : 'Food patch circle with stock ring and 1.0× multiplier' }
  return <svg className={`arena-legend-symbol arena-legend-symbol-${kind}`} viewBox={kind === 'patch' && !classic ? '0 0 72 82' : '0 0 72 72'} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : names[kind]} aria-hidden={decorative || undefined}>
    <defs><radialGradient id={gradientId} cx="30%" cy="25%" r="80%"><stop offset="0" stopColor={kind === 'rock' ? '#a6b4a3' : '#e2f69c'} /><stop offset=".48" stopColor={kind === 'rock' ? '#70806f' : kind === 'food' ? '#b5d467' : '#5cb599'} /><stop offset="1" stopColor={kind === 'rock' ? '#374c3c' : kind === 'food' ? '#657e37' : '#27563f'} /></radialGradient></defs>
    {kind === 'creature' && <><ellipse cx="36" cy="58" rx="21" ry="6" fill="#142b22" opacity=".2" /><path d="M20 54 C12 37 24 10 36 10 C48 10 60 37 52 54 Q36 65 20 54Z" fill={`url(#${gradientId})`} stroke="#19372a" strokeWidth="6" /><path d="M20 54 C12 37 24 10 36 10 C48 10 60 37 52 54 Q36 65 20 54Z" fill="none" stroke={CREATURE_STATE_METADATA.exploring.color} strokeWidth="3" /><circle cx="31" cy="28" r="2" fill="#183329" /><circle cx="41" cy="28" r="2" fill="#183329" /></>}
    {kind === 'food' && <>{[[24, 26, 7], [47, 37, 8], [28, 50, 6]].map(([cx, cy, r]) => <circle key={cx + cy} cx={cx} cy={cy} r={r} fill={`url(#${gradientId})`} stroke="#607b35" strokeWidth=".7" />)}</>}
    {kind === 'rock' && <><ellipse cx="37" cy="58" rx="25" ry="6" fill="#142b22" opacity=".2" /><circle cx="36" cy="35" r="24" fill={`url(#${gradientId})`} stroke="#596c55" strokeWidth="1" /></>}
    {kind === 'patch' && (classic
      ? <><defs><radialGradient id={`${gradientId}-halo`}><stop offset="0" stopColor="#659f6b" stopOpacity=".3" /><stop offset="1" stopColor="#659f6b" stopOpacity="0" /></radialGradient></defs><circle cx="36" cy="36" r="32" fill={`url(#${gradientId}-halo)`} /><circle cx="30" cy="29" r="4" fill="#a4c864" /><circle cx="44" cy="39" r="4" fill="#a4c864" /></>
      : <><text x="36" y="12" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor">1.0×</text><circle cx="36" cy="46" r="25" fill="#659f6b" fillOpacity=".08" stroke="var(--green)" strokeWidth="1.6" strokeDasharray="4 4" /><circle cx="36" cy="46" r="11" fill="none" stroke="#72a178" strokeOpacity=".25" strokeWidth="3" /><circle cx="36" cy="46" r="11" fill="none" stroke="var(--green)" strokeWidth="3" strokeDasharray="44 70" transform="rotate(-90 36 46)" /></>)}
  </svg>
}

export default function ArenaLegend({ ecologyMode }: { ecologyMode: EcologyMode }) {
  const classic = ecologyMode === 'classic'
  return <details className="arena-legend">
    <summary className="arena-legend-summary">
      <span className="arena-legend-heading">How to read the arena<span className="arena-legend-invitation">Open the visual guide</span></span>
      <span className="arena-legend-preview">{([['creature', 'Creatures'], ['food', 'Food'], ['rock', 'Rocks'], ['patch', 'Food patches']] as const).map(([kind, label]) => <span key={kind}><ArenaSymbol kind={kind} classic={classic} decorative /><span>{label}</span></span>)}</span>
      <span className="arena-legend-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div className="arena-legend-content">
      <div className="arena-legend-items">
        <div className="arena-legend-item"><ArenaSymbol kind="creature" /><div><h3>Creatures</h3><p>The moving teardrops try to find food and return home to the arena’s edge. Body color shows speed: teal is slower, yellow is faster. The bright outline shows their current action. A number inside the body counts food carried.</p>{!classic && <p>Resting at home still uses energy. Hungry creatures can leave to forage again when there is time.</p>}</div></div>
        <div className="arena-legend-item"><ArenaSymbol kind="food" /><div><h3>Food</h3><p>The small lime-green balls are food. Creatures collect them to {classic ? 'survive and reproduce' : 'gain energy, survive and reproduce'}.</p></div></div>
        <div className="arena-legend-item"><ArenaSymbol kind="rock" /><div><h3>Rocks</h3><p>The larger shaded gray-green balls are obstacles. Creatures have to move around them.</p></div></div>
        <div className="arena-legend-item"><ArenaSymbol kind="patch" classic={classic} /><div><h3>Food patches</h3>{classic ? <p>The softly shaded areas mark places where food tends to appear.</p> : <><p>The dashed circle marks a food-growing area. <strong>1.0× means normal</strong> regrowth and food energy. Higher means faster regrowth and more energy per food; lower means less of both.</p><p>The inner ring fills as the patch contains more food.</p></>}</div></div>
      </div>
      <div className="arena-legend-actions"><strong>Outline colors</strong><ul>{Object.entries(CREATURE_STATE_METADATA).map(([key, state]) => <li key={key}><i style={{ background: state.color }} aria-hidden="true" />{state.label}</li>)}</ul></div>
      <div className="arena-legend-help"><p><strong>Start watching.</strong> Play runs the simulation. Next action advances to a noticeable action. Finish generation settles the current round. At the end of a generation, survivors may have offspring that inherit their traits.</p><p><strong>Take a closer look.</strong> Click a creature or food patch for details. A selected creature has a gold ring; its gold area shows sight. A dashed line points to its last chosen destination, rather than tracing its journey. Dotted circles mark living relatives. Colored rings mark remembered food or danger locations.</p></div>
    </div>
  </details>
}
