import{describe,expect,it}from'vitest'
import{keyedRandom,random}from'./random'

describe('stateless keyed RNG',()=>{
  it('is deterministic, key-sensitive, and bounded',()=>{const value=keyedRandom(42,'detection',7,3);expect(keyedRandom(42,'detection',7,3)).toBe(value);expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThan(1);expect(keyedRandom(42,'detection',7,4)).not.toBe(value);expect(keyedRandom(42,'contest',7,3)).not.toBe(value)})
  it('is stable regardless of call order and does not mutate sequential RNG state',()=>{const state={rngState:123},before=state.rngState;const forward=[1,2,3].map(id=>[id,keyedRandom(99,'reaction',id)]as const),reverse=[3,2,1].map(id=>[id,keyedRandom(99,'reaction',id)]as const);expect(new Map(reverse)).toEqual(new Map(forward));expect(state.rngState).toBe(before);const expected=random({...state});keyedRandom(99,'reaction',1);expect(random(state)).toBe(expected)})
})
