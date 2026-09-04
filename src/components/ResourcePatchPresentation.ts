export interface ResourcePatchIdRecord {
  id: number
}

/** Stable ordering for every user-facing Patch N label, independent of world array order. */
export function sortResourcePatchRecords<T extends ResourcePatchIdRecord>(patches: ReadonlyArray<T>): T[] {
  return patches.map((patch, index) => ({ patch, index })).sort((a, b) => {
    const aFinite = Boolean(a.patch) && typeof a.patch.id === 'number' && Number.isFinite(a.patch.id)
    const bFinite = Boolean(b.patch) && typeof b.patch.id === 'number' && Number.isFinite(b.patch.id)
    if (aFinite !== bFinite) return aFinite ? -1 : 1
    if (aFinite && bFinite && a.patch.id !== b.patch.id) return a.patch.id - b.patch.id
    return a.index - b.index
  }).map(item => item.patch)
}

/** Return a stable one-based ordinal without exposing an internal patch id. */
export function resourcePatchOrdinal<T extends ResourcePatchIdRecord>(patches: ReadonlyArray<T>, patchId: number | null | undefined): number | null {
  if (typeof patchId !== 'number' || !Number.isFinite(patchId)) return null
  const index = sortResourcePatchRecords(patches).findIndex(patch => Boolean(patch) && patch.id === patchId)
  return index < 0 ? null : index + 1
}
