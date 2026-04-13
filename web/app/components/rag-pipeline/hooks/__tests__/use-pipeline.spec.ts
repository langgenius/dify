import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePipeline } from '../use-pipeline'

const mockGetNodes = vi.fn()
const mockSetNodes = vi.fn()
const mockEdges: Array<{ id: string, source: string, target: string }> = []

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
      setNodes: mockSetNodes,
      edges: mockEdges,
    }),
  }),
  getOutgoers: (node: { id: string }, nodes: Array<{ id: string }>, edges: Array<{ source: string, target: string }>) => {
    return nodes.filter(n => edges.some(e => e.source === node.id && e.target === n.id))
  },
}))

const mockFindUsedVarNodes = vi.fn()
const mockUpdateNodeVars = vi.fn()
vi.mock('../../../workflow/nodes/_base/components/variable/utils', () => ({
  findUsedVarNodes: (...args: unknown[]) => mockFindUsedVarNodes(...args),
  updateNodeVars: (...args: unknown[]) => mockUpdateNodeVars(...args),
}))

vi.mock('../../../workflow/types', () => ({
  BlockEnum: {
    DataSource: 'data-source',
  },
}))

vi.mock('es-toolkit/compat', () => ({
  uniqBy: (arr: Array<{ id: string }>, key: string) => {
    const seen = new Set<string>()
    return arr.filter((item) => {
      const val = item[key as keyof typeof item] as string
      if (seen.has(val))
        return false
      seen.add(val)
      return true
    })
  },
}))

function createNode(id: string, type: string) {
  return { id, data: { type }, position: { x: 0, y: 0 } }
}

describe('usePipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEdges.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('hook initialization', () => {
    it('should return handleInputVarRename function', () => {
      mockGetNodes.mockReturnValue([])
      const { result } = renderHook(() => usePipeline())

      expect(result.current.handleInputVarRename).toBeDefined()
      expect(typeof result.current.handleInputVarRename).toBe('function')
    })

    it('should return isVarUsedInNodes function', () => {
      mockGetNodes.mockReturnValue([])
      const { result } = renderHook(() => usePipeline())

      expect(result.current.isVarUsedInNodes).toBeDefined()
      expect(typeof result.current.isVarUsedInNodes).toBe('function')
    })

    it('should return removeUsedVarInNodes function', () => {
      mockGetNodes.mockReturnValue([])
      const { result } = renderHook(() => usePipeline())

      expect(result.current.removeUsedVarInNodes).toBeDefined()
      expect(typeof result.current.removeUsedVarInNodes).toBe('function')
    })
  })

  describe('isVarUsedInNodes', () => {
    it('should return true when variable is used in downstream nodes', () => {
      const dsNode = createNode('ds-1', 'data-source')
      const downstreamNode = createNode('node-2', 'llm')
      mockGetNodes.mockReturnValue([dsNode, downstreamNode])
      mockEdges.push({ id: 'e1', source: 'ds-1', target: 'node-2' })
      mockFindUsedVarNodes.mockReturnValue([downstreamNode])

      const { result } = renderHook(() => usePipeline())

      const isUsed = result.current.isVarUsedInNodes(['rag', 'ds-1', 'var1'])
      expect(isUsed).toBe(true)
      expect(mockFindUsedVarNodes).toHaveBeenCalledWith(
        ['rag', 'ds-1', 'var1'],
        expect.any(Array),
      )
    })

    it('should return false when variable is not used', () => {
      const dsNode = createNode('ds-1', 'data-source')
      mockGetNodes.mockReturnValue([dsNode])
      mockFindUsedVarNodes.mockReturnValue([])

      const { result } = renderHook(() => usePipeline())

      const isUsed = result.current.isVarUsedInNodes(['rag', 'ds-1', 'var1'])
      expect(isUsed).toBe(false)
    })

    it('should handle shared nodeId by collecting all datasource nodes', () => {
      const ds1 = createNode('ds-1', 'data-source')
      const ds2 = createNode('ds-2', 'data-source')
      const node3 = createNode('node-3', 'llm')
      mockGetNodes.mockReturnValue([ds1, ds2, node3])
      mockEdges.push({ id: 'e1', source: 'ds-1', target: 'node-3' })
      mockFindUsedVarNodes.mockReturnValue([node3])

      const { result } = renderHook(() => usePipeline())

      const isUsed = result.current.isVarUsedInNodes(['rag', 'shared', 'var1'])
      expect(isUsed).toBe(true)
    })

    it('should return false for shared nodeId when no datasource nodes exist', () => {
      mockGetNodes.mockReturnValue([createNode('node-1', 'llm')])
      mockFindUsedVarNodes.mockReturnValue([])

      const { result } = renderHook(() => usePipeline())

      const isUsed = result.current.isVarUsedInNodes(['rag', 'shared', 'var1'])
      expect(isUsed).toBe(false)
    })
  })

  describe('handleInputVarRename', () => {
    it('should rename variable in affected nodes', () => {
      const dsNode = createNode('ds-1', 'data-source')
      const node2 = createNode('node-2', 'llm')
      const updatedNode2 = { ...node2, data: { ...node2.data, renamed: true } }
      mockGetNodes.mockReturnValue([dsNode, node2])
      mockEdges.push({ id: 'e1', source: 'ds-1', target: 'node-2' })
      mockFindUsedVarNodes.mockReturnValue([node2])
      mockUpdateNodeVars.mockReturnValue(updatedNode2)

      const { result } = renderHook(() => usePipeline())

      act(() => {
        result.current.handleInputVarRename(
          'ds-1',
          ['rag', 'ds-1', 'oldVar'],
          ['rag', 'ds-1', 'newVar'],
        )
      })

      expect(mockFindUsedVarNodes).toHaveBeenCalledWith(
        ['rag', 'ds-1', 'oldVar'],
        expect.any(Array),
      )
      expect(mockUpdateNodeVars).toHaveBeenCalledWith(
        node2,
        ['rag', 'ds-1', 'oldVar'],
        ['rag', 'ds-1', 'newVar'],
      )
      expect(mockSetNodes).toHaveBeenCalled()
    })

    it('should not call setNodes when no nodes are affected', () => {
      const dsNode = createNode('ds-1', 'data-source')
      mockGetNodes.mockReturnValue([dsNode])
      mockFindUsedVarNodes.mockReturnValue([])

      const { result } = renderHook(() => usePipeline())

      act(() => {
        result.current.handleInputVarRename(
          'ds-1',
          ['rag', 'ds-1', 'oldVar'],
          ['rag', 'ds-1', 'newVar'],
        )
      })

      expect(mockSetNodes).not.toHaveBeenCalled()
    })

    it('should only update affected nodes, leave others unchanged', () => {
      const dsNode = createNode('ds-1', 'data-source')
      const node2 = createNode('node-2', 'llm')
      const node3 = createNode('node-3', 'end')
      mockGetNodes.mockReturnValue([dsNode, node2, node3])
      mockEdges.push(
        { id: 'e1', source: 'ds-1', target: 'node-2' },
        { id: 'e2', source: 'node-2', target: 'node-3' },
      )
      mockFindUsedVarNodes.mockReturnValue([node2])
      const updatedNode2 = { ...node2, updated: true }
      mockUpdateNodeVars.mockReturnValue(updatedNode2)

      const { result } = renderHook(() => usePipeline())

      act(() => {
        result.current.handleInputVarRename(
          'ds-1',
          ['rag', 'ds-1', 'var1'],
          ['rag', 'ds-1', 'var2'],
        )
      })

      const setNodesArg = mockSetNodes.mock.calls[0][0]
      expect(setNodesArg).toContain(dsNode)
      expect(setNodesArg).toContain(updatedNode2)
      expect(setNodesArg).toContain(node3)
    })
  })

  describe('removeUsedVarInNodes', () => {
    it('should remove variable references from affected nodes', () => {
      const dsNode = createNode('ds-1', 'data-source')
      const node2 = createNode('node-2', 'llm')
      const cleanedNode2 = { ...node2, data: { ...node2.data, cleaned: true } }
      mockGetNodes.mockReturnValue([dsNode, node2])
      mockEdges.push({ id: 'e1', source: 'ds-1', target: 'node-2' })
      mockFindUsedVarNodes.mockReturnValue([node2])
      mockUpdateNodeVars.mockReturnValue(cleanedNode2)

      const { result } = renderHook(() => usePipeline())

      act(() => {
        result.current.removeUsedVarInNodes(['rag', 'ds-1', 'var1'])
      })

      expect(mockUpdateNodeVars).toHaveBeenCalledWith(
        node2,
        ['rag', 'ds-1', 'var1'],
        [], // Empty array removes the variable
      )
      expect(mockSetNodes).toHaveBeenCalled()
    })

    it('should not call setNodes when no nodes use the variable', () => {
      const dsNode = createNode('ds-1', 'data-source')
      mockGetNodes.mockReturnValue([dsNode])
      mockFindUsedVarNodes.mockReturnValue([])

      const { result } = renderHook(() => usePipeline())

      act(() => {
        result.current.removeUsedVarInNodes(['rag', 'ds-1', 'var1'])
      })

      expect(mockSetNodes).not.toHaveBeenCalled()
    })
  })

  describe('getAllNodesInSameBranch — edge cases', () => {
    it('should traverse multi-level downstream nodes', () => {
      const ds = createNode('ds-1', 'data-source')
      const n2 = createNode('node-2', 'llm')
      const n3 = createNode('node-3', 'end')
      mockGetNodes.mockReturnValue([ds, n2, n3])
      mockEdges.push(
        { id: 'e1', source: 'ds-1', target: 'node-2' },
        { id: 'e2', source: 'node-2', target: 'node-3' },
      )
      mockFindUsedVarNodes.mockReturnValue([n3])
      mockUpdateNodeVars.mockReturnValue(n3)

      const { result } = renderHook(() => usePipeline())

      const isUsed = result.current.isVarUsedInNodes(['rag', 'ds-1', 'var1'])
      expect(isUsed).toBe(true)

      const nodesArg = mockFindUsedVarNodes.mock.calls[0][1] as Array<{ id: string }>
      const nodeIds = nodesArg.map(n => n.id)
      expect(nodeIds).toContain('ds-1')
      expect(nodeIds).toContain('node-2')
      expect(nodeIds).toContain('node-3')
    })

    it('should return empty array for non-existent node', () => {
      mockGetNodes.mockReturnValue([createNode('ds-1', 'data-source')])
      mockFindUsedVarNodes.mockReturnValue([])

      const { result } = renderHook(() => usePipeline())

      const isUsed = result.current.isVarUsedInNodes(['rag', 'non-existent', 'var1'])
      expect(isUsed).toBe(false)
    })

    it('should deduplicate nodes when traversal finds shared nodes', () => {
      const ds = createNode('ds-1', 'data-source')
      const n2 = createNode('node-2', 'llm')
      const n3 = createNode('node-3', 'llm')
      const n4 = createNode('node-4', 'end')
      mockGetNodes.mockReturnValue([ds, n2, n3, n4])
      mockEdges.push(
        { id: 'e1', source: 'ds-1', target: 'node-2' },
        { id: 'e2', source: 'ds-1', target: 'node-3' },
        { id: 'e3', source: 'node-2', target: 'node-4' },
        { id: 'e4', source: 'node-3', target: 'node-4' },
      )
      mockFindUsedVarNodes.mockReturnValue([])

      const { result } = renderHook(() => usePipeline())

      result.current.isVarUsedInNodes(['rag', 'ds-1', 'var1'])

      const nodesArg = mockFindUsedVarNodes.mock.calls[0][1] as Array<{ id: string }>
      const nodeIds = nodesArg.map(n => n.id)
      const uniqueIds = [...new Set(nodeIds)]
      expect(nodeIds.length).toBe(uniqueIds.length)
    })
  })
})
