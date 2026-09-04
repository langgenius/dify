import { createTraceBuffer, readTraceState, readTraceVersion } from '../trace-buffer'

describe('createTraceBuffer', () => {
  it('stamps a monotonic seq (starting at 1) and an ISO timestamp on each append', () => {
    const buffer = createTraceBuffer()
    buffer.append({ dir: 'out', kind: 'action', payload: { a: 1 } })
    buffer.append({
      dir: 'in',
      kind: 'progress',
      payload: { b: 2 },
      version: 3,
      state: 'build.execution',
    })
    const { entries, truncated } = buffer.snapshot()
    expect(entries.map((e) => e.seq)).toEqual([1, 2])
    expect(entries[0]?.dir).toBe('out')
    expect(entries[1]).toMatchObject({
      dir: 'in',
      kind: 'progress',
      version: 3,
      state: 'build.execution',
    })
    expect(entries[1]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    expect(truncated).toBe(false)
  })

  it('keeps only the last `cap` entries and flags truncated on overflow', () => {
    const buffer = createTraceBuffer(2)
    buffer.append({ dir: 'in', kind: 'a', payload: {} })
    buffer.append({ dir: 'in', kind: 'b', payload: {} })
    buffer.append({ dir: 'in', kind: 'c', payload: {} })
    const { entries, truncated } = buffer.snapshot()
    expect(entries.map((e) => e.kind)).toEqual(['b', 'c'])
    expect(entries.map((e) => e.seq)).toEqual([2, 3])
    expect(truncated).toBe(true)
  })

  it('snapshot returns a copy that does not mutate the buffer', () => {
    const buffer = createTraceBuffer()
    buffer.append({ dir: 'in', kind: 'a', payload: {} })
    const first = buffer.snapshot()
    first.entries.push({ seq: 99, ts: 'x', dir: 'in', kind: 'z', payload: {} })
    expect(buffer.snapshot().entries).toHaveLength(1)
  })

  it('clear resets entries, seq, and truncated', () => {
    const buffer = createTraceBuffer(1)
    buffer.append({ dir: 'in', kind: 'a', payload: {} })
    buffer.append({ dir: 'in', kind: 'b', payload: {} })
    buffer.clear()
    expect(buffer.snapshot()).toEqual({ entries: [], truncated: false })
    buffer.append({ dir: 'in', kind: 'c', payload: {} })
    expect(buffer.snapshot().entries[0]?.seq).toBe(1)
  })

  it('readTraceVersion prefers version, falls back to at_version, else undefined', () => {
    expect(readTraceVersion({ version: 5, at_version: 4 })).toBe(5)
    expect(readTraceVersion({ at_version: 4 })).toBe(4)
    expect(readTraceVersion({})).toBeUndefined()
    expect(readTraceVersion(null)).toBeUndefined()
  })

  it('readTraceState returns a string state or undefined', () => {
    expect(readTraceState({ state: 'build.publish' })).toBe('build.publish')
    expect(readTraceState({})).toBeUndefined()
    expect(readTraceState('x')).toBeUndefined()
  })
})
