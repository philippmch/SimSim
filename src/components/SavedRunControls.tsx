import { useEffect, useRef, useState } from 'react'
import { decodeRun, encodeRun, RUN_STORAGE_KEY, type SavedRun } from '../simulation/checkpoint'
import { downloadPortableRun, readPortableRun } from '../simulation/portableRun'
import type { World } from '../simulation/types'

type Confirmation = { source: 'browser' } | { source: 'file'; snapshot: SavedRun; filename: string }

export function RunRestoreConfirmation({ candidate, disabled, onConfirm, onCancel }: { candidate: Confirmation; disabled: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <div id="restore-run-confirmation">
    <p>Replace the current run and staged settings with {candidate.source === 'file' ? `the imported run from “${candidate.filename}”` : 'the saved run'}? It will open paused.</p>
    {candidate.source === 'file' && <p className="subtle">Generation {candidate.snapshot.world.generation}, {candidate.snapshot.world.dayTime.toFixed(2)} seconds. Saved {new Date(candidate.snapshot.savedAt).toLocaleString()}. Your browser save slot will stay as it is.</p>}
    <button className="settings-toggle" disabled={disabled} onClick={onConfirm} style={{ minHeight: 44 }}>{candidate.source === 'file' ? 'Restore imported moment' : 'Restore saved moment'}</button>{' '}
    <button className="settings-toggle" onClick={onCancel} style={{ minHeight: 44 }}>Cancel</button>
  </div>
}

export default function SavedRunControls({ world, onRestore, disabled }: { world: World; onRestore: (world: World) => void; disabled: boolean }) {
  const [status, setStatus] = useState('')
  const [saved, setSaved] = useState(() => { try { return localStorage.getItem(RUN_STORAGE_KEY) !== null } catch { return false } })
  const [confirm, setConfirm] = useState<Confirmation | null>(null)
  const [reading, setReading] = useState(false)
  const resumeRef = useRef<HTMLButtonElement>(null)
  const importButtonRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  useEffect(() => {
    if (disabled) { request.current++; setReading(false); setConfirm(null) }
    function refreshSaved(event: StorageEvent) {
      if (event.key !== null && event.key !== RUN_STORAGE_KEY) return
      try { setSaved(localStorage.getItem(RUN_STORAGE_KEY) !== null) } catch { setSaved(false) }
    }
    window.addEventListener('storage', refreshSaved)
    return () => { request.current++; window.removeEventListener('storage', refreshSaved) }
  }, [disabled])
  function closeConfirmation() {
    const source = confirm?.source
    setConfirm(null)
    setStatus('Restore cancelled. The current run has not changed.')
    const trigger = source === 'file' ? importButtonRef : resumeRef
    trigger.current?.focus()
  }
  function save() {
    if (disabled || reading) return
    try {
      localStorage.setItem(RUN_STORAGE_KEY, encodeRun(world))
      setSaved(true); setConfirm(null)
      setStatus(`Saved generation ${world.generation} at ${world.dayTime.toFixed(2)} seconds in this browser.`)
    } catch (error) { setStatus(error instanceof Error ? `Save failed: ${error.message}` : 'Save failed. Browser storage is unavailable.') }
  }
  function restore() {
    if (disabled || reading || !confirm) return
    try {
      let snapshot: SavedRun
      if (confirm.source === 'file') snapshot = confirm.snapshot
      else {
        const text = localStorage.getItem(RUN_STORAGE_KEY)
        if (!text) { setSaved(false); throw new Error('No saved run remains in this browser.') }
        snapshot = decodeRun(text)
      }
      onRestore(snapshot.world); closeConfirmation()
      setStatus(`Restored generation ${snapshot.world.generation} at ${snapshot.world.dayTime.toFixed(2)} seconds, paused. Saved ${new Date(snapshot.savedAt).toLocaleString()}.`)
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not restore this run. The current run has not changed.') }
  }
  function download() {
    if (disabled || reading) return
    try {
      downloadPortableRun(world)
      setStatus(`Run JSON download requested for generation ${world.generation} at ${world.dayTime.toFixed(2)} seconds.`)
    } catch (error) { setStatus(error instanceof Error ? `Download failed: ${error.message}` : 'Could not download this run.') }
  }
  async function importFile(input: HTMLInputElement) {
    const file = input.files?.[0]
    input.value = ''
    if (!file || disabled || reading) return
    const currentRequest = ++request.current
    setConfirm(null); setReading(true); setStatus('Reading run JSON…')
    try {
      const snapshot = await readPortableRun(file)
      if (currentRequest !== request.current) return
      setConfirm({ source: 'file', snapshot, filename: file.name })
      setStatus('Run file validated. Confirm below to replace the current run and staged settings.')
    } catch (error) {
      if (currentRequest === request.current) setStatus(error instanceof Error ? `Import failed: ${error.message}` : 'Could not read this run file. The current run has not changed.')
    } finally {
      if (currentRequest === request.current) setReading(false)
    }
  }
  return <details style={{ marginTop: 12 }}><summary>Save &amp; resume run</summary>
    <p className="subtle">One save slot in this browser. Save captures the current moment, random state and retained history. Save again to replace it. Clearing browser data removes the save.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button className="settings-toggle" disabled={disabled || reading} onClick={save} style={{ minHeight: 44 }}>Save run</button>
      <button className="settings-toggle" ref={resumeRef} aria-expanded={confirm?.source === 'browser'} aria-controls="restore-run-confirmation" disabled={disabled || reading || !saved} onClick={() => { setConfirm({ source: 'browser' }); setStatus('') }} style={{ minHeight: 44 }}>Resume saved run</button>
      <button className="settings-toggle" disabled={disabled || reading} onClick={download} style={{ minHeight: 44 }}>Download run JSON</button>
      <button className="settings-toggle" ref={importButtonRef} disabled={disabled || reading} aria-expanded={confirm?.source === 'file'} aria-controls="restore-run-confirmation" onClick={() => fileRef.current?.click()} style={{ minHeight: 44 }}>{reading ? 'Reading run JSON…' : 'Import run JSON'}</button>
      <input ref={fileRef} type="file" accept="application/json,.json" aria-label="Import run JSON file" hidden disabled={disabled || reading} onChange={event => { void importFile(event.currentTarget) }} />
    </div>
    <p className="subtle">Download a portable backup of the current moment. Import a run JSON file up to 4 MB, then confirm to restore it paused. Downloads and imports do not replace the browser save slot. Setup-only experiment JSON belongs in the settings import.</p>
    {confirm && <RunRestoreConfirmation candidate={confirm} disabled={disabled || reading} onConfirm={restore} onCancel={closeConfirmation} />}
    <p role="status" aria-live="polite">{status}</p>
  </details>
}
