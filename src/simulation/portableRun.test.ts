import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorld } from './engine'
import { defaultConfig } from './config'
import { decodeRun, encodeRun } from './checkpoint'
import { createPortableRun, downloadPortableRun, MAX_RUN_FILE_BYTES, readPortableRun } from './portableRun'

describe('portable run backups', () => {
  beforeEach(() => vi.restoreAllMocks())
  it('captures a detached exact moment in the existing checkpoint format', async () => {
    const world = createWorld(defaultConfig)
    const original = structuredClone(world)
    const { blob, filename } = createPortableRun(world)
    world.generation++
    expect(filename).toBe('evolution-field-lab-generation-1.json')
    expect(blob.type).toBe('application/json')
    expect((await readPortableRun(blob)).world).toEqual(original)
    expect(decodeRun(await blob.text()).world).toEqual(original)
  })
  it('rejects oversized files before allocating their text', async () => {
    const text = vi.fn().mockResolvedValue('')
    await expect(readPortableRun({ size: MAX_RUN_FILE_BYTES + 1, text })).rejects.toThrow('4 MB')
    expect(text).not.toHaveBeenCalled()
  })
  it('accepts the file-size boundary and rejects damaged and setup-only files', async () => {
    const encoded = encodeRun(createWorld(defaultConfig))
    expect((await readPortableRun({ size: MAX_RUN_FILE_BYTES, text: async () => encoded })).world.generation).toBe(1)
    for (const content of ['', '{', JSON.stringify(defaultConfig), encoded.replace('checksum', 'damaged')]) {
      await expect(readPortableRun({ size: content.length, text: async () => content })).rejects.toThrow('damaged or from an unsupported version')
    }
  })
  it('propagates file read failures without a candidate', async () => {
    await expect(readPortableRun({ size: 5, text: async () => { throw new Error('Read denied') } })).rejects.toThrow('Read denied')
  })
  it('starts a named download and releases its temporary anchor and URL', () => {
    vi.useFakeTimers()
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    const appendChild = vi.fn()
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild } })
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    try {
      downloadPortableRun(createWorld(defaultConfig))
      expect(create).toHaveBeenCalledWith(expect.any(Blob))
      expect(appendChild).toHaveBeenCalledWith(anchor)
      expect(anchor.download).toBe('evolution-field-lab-generation-1.json')
      expect(anchor.href).toBe('blob:test')
      expect(anchor.click).toHaveBeenCalledOnce()
      expect(anchor.remove).toHaveBeenCalledOnce()
      expect(revoke).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(revoke).toHaveBeenCalledWith('blob:test')
    } finally { vi.useRealTimers(); vi.unstubAllGlobals() }
  })
})
