import { decodeRun, encodeRun, MAX_RUN_TEXT_LENGTH } from './checkpoint'
import type { World } from './types'

export const MAX_RUN_FILE_BYTES = MAX_RUN_TEXT_LENGTH

/** Read and validate a candidate only. The caller must confirm before restoring it. */
export async function readPortableRun(file: Pick<File, 'size' | 'text'>) {
  if (file.size > MAX_RUN_FILE_BYTES) throw new Error('Choose a run JSON file no larger than 4 MB. The current run has not changed.')
  return decodeRun(await file.text())
}

export function createPortableRun(world: World) {
  const blob = new Blob([encodeRun(world)], { type: 'application/json' })
  if (blob.size > MAX_RUN_FILE_BYTES) throw new Error('This run is too large for a 4 MB backup file.')
  return { blob, filename: `evolution-field-lab-generation-${world.generation}.json` }
}

export function downloadPortableRun(world: World) {
  const { blob, filename } = createPortableRun(world)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  try {
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    // Give the browser time to start consuming the download before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
