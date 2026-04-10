import type { Edge, Node } from '../../types'
import { act } from '@testing-library/react'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useNodesInteractions } from '../use-nodes-interactions'

const mockHandleSyncWorkflowDraft = vi.hoisted(() => vi.fn())
const mockSaveStateToHistory = vi.hoisted(() => vi.fn())
const mockUndo = vi.hoisted(() => vi.fn())
const mockRedo = vi.hoisted(() => vi.fn())

const runtimeState = vi.hoisted(() => ({
  nodesReadOnly: false,
  workflowReadOnly: false,
}))

let currentNodes: Node[] = []
let currentEdges: Edge[] = []

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

vi.mock('../use-workflow', () => ({
  useWorkflow: () => ({
    getAfterNodesInSameBranch: () => [],
  }),
  useNodesReadOnly: () => ({
    getNodesReadOnly: () => runtimeState.nodesReadOnly,
  }),
  useWorkflowReadOnly: () => ({
    getWorkflowReadOnly: () => runtimeState.workflowReadOnly,
  }),
}))

vi.mock('../use-helpline', () => ({
  useHelpline: () => ({
    handleSetHelpline: () => ({
      showHorizontalHelpLineNodes: [],
      showVerticalHelpLineNodes: [],
    }),
  }),
}))

vi.mock('../use-nodes-meta-data', () => ({
  useNodesMetaData: () => ({
    nodesMap: {},
  }),
}))

vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
}))

vi.mock('../use-auto-generate-webhook-url', () => ({
  useAutoGenerateWebhookUrl: () => vi.fn(),
}))

vi.mock('../use-inspect-vars-crud', () => ({
  default: () => ({
    deleteNodeInspectorVars: vi.fn(),
  }),
}))

vi.mock('../../nodes/iteration/use-interactions', () => ({
  useNodeIterationInteractions: () => ({
    handleNodeIterationChildDrag: () => ({ restrictPosition: {} }),
    handleNodeIterationChildrenCopy: vi.fn(),
  }),
}))

vi.mock('../../nodes/loop/use-interactions', () => ({
  useNodeLoopInteractions: () => ({
    handleNodeLoopChildDrag: () => ({ restrictPosition: {} }),
    handleNodeLoopChildrenCopy: vi.fn(),
  }),
}))

vi.mock('../use-workflow-history', async importOriginal => ({
  ...(await importOriginal<typeof import('../use-workflow-history')>()),
  useWorkflowHistory: () => ({
    saveStateToHistory: mockSaveStateToHistory,
    undo: mockUndo,
    redo: mockRedo,
  }),
}))

describe('useNodesInteractions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    runtimeState.nodesReadOnly = false
    runtimeState.workflowReadOnly = false
    currentNodes = [
      createNode({
        id: 'node-1',
        position: { x: 10, y: 20 },
        data: {
          type: BlockEnum.Code,
          title: 'Code',
          desc: '',
        },
      }),
    ]
    currentEdges = [
      createEdge({
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
      }),
    ]
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes
    rfState.edges = currentEdges as unknown as typeof rfState.edges
  })

  it('persists node drags only when the node position actually changes', () => {
    const node = currentNodes[0]
    const movedNode = {
      ...node,
      position: { x: 120, y: 80 },
    }

    const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })

    act(() => {
      result.current.handleNodeDragStart({} as never, node, currentNodes)
      result.current.handleNodeDragStop({} as never, movedNode, currentNodes)
    })

    expect(store.getState().nodeAnimation).toBe(false)
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('NodeDragStop', {
      nodeId: 'node-1',
    })
  })

  it('restores history snapshots on undo and clears the edge menu', () => {
    const historyNodes = [
      createNode({
        id: 'history-node',
        data: {
          type: BlockEnum.End,
          title: 'End',
          desc: '',
        },
      }),
    ]
    const historyEdges = [
      createEdge({
        id: 'history-edge',
        source: 'history-node',
        target: 'node-1',
      }),
    ]

    const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
      initialStoreState: {
        edgeMenu: {
          id: 'edge-1',
        } as never,
      },
      historyStore: {
        nodes: historyNodes,
        edges: historyEdges,
      },
    })

    act(() => {
      result.current.handleHistoryBack()
    })

    expect(mockUndo).toHaveBeenCalledTimes(1)
    expect(rfState.setNodes).toHaveBeenCalledWith(historyNodes)
    expect(rfState.setEdges).toHaveBeenCalledWith(historyEdges)
    expect(store.getState().edgeMenu).toBeUndefined()
  })

  it('skips undo and redo when the workflow is read-only', () => {
    runtimeState.workflowReadOnly = true
    const { result } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })

    act(() => {
      result.current.handleHistoryBack()
      result.current.handleHistoryForward()
    })

    expect(mockUndo).not.toHaveBeenCalled()
    expect(mockRedo).not.toHaveBeenCalled()
    expect(rfState.setNodes).not.toHaveBeenCalled()
    expect(rfState.setEdges).not.toHaveBeenCalled()
  })
})
