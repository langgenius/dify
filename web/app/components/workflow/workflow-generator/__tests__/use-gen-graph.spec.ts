import type { WorkflowGenerateResponse } from '@dify/contracts/api/console/workflow-generate/types.gen'
import { act, renderHook } from '@testing-library/react'
import useGenGraph from '../use-gen-graph'

const makeVersion = (marker: string): WorkflowGenerateResponse => ({
  graph: {
    nodes: [
      {
        id: marker,
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { type: 'start', title: marker },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 0.7 },
  },
  message: marker,
})

describe('useGenGraph', () => {
  beforeEach(() => {
    sessionStorage.removeItem('workflow-gen-workflow-test-versions')
    sessionStorage.removeItem('workflow-gen-workflow-test-version-index')
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
  })
})
