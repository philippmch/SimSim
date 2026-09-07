import { createWorld } from './engine'
import { sanitizeConfig } from './config'
import type { World } from './types'

export const RUN_STORAGE_KEY = 'evolution-field-lab:saved-run:v1'
const MAX_BYTES = 4_000_000
// This is an integrity check for our own local saves, not an import/authentication format.
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
function shape(template: unknown, value: unknown): boolean {
  if (template === null) return value === null || typeof value === 'number' || typeof value === 'string'
  if (Array.isArray(template)) return Array.isArray(value) && (!template.length || value.every(item => shape(template[0], item)))
  if (typeof template === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.entries(template!).every(([key, item]) => shape(item, (value as Record<string, unknown>)[key]))
  return typeof template === typeof value
}
export interface SavedRun { world: World; savedAt: string }
export function encodeRun(world: World): string {
  // JSON deliberately excludes optional undefined diagnostics. All engine numbers must survive exactly.
  const snapshot = JSON.parse(JSON.stringify(world)) as World
  if (!finiteTree(world)) throw new Error('This run contains invalid simulation values and could not be saved.')
  const payload = JSON.stringify({ world: snapshot, savedAt: new Date().toISOString() })
  const text = JSON.stringify({ version: 1, checksum: checksum(payload), payload })
  if (text.length > MAX_BYTES) throw new Error('This run is too large for the local save slot.')
  // Never replace the previous save with a snapshot this version cannot resume.
  decodeRun(text)
  return text
}
export function decodeRun(text: string): SavedRun {
  try {
    if (text.length > MAX_BYTES) throw new Error()
    const envelope = JSON.parse(text)
    if (envelope.version !== 1 || typeof envelope.payload !== 'string' || envelope.checksum !== checksum(envelope.payload)) throw new Error()
    const saved = JSON.parse(envelope.payload) as SavedRun
    const world = saved.world
    if (!world || !finiteTree(saved) || !Number.isFinite(Date.parse(saved.savedAt))) throw new Error()
    const config = sanitizeConfig(world.config)
    if (Object.keys(config).some(key => config[key as keyof typeof config] !== world.config[key as keyof typeof config])) throw new Error()
    const template = JSON.parse(JSON.stringify(createWorld(config)))
    const historyKeys = Object.keys(template.history[0])
    delete template.history
    delete template.lastInspectedOutcome
    delete template.individualActivity
    delete template.individualActivityDropped
    const outcome = world.lastInspectedOutcome
    if (!Array.isArray(world.history) || world.history.length > 240 || world.history.some(point => !point || historyKeys.some(key => {
      const value = point[key as keyof typeof point]
      return key === 'generation' || key === 'population' ? !Number.isSafeInteger(value) || value! < 0 : value !== null && typeof value !== 'number'
    }))) throw new Error()
    if (outcome !== null && (!outcome || !Number.isSafeInteger(outcome.individualId) || outcome.individualId < 1 || !Number.isSafeInteger(outcome.generation) || outcome.generation < 1 || !['hunted', 'energy', 'unfed', 'late', 'aged'].includes(outcome.cause))) throw new Error()
    if (world.inspectedIndividualId !== null && (!Number.isSafeInteger(world.inspectedIndividualId) || world.inspectedIndividualId < 1)) throw new Error()
    if (world.individualActivity !== undefined && (!Array.isArray(world.individualActivity) || world.individualActivity.length > 480 || world.individualActivity.some(entry => !entry || !Number.isSafeInteger(entry.sequence) || entry.sequence < 1 || !Array.isArray(entry.actorIds)))) throw new Error()
    if (world.individualActivityDropped !== undefined && (!Number.isSafeInteger(world.individualActivityDropped) || world.individualActivityDropped < 0)) throw new Error()
    if (!shape(template, world) || !Number.isSafeInteger(world.generation) || world.generation < 1 || !Number.isSafeInteger(world.tickIndex) || world.tickIndex < 0 || world.dayTime < 0 || world.dayTime > config.dayLength) throw new Error()
    if (world.creatures.length > 120 || world.food.length > 180 || new Set(world.creatures.map(c => c.individualId)).size !== world.creatures.length) throw new Error()
    return saved
  } catch {
    throw new Error('The saved run is damaged or from an unsupported version. The current run has not changed.')
  }
}
