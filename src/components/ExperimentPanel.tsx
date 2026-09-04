import { useEffect, useMemo, useRef, useState } from 'react'
import type { Config } from '../simulation/types'
import {
  EXPERIMENT_METRIC_OPTIONS,
  EXPERIMENT_PRESETS,
  DEFAULT_EXPERIMENT_STUDY_SIZE,
  availableInterventionConstraints,
  applyExperimentPreset,
  applyExperimentStudySize,
  buildExperimentPlan,
  constraintFor,
  defaultExperimentDraft,
  experimentProgressIsCurrent,
  experimentCompletionMessage,
  experimentEarlyStopNote,
  experimentGenerationRunCount,
  EXPERIMENT_STUDY_SIZES,
  identifyExperimentStudySize,
  latestComparableAggregate,
  maximumExperimentGenerations,
  normalizeInterventionValue,
  formatExperimentMetricValue,
  treatmentNoOpReason,
  workerEventIsCurrent,
  type ExperimentDraft,
  type ExperimentPreset,
  type ExperimentStudySizeSelection,
} from '../experiments/panel'
import { ExperimentCancelledError, runExperiment } from '../experiments/runner'
import { fromExperimentJson, toExperimentJson, toTidyCsv } from '../experiments/serialize'
import type { ExperimentPlan, ExperimentProgress, ExperimentResult, InterventionConfigKey } from '../experiments/types'
import type { ExperimentWorkerEvent, ExperimentWorkerRequest } from '../experiments/protocol'
import { ExperimentSettlementEvidence } from './ExperimentSettlementEvidence'

interface ExperimentPanelProps {
  baseConfig: Config
  onClose: () => void
  onReplay: (config: Config) => void
}

type RunStatus = 'idle' | 'running' | 'cancelling' | 'complete' | 'cancelled' | 'error'

const metricLabel = (key: string) => EXPERIMENT_METRIC_OPTIONS.find(item => item.key === key)?.label ?? key
const format = formatExperimentMetricValue

function download(name: string, type: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function linePath(points: { x: number; value: number | null }[], y: (value: number) => number): string {
  let path = '', open = false
  for (const point of points) {
    if (point.value === null) { open = false; continue }
    path += `${open ? 'L' : 'M'}${point.x.toFixed(1)} ${y(point.value).toFixed(1)} `
    open = true
  }
  return path.trim()
}

function areaPaths(points: { x: number; low: number | null; high: number | null }[], y: (value: number) => number): string[] {
  const groups: typeof points[] = []
  let group: typeof points = []
  for (const point of points) {
    if (point.low === null || point.high === null) { if (group.length) groups.push(group); group = []; continue }
    group.push(point)
  }
  if (group.length) groups.push(group)
  return groups.map(segment => {
    const upper = segment.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${y(point.high!).toFixed(1)}`).join(' ')
    const lower = [...segment].reverse().map(point => `L${point.x.toFixed(1)} ${y(point.low!).toFixed(1)}`).join(' ')
    return `${upper} ${lower} Z`
  })
}

function ResultPlot({ result }: { result: ExperimentResult }) {
  const metric = result.plan.metrics[0]
  const points = result.aggregates.filter(point => point.metric === metric)
  const values = points.flatMap(point => [point.scenarioA.q1, point.scenarioA.q3, point.scenarioB.q1, point.scenarioB.q3]).filter((value): value is number => value !== null)
  const rawMax = Math.max(0, ...values), rawMin = Math.min(0, ...values)
  const span = Math.max(.001, rawMax - rawMin)
  const min = rawMin < 0 ? rawMin - span * .06 : 0
  const max = rawMax + span * .08
  const left = 58, right = 770, top = 18, bottom = 220
  const x = (generation: number) => points.length < 2 ? (left + right) / 2 : left + (generation - 1) / (points.length - 1) * (right - left)
  const y = (value: number) => bottom - (value - min) / (max - min || 1) * (bottom - top)
  const control = points.map(point => ({ x: x(point.generation), value: point.scenarioA.median, low: point.scenarioA.q1, high: point.scenarioA.q3 }))
  const treatment = points.map(point => ({ x: x(point.generation), value: point.scenarioB.median, low: point.scenarioB.q1, high: point.scenarioB.q3 }))
  const ticks = [min, min + (max - min) / 2, max]
  return <div className="experiment-plot-wrap">
    <svg className="experiment-plot" viewBox="0 0 800 250" role="img" aria-labelledby="experiment-plot-title experiment-plot-desc">
      <title id="experiment-plot-title">{metricLabel(metric)} across generations</title>
      <desc id="experiment-plot-desc">Control and treatment medians share one vertical scale. Shaded regions show the middle fifty percent across paired replicates.</desc>
      {ticks.map(tick => <g key={tick}><line className="experiment-grid" x1={left} x2={right} y1={y(tick)} y2={y(tick)}/><text x={left - 8} y={y(tick) + 4} textAnchor="end">{format(tick, metric)}</text></g>)}
      {areaPaths(control, y).map((path, index) => <path key={`ca-${index}`} className="experiment-area control" d={path}/>)}
      {areaPaths(treatment, y).map((path, index) => <path key={`ta-${index}`} className="experiment-area treatment" d={path}/>)}
      <path className="experiment-line control" d={linePath(control, y)}/>
      <path className="experiment-line treatment" d={linePath(treatment, y)}/>
      <text x={left} y={bottom + 24}>1</text><text x={right} y={bottom + 24} textAnchor="end">{points.length}</text>
    </svg>
    <div className="experiment-legend" aria-hidden="true"><span><i className="control"/>Control median + interval</span><span><i className="treatment"/>Treatment median + interval</span></div>
  </div>
}

function Results({ result, onReplay }: { result: ExperimentResult; onReplay: (config: Config) => void }) {
  const metric = result.plan.metrics[0]
  const points = result.aggregates.filter(point => point.metric === metric)
  const final = latestComparableAggregate(points)
  const plannedGenerationRuns = experimentGenerationRunCount(result.plan.replicates, result.plan.generations)
  const earlyStopNote = experimentEarlyStopNote(result.completedGenerationRuns, plannedGenerationRuns)
  const [replicate, setReplicate] = useState(0)
  const exportJson = () => {
    const json = toExperimentJson(result)
    fromExperimentJson(json)
    download(`${result.plan.id}.json`, 'application/json', json)
  }
  const selectedReplicate = Math.max(0, Math.min(result.replicates.length - 1, replicate))
  return <section className="experiment-results" aria-labelledby="experiment-results-title">
    <div className="experiment-results-head"><div><h3 id="experiment-results-title">Paired result</h3><p>{result.replicates.length} matched seeds · {metricLabel(metric)}</p>{earlyStopNote && <p>{earlyStopNote}</p>}</div><div className="experiment-effect">{final ? <><span>{final.generation === result.plan.generations ? 'Final treatment − control' : `Last comparable treatment − control · gen ${final.generation}`}</span><strong>{format(final.effect.mean, metric)}</strong><small>n={final.effect.count} comparable pairs · mean · median {format(final.effect.median, metric)}</small></> : <><span>No comparable paired effect</span><strong>—</strong><small>No generation had a numeric effect for both arms.</small></>}</div></div>
    <ExperimentSettlementEvidence result={result} metric={metric} replicateIndex={selectedReplicate} onReplicateChange={setReplicate} onReplay={onReplay}/>
    <ResultPlot result={result}/>
    <div className="experiment-table-wrap"><table className="experiment-table"><caption>Per-generation medians, middle 50% intervals, and paired effects</caption><thead><tr><th>Gen</th><th>Control</th><th>Treatment</th><th>Effect</th></tr></thead><tbody>{points.map(point => <tr key={point.generation}><th>{point.generation}</th><td>{format(point.scenarioA.median, metric)} <small>[{format(point.scenarioA.q1, metric)}–{format(point.scenarioA.q3, metric)}]</small></td><td>{format(point.scenarioB.median, metric)} <small>[{format(point.scenarioB.q1, metric)}–{format(point.scenarioB.q3, metric)}]</small></td><td>{format(point.effect.mean, metric)} <small>mean · n={point.effect.count}</small></td></tr>)}</tbody></table></div>
    <div className="experiment-result-actions">
      <button onClick={exportJson}>Export JSON</button>
      <button onClick={() => download(`${result.plan.id}.csv`, 'text/csv;charset=utf-8', toTidyCsv(result))}>Export tidy CSV</button>
    </div>
  </section>
}

export function ExperimentPanel({ baseConfig, onClose, onReplay }: ExperimentPanelProps) {
  const [draft, setDraft] = useState<ExperimentDraft>(() => defaultExperimentDraft(baseConfig))
  const [studySize, setStudySize] = useState<ExperimentStudySizeSelection>(() => identifyExperimentStudySize(draft.replicates, draft.generations))
  const [preset, setPreset] = useState<ExperimentPreset | 'custom'>('drought')
  const [status, setStatus] = useState<RunStatus>('idle')
  const [runtime, setRuntime] = useState<'worker' | 'main'>(() => typeof Worker === 'undefined' ? 'main' : 'worker')
  const [progress, setProgress] = useState<ExperimentProgress | null>(null)
  const [result, setResult] = useState<ExperimentResult | null>(null)
  const [message, setMessage] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const activeRunRef = useRef<string | null>(null)
  const runNumberRef = useRef(0)
  const lastProgressRef = useRef(0)
  const cancellingRef = useRef(false)
  const maxGenerations = maximumExperimentGenerations(draft.replicates)
  const plan = useMemo(() => buildExperimentPlan(baseConfig, draft), [baseConfig, draft])
  const noOpReason = treatmentNoOpReason(baseConfig, draft)
  const intervention = plan.scenarioB.interventions![0]
  const interventionKey = Object.keys(intervention.changes)[0]
  const interventionValue = Object.values(intervention.changes)[0]

  const disposeActive = () => {
    abortRef.current?.abort(); abortRef.current = null
    workerRef.current?.terminate(); workerRef.current = null
    activeRunRef.current = null
  }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled])')]
      const first = focusable[0], last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; disposeActive(); previous?.focus() }
  }, [onClose])

  const acceptProgress = (next: ExperimentProgress, force = false) => {
    const now = performance.now()
    if (force || now - lastProgressRef.current >= 250) { lastProgressRef.current = now; setProgress(next) }
  }

  const finishRun = (requestId: string, next: ExperimentResult) => {
    if (!workerEventIsCurrent(requestId, activeRunRef.current)) return
    workerRef.current?.terminate(); workerRef.current = null; abortRef.current = null; activeRunRef.current = null
    setResult(next); setStatus('complete'); setMessage(experimentCompletionMessage(next.completedGenerationRuns, experimentGenerationRunCount(next.plan.replicates, next.plan.generations)))
  }

  const runFallback = async (nextPlan: ExperimentPlan, requestId: string) => {
    setRuntime('main')
    const controller = new AbortController(); abortRef.current = controller
    try {
      const next = await runExperiment(nextPlan, { signal: controller.signal, yieldEvery: 4, onProgress: update => { if (experimentProgressIsCurrent(requestId, activeRunRef.current, cancellingRef.current)) acceptProgress(update) } })
      finishRun(requestId, next)
    } catch (error) {
      if (!workerEventIsCurrent(requestId, activeRunRef.current)) return
      activeRunRef.current = null; abortRef.current = null
      if (error instanceof ExperimentCancelledError) { setStatus('cancelled'); setMessage('Experiment cancelled.') }
      else { setStatus('error'); setMessage(error instanceof Error ? error.message : 'Experiment failed.') }
    }
  }

  const start = () => {
    if (noOpReason) { setStatus('idle'); setMessage(noOpReason); return }
    disposeActive(); cancellingRef.current = false
    const requestId = `experiment-${++runNumberRef.current}`
    activeRunRef.current = requestId; lastProgressRef.current = 0
    setStatus('running'); setProgress(null); setResult(null); setMessage('Preparing paired runs…')
    if (typeof Worker !== 'undefined') try {
      const worker = new Worker(new URL('../experiments/experiments.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker; setRuntime('worker')
      worker.onmessage = (event: MessageEvent<ExperimentWorkerEvent>) => {
        const payload = event.data
        if (!workerEventIsCurrent(payload.requestId, activeRunRef.current)) return
        if (payload.type === 'progress') {
          if (!experimentProgressIsCurrent(payload.requestId, activeRunRef.current, cancellingRef.current)) return
          acceptProgress(payload.progress, payload.progress.completedGenerationRuns === payload.progress.plannedGenerationRuns)
          setMessage('Running matched control and treatment seeds…')
        }
        else if (payload.type === 'result') finishRun(requestId, payload.result)
        else { worker.terminate(); workerRef.current = null; activeRunRef.current = null; setStatus(payload.type === 'cancelled' ? 'cancelled' : 'error'); setMessage(payload.type === 'cancelled' ? 'Experiment cancelled.' : payload.message) }
      }
      worker.onerror = event => {
        event.preventDefault()
        if (!workerEventIsCurrent(requestId, activeRunRef.current)) return
        worker.terminate(); workerRef.current = null
        if (cancellingRef.current) { activeRunRef.current = null; setStatus('cancelled'); setMessage('Experiment cancelled.'); return }
        setMessage('Worker unavailable. Continuing in main-thread compatibility mode.')
        void runFallback(plan, requestId)
      }
      worker.postMessage({ type: 'run', requestId, plan, yieldEvery: 4 } satisfies ExperimentWorkerRequest)
      return
    } catch { /* fallback below */ }
    setMessage('Running in main-thread compatibility mode.')
    void runFallback(plan, requestId)
  }

  const cancel = () => {
    if (!activeRunRef.current) return
    cancellingRef.current = true; setStatus('cancelling'); setMessage('Cancelling after the current chunk…')
    if (workerRef.current) workerRef.current.postMessage({ type: 'cancel', requestId: activeRunRef.current } satisfies ExperimentWorkerRequest)
    else abortRef.current?.abort()
  }

  const choosePreset = (next: ExperimentPreset | 'custom') => { setPreset(next); if (next !== 'custom') setDraft(current => applyExperimentPreset(next, current, baseConfig)) }
  const chooseStudySize = (next: ExperimentStudySizeSelection) => {
    setStudySize(next)
    if (next !== 'custom') setDraft(current => applyExperimentStudySize(next, current))
  }
  const choosePressure = (key: InterventionConfigKey) => { setPreset('custom'); setDraft(current => ({ ...current, interventionKey: key, interventionValue: normalizeInterventionValue(key, baseConfig[key]) })) }
  const treatmentConstraint = constraintFor(draft.interventionKey)
  const availablePressures = availableInterventionConstraints(baseConfig)
  const progressPercent = progress ? Math.min(100, Math.round(progress.completedGenerationRuns / progress.plannedGenerationRuns * 100)) : 0

  return <div className="experiment-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={panelRef} className="experiment-panel" role="dialog" aria-modal="true" aria-labelledby="experiment-title" aria-busy={status === 'running' || status === 'cancelling'}>
      <header className="experiment-header"><div><span>EXPERIMENT LAB</span><h2 id="experiment-title">Compare change against chance</h2><p>Every replicate gives control and treatment the same seed, so paired differences isolate the treatment.</p></div><button ref={closeRef} onClick={onClose} aria-label="Close Experiment lab">×</button></header>
      <div className="experiment-layout">
        <form className="experiment-controls" onSubmit={event => { event.preventDefault(); start() }}>
          <fieldset disabled={status === 'running' || status === 'cancelling'}><legend>Study design</legend>
            <div className="experiment-field-grid">
              <label>Study size<select value={studySize} onChange={event => chooseStudySize(event.target.value as ExperimentStudySizeSelection)}>{EXPERIMENT_STUDY_SIZES.map(option => <option key={option.key} value={option.key}>{option.label}{option.key === DEFAULT_EXPERIMENT_STUDY_SIZE ? ' (default)' : ''} · {option.replicates}×{option.generations} · {experimentGenerationRunCount(option.replicates, option.generations)} runs</option>)}<option value="custom">Custom · edit values</option></select></label>
              <label>Paired replicates<input type="number" min={2} max={20} value={draft.replicates} onChange={event => { const replicates = Math.max(2, Math.min(20, event.currentTarget.valueAsNumber || 2)); setStudySize('custom'); setDraft(current => ({ ...current, replicates, generations: Math.min(current.generations, maximumExperimentGenerations(replicates)) })) }}/></label>
              <label>Generations<input type="number" min={2} max={Math.min(40, maxGenerations)} value={draft.generations} onChange={event => { const generations = Math.max(2, Math.min(Math.min(40, maxGenerations), event.currentTarget.valueAsNumber || 2)); setStudySize('custom'); setDraft(current => ({ ...current, generations, interventionGeneration: Math.min(current.interventionGeneration, generations) })) }}/></label>
              <label>Master seed<input type="number" min={1} max={9999999} value={draft.masterSeed} onChange={event => setDraft(current => ({ ...current, masterSeed: event.currentTarget.valueAsNumber || 1 }))}/></label>
              <label>Outcome metric<select value={draft.metric} onChange={event => setDraft(current => ({ ...current, metric: event.target.value as ExperimentDraft['metric'] }))}>{EXPERIMENT_METRIC_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
            </div>
            <label className="experiment-check"><input type="checkbox" checked={draft.stopOnExtinction} onChange={event => setDraft(current => ({ ...current, stopOnExtinction: event.target.checked }))}/>Stop each arm after extinction</label>
          </fieldset>
          <fieldset disabled={status === 'running' || status === 'cancelling'}><legend>Treatment</legend>
            <label>Treatment preset<select value={preset} onChange={event => choosePreset(event.target.value as ExperimentPreset | 'custom')}>{EXPERIMENT_PRESETS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}<option value="custom">Custom pressure</option></select></label>
            <label>Pressure<select value={draft.interventionKey} onChange={event => choosePressure(event.target.value as InterventionConfigKey)}>{availablePressures.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
            <label>Treatment value<input type="number" min={treatmentConstraint.min} max={treatmentConstraint.max} step={treatmentConstraint.step} value={draft.interventionValue} onChange={event => { setPreset('custom'); setDraft(current => ({ ...current, interventionValue: normalizeInterventionValue(current.interventionKey, event.currentTarget.valueAsNumber) })) }}/></label>
            <label>Starts at generation<input type="number" min={1} max={draft.generations} value={draft.interventionGeneration} onChange={event => setDraft(current => ({ ...current, interventionGeneration: Math.max(1, Math.min(current.generations, event.currentTarget.valueAsNumber || 1)) }))}/></label>
            <div className="scenario-summary"><div><strong>Control</strong><span>Applied live configuration</span></div><div><strong>Treatment</strong><span>{interventionKey} → {interventionValue} at generation {intervention.generation}</span></div></div>
            {noOpReason&&<p className="experiment-treatment-warning" id="experiment-treatment-warning" role="status">{noOpReason}</p>}
          </fieldset>
          <div className="experiment-run-summary"><span>{plan.replicates} paired seeds × {plan.generations} generations × 2 arms<br/><small>One generation-run = one arm advancing one generation.</small></span><strong>{experimentGenerationRunCount(plan.replicates, plan.generations)} generation-runs</strong></div>
          <div className="experiment-run-actions"><button className="experiment-run" type="submit" disabled={status === 'running' || status === 'cancelling' || Boolean(noOpReason)} aria-describedby={noOpReason?'experiment-treatment-warning':undefined}>{result ? 'Run again' : 'Run paired experiment'}</button>{(status === 'running' || status === 'cancelling') && <button type="button" onClick={cancel} disabled={status === 'cancelling'}>Cancel</button>}</div>
          <div className="experiment-progress" role="status" aria-live="polite"><div><span>{message}</span><small>{runtime === 'worker' ? 'Experiment worker' : 'Main-thread compatibility mode'}</small></div>{(status === 'running' || status === 'cancelling') && <><progress max={100} value={progressPercent}/><b>{progressPercent}%</b></>}</div>
        </form>
        <div className="experiment-output">{result ? <Results result={result} onReplay={onReplay}/> : <div className="experiment-empty"><strong>Design a paired test</strong><p>Run several matched seeds to see whether a treatment effect persists beyond chance.</p><div><span>Base food <b>{baseConfig.foodPerDay}</b></span><span>Population <b>{baseConfig.initialPopulation}</b></span><span>Seed <b>{baseConfig.seed}</b></span></div></div>}</div>
      </div>
    </section>
  </div>
}
