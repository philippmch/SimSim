import { useRef, useState } from 'react'
import { decodeRun, encodeRun, RUN_STORAGE_KEY } from '../simulation/checkpoint'
import type { World } from '../simulation/types'

export default function SavedRunControls({ world, onRestore, disabled }: { world: World; onRestore: (world: World) => void; disabled: boolean }) {
  const [status, setStatus] = useState('')
  const [saved, setSaved] = useState(() => { try { return localStorage.getItem(RUN_STORAGE_KEY) !== null } catch { return false } })
  const [confirm, setConfirm] = useState(false)
  const resumeRef = useRef<HTMLButtonElement>(null)
  function closeConfirmation() { setConfirm(false); resumeRef.current?.focus() }
  function save() {
    try {
      localStorage.setItem(RUN_STORAGE_KEY, encodeRun(world))
      setSaved(true); setConfirm(false)
      setStatus(`Saved generation ${world.generation} at ${world.dayTime.toFixed(2)} seconds in this browser.`)
    } catch (error) { setStatus(error instanceof Error ? `Save failed: ${error.message}` : 'Save failed. Browser storage is unavailable.') }
  }
  function restore() {
    try {
      const text = localStorage.getItem(RUN_STORAGE_KEY)
      if (!text) throw new Error('No saved run remains in this browser.')
      const snapshot = decodeRun(text)
      onRestore(snapshot.world); closeConfirmation()
      setStatus(`Restored generation ${snapshot.world.generation} at ${snapshot.world.dayTime.toFixed(2)} seconds, paused. Saved ${new Date(snapshot.savedAt).toLocaleString()}.`)
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not read browser storage.') }
  }
  return <details style={{ marginTop: 12 }}><summary>Save &amp; resume run</summary>
    <p className="subtle">One save slot in this browser. Save captures the current moment, random state and retained history. Save again to replace it. Clearing browser data removes the save.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button className="settings-toggle" disabled={disabled} onClick={save} style={{ minHeight: 44 }}>Save run</button>
      <button className="settings-toggle" ref={resumeRef} aria-expanded={confirm} aria-controls="restore-run-confirmation" disabled={disabled || !saved} onClick={() => setConfirm(true)} style={{ minHeight: 44 }}>Resume saved run</button>
    </div>
    {confirm && <div id="restore-run-confirmation"><p>Replace the current run and staged settings with the saved run? It will open paused.</p><button className="settings-toggle" disabled={disabled} onClick={restore} style={{ minHeight: 44 }}>Restore saved moment</button>{' '}<button className="settings-toggle" onClick={closeConfirmation} style={{ minHeight: 44 }}>Cancel</button></div>}
    <p role="status" aria-live="polite">{status}</p>
  </details>
}
