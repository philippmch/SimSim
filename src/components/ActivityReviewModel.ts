/** Stable retained-record identity. Never use an array position as review identity. */
export function isSameActivityReview(a: unknown, b: unknown): boolean {
  try {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>
    for (const key of ['sequence', 'generation', 'tick']) {
      const value = left[key]
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (key === 'tick' ? 0 : 1) || value !== right[key]) return false
    }
    return typeof left.kind === 'string' && left.kind === right.kind
      && typeof left.summary === 'string' && typeof right.summary === 'string'
      && left.summary.trim().length > 0 && left.summary.trim() === right.summary.trim()
  } catch {
    return false
  }
}

/** Missing legacy sequences cannot be tracked safely after buffer eviction. */
export function isActivityReviewRetained(world: unknown, moment: unknown): boolean {
  try {
    if (!world || typeof world !== 'object') return false
    const activity: unknown = (world as Record<string, unknown>).activity
    if (!Array.isArray(activity)) return false
    const length = activity.length
    if (!Number.isSafeInteger(length) || length < 0) return false
    for (let index = 0; index < length; index++) {
      try {
        if (isSameActivityReview(activity[index], moment)) return true
      } catch { /* A malformed slot must not hide other retained records. */ }
    }
  } catch { /* Untrusted legacy snapshot. */ }
  return false
}
