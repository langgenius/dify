import type { GenerateWorkflowResponse } from '../types'
import { act, renderHook } from '@testing-library/react'
import useGenGraph from '../use-gen-graph'

const makeVersion = (marker: string): GenerateWorkflowResponse => ({
  graph: {
    nodes: [{ id: marker } as never],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 0.7 },
  },
  message: marker,
})

describe('useGenGraph', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('should handle undefined versions and index gracefully (e.g. during hydration or bad storage)', () => {
    // If sessionStorage contains the literal string "null", ahooks returns null
    sessionStorage.setItem('workflow-gen-workflow-test-versions', 'null')
    sessionStorage.setItem('workflow-gen-workflow-test-version-index', 'null')

    const { result } = renderHook(() => useGenGraph({ storageKey: 'workflow-test' }))

    expect(result.current.currentVersionIndex).toBe(0)
    expect(result.current.current).toBeUndefined()

    act(() => {
      result.current.addVersion(makeVersion('v1'))
    })

    expect(result.current.versions).toHaveLength(1)
  })

  describe('addVersion', () => {
    // The selected index must always point at the entry just appended so the
    // preview pane shows the generation the user is waiting on.
    it('should select the newly added version', () => {
      const { result } = renderHook(() => useGenGraph({ storageKey: 'workflow-test' }))

      act(() => {
        result.current.addVersion(makeVersion('v1'))
      })
      act(() => {
        result.current.addVersion(makeVersion('v2'))
      })

      expect(result.current.versions).toHaveLength(2)
      expect(result.current.currentVersionIndex).toBe(1)
      expect(result.current.current?.message).toBe('v2')
    })

    // Each version embeds a full graph and sessionStorage tops out around
    // 5MB — an unbounded history would hit the quota mid-session. Oldest
    // entries are dropped, and the index still tracks the latest entry.
    it('should cap retained versions and keep the index on the latest', () => {
      const { result } = renderHook(() => useGenGraph({ storageKey: 'workflow-test' }))

      for (let i = 0; i < 12; i++) {
        act(() => {
          result.current.addVersion(makeVersion(`v${i}`))
        })
      }

      expect(result.current.versions).toHaveLength(10)
      // Oldest two were evicted; the window is v2..v11.
      expect(result.current.versions?.[0]?.message).toBe('v2')
      expect(result.current.currentVersionIndex).toBe(9)
      expect(result.current.current?.message).toBe('v11')
    })
  })

  describe('currentVersionIndex clamping', () => {
    // A stale persisted index (longer history capped, or cleared by another
    // tab) must not strand the preview on an undefined entry.
    it('should clamp an out-of-bounds persisted index to the last version', () => {
      sessionStorage.setItem(
        'workflow-gen-workflow-test-versions',
        JSON.stringify([makeVersion('only')]),
      )
      sessionStorage.setItem('workflow-gen-workflow-test-version-index', '5')

      const { result } = renderHook(() => useGenGraph({ storageKey: 'workflow-test' }))

      expect(result.current.currentVersionIndex).toBe(0)
      expect(result.current.current?.message).toBe('only')
    })

    it('should return index 0 and no current version when history is empty', () => {
      const { result } = renderHook(() => useGenGraph({ storageKey: 'workflow-test' }))

      expect(result.current.currentVersionIndex).toBe(0)
      expect(result.current.current).toBeUndefined()
    })
  })
})
