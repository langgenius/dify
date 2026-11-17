import type { WorkflowGenerateResponse } from '@dify/contracts/api/console/workflow-generate/types.gen'
import { act, renderHook } from '@testing-library/react'
import useGenGraph from '../../../app/components/workflow/workflow-generator/use-gen-graph'

describe('useGenGraph', () => {
  beforeEach(() => {
    for (const key of ['history', 'mode-a', 'mode-b']) {
      sessionStorage.removeItem(`workflow-gen-${key}-versions`)
      sessionStorage.removeItem(`workflow-gen-${key}-version-index`)
    }
  })

  const makeResponse = (label: string): WorkflowGenerateResponse => ({
    graph: {
      nodes: [
        {
          id: label,
          type: 'custom',
          position: { x: 0, y: 0 },
          data: { type: 'start', title: label },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    message: label,
  })

  it('persists batched generations and the selected older version across remounts', () => {
    const { result, unmount } = renderHook(() => useGenGraph({ storageKey: 'history' }))
    act(() => {
      result.current.addVersion(makeResponse('first'))
      result.current.addVersion(makeResponse('latest'))
    })
    expect(result.current.current?.message).toBe('latest')

    act(() => result.current.setCurrentVersionIndex(0))
    expect(result.current.current?.message).toBe('first')
    unmount()

    const restored = renderHook(() => useGenGraph({ storageKey: 'history' }))
    expect(restored.result.current.versions).toEqual([
      makeResponse('first'),
      makeResponse('latest'),
    ])
    expect(restored.result.current.current?.message).toBe('first')
  })

  it('isolates state by storageKey', () => {
    const { result: r1 } = renderHook(() => useGenGraph({ storageKey: 'mode-a' }))
    const { result: r2 } = renderHook(() => useGenGraph({ storageKey: 'mode-b' }))

    act(() => {
      r1.current.addVersion(makeResponse('only-a'))
    })

    expect(r1.current.versions).toHaveLength(1)
    expect(r2.current.versions).toHaveLength(0)
  })
})
