import type { Edge, Node } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSubGraphNodes } from '../use-sub-graph-nodes'

const mockInitialNodes = vi.fn()
const mockInitialEdges = vi.fn()

vi.mock('@/app/components/workflow/utils', () => ({
  initialNodes: (...args: unknown[]) => mockInitialNodes(...args),
  initialEdges: (...args: unknown[]) => mockInitialEdges(...args),
}))

describe('useSubGraphNodes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should process nodes and edges through the workflow initializers', () => {
    const nodes = [{ id: 'node-1' }] as Node[]
    const edges = [{ id: 'edge-1' }] as Edge[]
    mockInitialNodes.mockReturnValue([{ id: 'processed-node' }])
    mockInitialEdges.mockReturnValue([{ id: 'processed-edge' }])

    const { result } = renderHook(() => useSubGraphNodes(nodes, edges))

    expect(mockInitialNodes).toHaveBeenCalledWith(nodes, edges)
    expect(mockInitialEdges).toHaveBeenCalledWith(edges, nodes)
    expect(result.current).toEqual({
      nodes: [{ id: 'processed-node' }],
      edges: [{ id: 'processed-edge' }],
    })
  })
})
