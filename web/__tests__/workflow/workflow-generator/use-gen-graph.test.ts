import { act, renderHook } from '@testing-library/react'
import useGenGraph from '../../../app/components/workflow/workflow-generator/use-gen-graph'

describe('useGenGraph', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  const makeResponse = (label: string) => ({
    graph: {
      nodes: [{ id: label, type: 'custom', position: { x: 0, y: 0 }, data: { type: 'start', title: label } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    message: label,
  })

  it('starts with an empty version list and undefined current', () => {
    const { result } = renderHook(() => useGenGraph({ storageKey: 'k1' }))
    expect(result.current.versions).toEqual([])
    expect(result.current.current).toBeUndefined()
  })

  it('appends versions and tracks the latest one as current', () => {
    const { result } = renderHook(() => useGenGraph({ storageKey: 'k2' }))

    act(() => {
      result.current.addVersion(makeResponse('v1') as never)
    })
    expect(result.current.versions).toHaveLength(1)
    expect(result.current.current?.message).toBe('v1')

    act(() => {
      result.current.addVersion(makeResponse('v2') as never)
    })
    expect(result.current.versions).toHaveLength(2)
    expect(result.current.current?.message).toBe('v2')
    expect(result.current.currentVersionIndex).toBe(1)
  })

  it('allows switching back to an older version', () => {
    const { result } = renderHook(() => useGenGraph({ storageKey: 'k3' }))
    act(() => {
      result.current.addVersion(makeResponse('a') as never)
      result.current.addVersion(makeResponse('b') as never)
    })

    act(() => {
      result.current.setCurrentVersionIndex(0)
    })
    expect(result.current.current?.message).toBe('a')
  })

  it('isolates state by storageKey', () => {
    const { result: r1 } = renderHook(() => useGenGraph({ storageKey: 'mode-a' }))
    const { result: r2 } = renderHook(() => useGenGraph({ storageKey: 'mode-b' }))

    act(() => {
      r1.current.addVersion(makeResponse('only-a') as never)
    })

    expect(r1.current.versions).toHaveLength(1)
    expect(r2.current.versions).toHaveLength(0)
  })
})
