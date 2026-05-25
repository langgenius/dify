import { act, renderHook } from '@testing-library/react'
import { useInsertSnippet } from '../use-insert-snippet'

type TestNode = {
  id: string
  position: { x: number, y: number }
  selected?: boolean
  parentId?: string
  data: {
    selected?: boolean
    _children?: { nodeId: string, nodeType: string }[]
    _connectedSourceHandleIds?: string[]
    _connectedTargetHandleIds?: string[]
  }
}

type TestEdge = {
  id: string
  source: string
  sourceHandle?: string
  target: string
  targetHandle?: string
}

const mockFetchQuery = vi.fn()
const mockHandleSyncWorkflowDraft = vi.fn()
const mockSaveStateToHistory = vi.fn()
const mockToastError = vi.fn()
const mockGetNodes = vi.fn()
const mockSetNodes = vi.fn()
const mockSetEdges = vi.fn()
const mockIncrementSnippetUseCount = vi.fn()
let mockEdges: unknown[] = [{ id: 'existing-edge', source: 'old', target: 'old-2' }]

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    fetchQuery: mockFetchQuery,
  }),
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
      setNodes: mockSetNodes,
      edges: mockEdges,
      setEdges: mockSetEdges,
    }),
  }),
}))

vi.mock('../../../hooks', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
  useWorkflowHistory: () => ({
    saveStateToHistory: mockSaveStateToHistory,
  }),
  WorkflowHistoryEvent: {
    NodePaste: 'NodePaste',
  },
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/service/use-snippets', () => ({
  useIncrementSnippetUseCountMutation: () => ({
    mutate: mockIncrementSnippetUseCount,
  }),
}))

describe('useInsertSnippet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEdges = [{ id: 'existing-edge', source: 'old', target: 'old-2' }]
    mockGetNodes.mockReturnValue([
      {
        id: 'existing-node',
        position: { x: 0, y: 0 },
        data: { selected: true },
      },
    ])
  })

  describe('Insert Flow', () => {
    it('should append remapped snippet graph into current workflow graph', async () => {
      mockFetchQuery.mockResolvedValue({
        graph: {
          nodes: [
            {
              id: 'snippet-node-1',
              position: { x: 10, y: 20 },
              data: { selected: false, _children: [{ nodeId: 'snippet-node-2', nodeType: 'code' }] },
            },
            {
              id: 'snippet-node-2',
              parentId: 'snippet-node-1',
              position: { x: 30, y: 40 },
              data: { selected: false },
            },
          ],
          edges: [
            {
              id: 'edge-1',
              source: 'snippet-node-1',
              sourceHandle: 'source',
              target: 'snippet-node-2',
              targetHandle: 'target',
              data: {},
            },
          ],
        },
      })

      const { result } = renderHook(() => useInsertSnippet())

      await act(async () => {
        await result.current.handleInsertSnippet('snippet-1')
      })

      expect(mockFetchQuery).toHaveBeenCalledTimes(1)
      expect(mockSetNodes).toHaveBeenCalledTimes(1)
      expect(mockSetEdges).toHaveBeenCalledTimes(1)

      const nextNodes = mockSetNodes.mock.calls[0]![0] as TestNode[]
      expect(nextNodes[0]!.selected).toBe(false)
      expect(nextNodes[0]!.data.selected).toBe(false)
      expect(nextNodes).toHaveLength(3)
      expect(nextNodes[1]!.id).not.toBe('snippet-node-1')
      expect(nextNodes[2]!.parentId).toBe(nextNodes[1]!.id)
      expect(nextNodes[1]!.data._children![0]!.nodeId).toBe(nextNodes[2]!.id)

      const nextEdges = mockSetEdges.mock.calls[0]![0] as TestEdge[]
      expect(nextEdges).toHaveLength(2)
      expect(nextEdges[1]!.source).toBe(nextNodes[1]!.id)
      expect(nextEdges[1]!.target).toBe(nextNodes[2]!.id)

      expect(mockSaveStateToHistory).toHaveBeenCalledWith('NodePaste', {
        nodeId: nextNodes[1]!.id,
      })
      expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(mockIncrementSnippetUseCount).toHaveBeenCalledWith({
        params: { snippetId: 'snippet-1' },
      })
    })

    it('should connect inserted snippet nodes to the requested edge position', async () => {
      mockGetNodes.mockReturnValue([
        {
          id: 'prev-node',
          position: { x: 0, y: 0 },
          width: 240,
          data: { type: 'start', selected: true, _connectedSourceHandleIds: ['source'] },
        },
        {
          id: 'next-node',
          position: { x: 300, y: 0 },
          data: { type: 'answer', selected: false, _connectedTargetHandleIds: ['target'] },
        },
      ])
      mockEdges = [
        {
          id: 'prev-node-source-next-node-target',
          source: 'prev-node',
          sourceHandle: 'source',
          target: 'next-node',
          targetHandle: 'target',
          data: {
            sourceType: 'start',
            targetType: 'answer',
          },
        },
      ]
      mockFetchQuery.mockResolvedValue({
        graph: {
          nodes: [
            {
              id: 'snippet-entry',
              position: { x: 0, y: 0 },
              data: { type: 'llm', selected: false },
            },
            {
              id: 'snippet-exit',
              position: { x: 300, y: 0 },
              data: { type: 'code', selected: false },
            },
          ],
          edges: [
            {
              id: 'snippet-entry-source-snippet-exit-target',
              source: 'snippet-entry',
              sourceHandle: 'source',
              target: 'snippet-exit',
              targetHandle: 'target',
              data: {
                sourceType: 'llm',
                targetType: 'code',
              },
            },
          ],
        },
      })

      const { result } = renderHook(() => useInsertSnippet())

      await act(async () => {
        await result.current.handleInsertSnippet('snippet-1', {
          prevNodeId: 'prev-node',
          prevNodeSourceHandle: 'source',
          nextNodeId: 'next-node',
          nextNodeTargetHandle: 'target',
        })
      })

      const nextNodes = mockSetNodes.mock.calls[0]![0] as TestNode[]
      const insertedEntry = nextNodes.find(node => node.id !== 'prev-node' && node.id !== 'next-node' && node.id.includes('snippet-entry'))!
      const insertedExit = nextNodes.find(node => node.id !== 'prev-node' && node.id !== 'next-node' && node.id.includes('snippet-exit'))!
      const shiftedNextNode = nextNodes.find(node => node.id === 'next-node')!
      expect(insertedEntry.position).toEqual({ x: 300, y: 0 })
      expect(shiftedNextNode.position.x).toBe(600)
      expect(nextNodes.find(node => node.id === 'prev-node')!.data._connectedSourceHandleIds).toEqual(['source'])
      expect(insertedEntry.data._connectedTargetHandleIds).toEqual(['target'])
      expect(insertedExit.data._connectedSourceHandleIds).toEqual(['source'])
      expect(shiftedNextNode.data._connectedTargetHandleIds).toEqual(['target'])

      const nextEdges = mockSetEdges.mock.calls[0]![0] as TestEdge[]
      expect(nextEdges).toHaveLength(3)
      expect(nextEdges.some(edge => edge.id === 'prev-node-source-next-node-target')).toBe(false)
      expect(nextEdges).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: 'prev-node',
          sourceHandle: 'source',
          target: insertedEntry.id,
          targetHandle: 'target',
        }),
        expect.objectContaining({
          source: insertedEntry.id,
          target: insertedExit.id,
        }),
        expect.objectContaining({
          source: insertedExit.id,
          sourceHandle: 'source',
          target: 'next-node',
          targetHandle: 'target',
        }),
      ]))
      expect(mockIncrementSnippetUseCount).toHaveBeenCalledWith({
        params: { snippetId: 'snippet-1' },
      })
    })

    it('should show error toast when fetching snippet workflow fails', async () => {
      mockFetchQuery.mockRejectedValue(new Error('insert failed'))

      const { result } = renderHook(() => useInsertSnippet())

      await act(async () => {
        await result.current.handleInsertSnippet('snippet-1')
      })

      expect(mockToastError).toHaveBeenCalledWith('insert failed')
      expect(mockIncrementSnippetUseCount).not.toHaveBeenCalled()
    })
  })
})
