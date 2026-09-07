import { validWorldIdentities, validWorldStructure } from './checkpointValidation'
import { sanitizeConfig } from './config'
import type { World } from './types'

export const RUN_STORAGE_KEY = 'evolution-field-lab:saved-run:v1'
export const MAX_RUN_TEXT_LENGTH = 4_000_000
// Detect accidental damage in browser saves and portable backups; this is not authentication.
function checksum(text: string) {
  let value = 2166136261
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619)
  return (value >>> 0).toString(16)
}
function finiteTree(value: unknown, depth = 0): boolean {
  if (depth > 30) return false
  if (typeof value === 'number') return Number.isFinite(value)
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return true
  return typeof value === 'object' && Object.values(value!).every(item => finiteTree(item, depth + 1))
}
export interface SavedRun { world: World; savedAt: string }
export function encodeRun(world: World): string {
  // JSON deliberately excludes optional undefined diagnostics. All engine numbers must survive exactly.
  const snapshot = JSON.parse(JSON.stringify(world)) as World
  if (!finiteTree(world)) throw new Error('This run contains invalid simulation values and could not be saved.')
  const payload = JSON.stringify({ world: snapshot, savedAt: new Date().toISOString() })
  const text = JSON.stringify({ version: 1, checksum: checksum(payload), payload })
  if (text.length > MAX_RUN_TEXT_LENGTH) throw new Error('This run is too large to save.')
  // Never replace the previous save with a snapshot this version cannot resume.
  decodeRun(text)
  return text
}
export function decodeRun(text: string): SavedRun {
  try {
    if (text.length > MAX_RUN_TEXT_LENGTH) throw new Error()
    const envelope = JSON.parse(text)
    if (envelope.version !== 1 || typeof envelope.payload !== 'string' || envelope.checksum !== checksum(envelope.payload)) throw new Error()
    const saved = JSON.parse(envelope.payload) as SavedRun
    const world = saved.world
    if (!world || !finiteTree(saved) || typeof saved.savedAt !== 'string' || !Number.isFinite(Date.parse(saved.savedAt))) throw new Error()
    const config = sanitizeConfig(world.config)
    if (Object.keys(config).some(key => config[key as keyof typeof config] !== world.config[key as keyof typeof config])) throw new Error()
    if (!validWorldStructure(world) || world.dayTime < 0 || world.dayTime > config.dayLength) throw new Error()
    if (!validWorldIdentities(world)) throw new Error()
    return saved
  } catch {
    throw new Error('The saved run is damaged or from an unsupported version. The current run has not changed.')
  }
}
