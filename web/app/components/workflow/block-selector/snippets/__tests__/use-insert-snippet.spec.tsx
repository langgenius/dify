import { act, renderHook } from '@testing-library/react'
import { useInsertSnippet } from '../use-insert-snippet'

const mockFetchQuery = vi.fn()
const mockHandleSyncWorkflowDraft = vi.fn()
const mockSaveStateToHistory = vi.fn()
const mockToastError = vi.fn()
const mockGetNodes = vi.fn()
const mockSetNodes = vi.fn()
const mockSetEdges = vi.fn()

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
      edges: [{ id: 'existing-edge', source: 'old', target: 'old-2' }],
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

describe('useInsertSnippet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

      const nextNodes = mockSetNodes.mock.calls[0][0]
      expect(nextNodes[0].selected).toBe(false)
      expect(nextNodes[0].data.selected).toBe(false)
      expect(nextNodes).toHaveLength(3)
      expect(nextNodes[1].id).not.toBe('snippet-node-1')
      expect(nextNodes[2].parentId).toBe(nextNodes[1].id)
      expect(nextNodes[1].data._children[0].nodeId).toBe(nextNodes[2].id)

      const nextEdges = mockSetEdges.mock.calls[0][0]
      expect(nextEdges).toHaveLength(2)
      expect(nextEdges[1].source).toBe(nextNodes[1].id)
      expect(nextEdges[1].target).toBe(nextNodes[2].id)

      expect(mockSaveStateToHistory).toHaveBeenCalledWith('NodePaste', {
        nodeId: nextNodes[1].id,
      })
      expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    })

    it('should show error toast when fetching snippet workflow fails', async () => {
      mockFetchQuery.mockRejectedValue(new Error('insert failed'))

      const { result } = renderHook(() => useInsertSnippet())

      await act(async () => {
        await result.current.handleInsertSnippet('snippet-1')
      })

      expect(mockToastError).toHaveBeenCalledWith('insert failed')
    })
  })
})
