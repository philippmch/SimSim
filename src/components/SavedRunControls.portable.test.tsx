import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { createWorld } from '../simulation/engine'
import { defaultConfig } from '../simulation/config'
import { encodeRun, RUN_STORAGE_KEY } from '../simulation/checkpoint'

const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, cleanup: undefined as undefined | (() => void), dependency: undefined as boolean | undefined }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: any) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: any) => { hooks.values[index] = value }]
  },
  useRef: (initial: any) => {
    const index = hooks.cursor++
    return hooks.values[index] ??= { current: initial }
  },
  useEffect: (effect: () => (() => void), deps: boolean[]) => {
    if (hooks.dependency !== deps[0]) { hooks.cleanup?.(); hooks.dependency = deps[0]; hooks.cleanup = effect() }
  },
}))
import SavedRunControls, { RunRestoreConfirmation } from './SavedRunControls'

let storage: Map<string, string>
let onRestore: ReturnType<typeof vi.fn<(world: ReturnType<typeof createWorld>) => void>>
let world: ReturnType<typeof createWorld>
let storageListener: ((event: { key: string | null }) => void) | undefined
function render(disabled = false) { hooks.cursor = 0; return SavedRunControls({ world, disabled, onRestore }) }
function find(node: any, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> {
  if (node && typeof node === 'object' && predicate(node)) return node
  for (const child of [node?.props?.children].flat(Infinity)) {
    if (!child || typeof child !== 'object') continue
    const found = find(child, predicate)
    if (found) return found
  }
  return undefined as unknown as ReactElement<any>
}
const button = (tree: any, label: string) => find(tree, element => element.type === 'button' && element.props.children === label)
const confirmation = (tree: any) => find(tree, element => element.type === RunRestoreConfirmation)
async function importText(content: string | Promise<string>) {
  const input = { files: [{ name: 'backup.json', size: 20, text: async () => content }], value: 'backup.json' }
  find(render(), element => element.type === 'input').props.onChange({ currentTarget: input })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(input.value).toBe('')
}
beforeEach(() => {
  hooks.cleanup?.(); hooks.values = []; hooks.cursor = 0; hooks.cleanup = undefined; hooks.dependency = undefined
  storage = new Map([[RUN_STORAGE_KEY, 'previous local slot']])
  storageListener = undefined
  vi.stubGlobal('window', { addEventListener: (_type: string, listener: typeof storageListener) => { storageListener = listener }, removeEventListener: () => { storageListener = undefined } })
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  world = createWorld(defaultConfig); onRestore = vi.fn()
})
it('requires explicit restore after validation and preserves the local slot', async () => {
  await importText(encodeRun(world))
  expect(onRestore).not.toHaveBeenCalled()
  const candidate = confirmation(render())
  expect(candidate.props.candidate.filename).toBe('backup.json')
  const prompt = RunRestoreConfirmation(candidate.props)
  expect(JSON.stringify(prompt)).toContain('current run and staged settings')
  button(prompt, 'Restore imported moment').props.onClick()
  expect(onRestore).toHaveBeenCalledWith(world)
  expect(confirmation(render())).toBeUndefined()
  expect(storage.get(RUN_STORAGE_KEY)).toBe('previous local slot')
})
it('cancel discards the candidate and invalid files never offer restore', async () => {
  await importText(encodeRun(world))
  confirmation(render()).props.onCancel()
  expect(confirmation(render())).toBeUndefined()
  await importText('{}')
  expect(confirmation(render())).toBeUndefined()
  expect(JSON.stringify(render())).toContain('Import failed:')
  expect(onRestore).not.toHaveBeenCalled()
})
it('updates slot availability after another tab saves or clears storage', () => {
  expect(button(render(), 'Resume saved run').props.disabled).toBe(false)
  storage.clear(); storageListener?.({ key: null })
  expect(button(render(), 'Resume saved run').props.disabled).toBe(true)
  storage.set(RUN_STORAGE_KEY, encodeRun(world)); storageListener?.({ key: RUN_STORAGE_KEY })
  expect(button(render(), 'Resume saved run').props.disabled).toBe(false)
})
it('disables run actions while busy and ignores completion after disable or unmount', async () => {
  for (const stop of [() => render(true), () => hooks.cleanup?.()]) {
    let finish!: (text: string) => void
    await importText(new Promise<string>(resolve => { finish = resolve }))
    expect(button(render(), 'Download run JSON').props.disabled).toBe(true)
    stop()
    finish(encodeRun(world))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(confirmation(render(true))).toBeUndefined()
    expect(onRestore).not.toHaveBeenCalled()
    hooks.cleanup?.(); hooks.values = []; hooks.dependency = undefined; hooks.cleanup = undefined
  }
})
