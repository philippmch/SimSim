import { describe, expect, it } from 'vitest'
import { resourcePatchOrdinal, sortResourcePatchRecords } from './ResourcePatchPresentation'

describe('resource patch presentation identity', () => {
  it('keeps one stable ordinal contract for permuted, duplicate, and malformed ids', () => {
    const records = [
      { id: Number.NaN, label: 'not-a-number' },
      { id: 42, label: 'forty-two' },
      { id: 7, label: 'first-seven' },
      { id: Number.POSITIVE_INFINITY, label: 'infinite' },
      { id: 7, label: 'second-seven' },
      { id: 19, label: 'nineteen' },
    ]
    expect(sortResourcePatchRecords(records).map(record => record.label)).toEqual([
      'first-seven',
      'second-seven',
      'nineteen',
      'forty-two',
      'not-a-number',
      'infinite',
    ])
    expect(resourcePatchOrdinal(records, 7)).toBe(1)
    expect(resourcePatchOrdinal(records, 19)).toBe(3)
    expect(resourcePatchOrdinal(records, 42)).toBe(4)
    expect(resourcePatchOrdinal([...records].reverse(), 42)).toBe(4)
    expect(resourcePatchOrdinal(records, Number.NaN)).toBeNull()
    expect(resourcePatchOrdinal(records, 9001)).toBeNull()
  })
})
