import { act } from '@testing-library/react'
import {
  createLoopNode,
  createNode,
} from '../../__tests__/fixtures'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { ControlMode } from '../../types'
import {
  useWorkflowCanvasMaximize,
  useWorkflowInteractions,
  useWorkflowMoveMode,
  useWorkflowOrganize,
  useWorkflowUpdate,
  useWorkflowZoom,
} from '../use-workflow-interactions'
import * as workflowInteractionExports from '../use-workflow-interactions'

const mockSetViewport = vi.hoisted(() => vi.fn())
const mockSetNodes = vi.hoisted(() => vi.fn())
const mockZoomIn = vi.hoisted(() => vi.fn())
const mockZoomOut = vi.hoisted(() => vi.fn())
const mockZoomTo = vi.hoisted(() => vi.fn())
const mockFitView = vi.hoisted(() => vi.fn())
const mockEventEmit = vi.hoisted(() => vi.fn())
const mockHandleSelectionCancel = vi.hoisted(() => vi.fn())
const mockHandleNodeCancelRunningStatus = vi.hoisted(() => vi.fn())
const mockHandleEdgeCancelRunningStatus = vi.hoisted(() => vi.fn())
const mockHandleSyncWorkflowDraft = vi.hoisted(() => vi.fn())
const mockSaveStateToHistory = vi.hoisted(() => vi.fn())
const mockGetLayoutForChildNodes = vi.hoisted(() => vi.fn())
const mockGetLayoutByELK = vi.hoisted(() => vi.fn())
const mockInitialNodes = vi.hoisted(() => vi.fn((nodes: unknown[], _edges: unknown[]) => nodes))
const mockInitialEdges = vi.hoisted(() => vi.fn((edges: unknown[], _nodes: unknown[]) => edges))

const runtimeState = vi.hoisted(() => ({
  nodes: [] as ReturnType<typeof createNode>[],
  edges: [] as { id: string, source: string, target: string }[],
  nodesReadOnly: false,
  workflowReadOnly: false,
}))

vi.mock('reactflow', () => ({
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => runtimeState.nodes,
      edges: runtimeState.edges,
      setNodes: mockSetNodes,
    }),
    setState: vi.fn(),
  }),
  useReactFlow: () => ({
    setViewport: mockSetViewport,
    zoomIn: mockZoomIn,
    zoomOut: mockZoomOut,
    zoomTo: mockZoomTo,
    fitView: mockFitView,
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: (...args: unknown[]) => mockEventEmit(...args),
    },
  }),
}))

vi.mock('../use-workflow', () => ({
  useNodesReadOnly: () => ({
    getNodesReadOnly: () => runtimeState.nodesReadOnly,
    nodesReadOnly: runtimeState.nodesReadOnly,
  }),
  useWorkflowReadOnly: () => ({
    getWorkflowReadOnly: () => runtimeState.workflowReadOnly,
  }),
}))

vi.mock('../use-selection-interactions', () => ({
  useSelectionInteractions: () => ({
    handleSelectionCancel: (...args: unknown[]) => mockHandleSelectionCancel(...args),
  }),
}))

vi.mock('../use-nodes-interactions-without-sync', () => ({
  useNodesInteractionsWithoutSync: () => ({
    handleNodeCancelRunningStatus: (...args: unknown[]) => mockHandleNodeCancelRunningStatus(...args),
  }),
}))

vi.mock('../use-edges-interactions-without-sync', () => ({
  useEdgesInteractionsWithoutSync: () => ({
    handleEdgeCancelRunningStatus: (...args: unknown[]) => mockHandleEdgeCancelRunningStatus(...args),
  }),
}))

vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: (...args: unknown[]) => mockHandleSyncWorkflowDraft(...args),
  }),
}))

vi.mock('../use-workflow-history', () => ({
  useWorkflowHistory: () => ({
    saveStateToHistory: (...args: unknown[]) => mockSaveStateToHistory(...args),
  }),
  WorkflowHistoryEvent: {
    LayoutOrganize: 'LayoutOrganize',
  },
}))

vi.mock('../../utils', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils')>()),
  initialNodes: (nodes: unknown[], edges: unknown[]) => mockInitialNodes(nodes, edges),
  initialEdges: (edges: unknown[], nodes: unknown[]) => mockInitialEdges(edges, nodes),
}))

vi.mock('../../utils/elk-layout', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/elk-layout')>()),
  getLayoutForChildNodes: (...args: unknown[]) => mockGetLayoutForChildNodes(...args),
  getLayoutByELK: (...args: unknown[]) => mockGetLayoutByELK(...args),
}))

describe('use-workflow-interactions exports', () => {
  it('re-exports the split workflow interaction hooks', () => {
    expect(workflowInteractionExports.useWorkflowInteractions).toBeTypeOf('function')
    expect(workflowInteractionExports.useWorkflowMoveMode).toBeTypeOf('function')
    expect(workflowInteractionExports.useWorkflowOrganize).toBeTypeOf('function')
    expect(workflowInteractionExports.useWorkflowZoom).toBeTypeOf('function')
    expect(workflowInteractionExports.useWorkflowUpdate).toBeTypeOf('function')
    expect(workflowInteractionExports.useWorkflowCanvasMaximize).toBeTypeOf('function')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    runtimeState.nodes = []
    runtimeState.edges = []
    runtimeState.nodesReadOnly = false
    runtimeState.workflowReadOnly = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('useWorkflowInteractions should close debug panel and clear running status', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowInteractions(), {
      initialStoreState: {
        showDebugAndPreviewPanel: true,
        workflowRunningData: { task_id: 'task-1' } as never,
      },
    })

    act(() => {
      result.current.handleCancelDebugAndPreviewPanel()
    })

    expect(store.getState().showDebugAndPreviewPanel).toBe(false)
    expect(store.getState().workflowRunningData).toBeUndefined()
    expect(mockHandleNodeCancelRunningStatus).toHaveBeenCalled()
    expect(mockHandleEdgeCancelRunningStatus).toHaveBeenCalled()
  })

  it('useWorkflowMoveMode should switch pointer and hand modes when editable', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowMoveMode(), {
      initialStoreState: {
        controlMode: ControlMode.Pointer,
      },
    })

    act(() => {
      result.current.handleModeHand()
    })
    expect(store.getState().controlMode).toBe(ControlMode.Hand)
    expect(mockHandleSelectionCancel).toHaveBeenCalled()

    act(() => {
      result.current.handleModePointer()
    })
    expect(store.getState().controlMode).toBe(ControlMode.Pointer)
  })

  it('useWorkflowOrganize should resize containers, layout nodes and sync draft', async () => {
    runtimeState.nodes = [
      createLoopNode({
        id: 'loop-node',
        width: 200,
        height: 160,
      }),
      createNode({
        id: 'loop-child',
        parentId: 'loop-node',
        position: { x: 20, y: 20 },
        width: 100,
        height: 60,
      }),
      createNode({
        id: 'top-node',
        position: { x: 400, y: 0 },
      }),
    ]
    runtimeState.edges = []
    mockGetLayoutForChildNodes.mockResolvedValue({
      bounds: { minX: 0, minY: 0, maxX: 320, maxY: 220 },
      nodes: new Map([
        ['loop-child', { x: 40, y: 60, width: 100, height: 60 }],
      ]),
    })
    mockGetLayoutByELK.mockResolvedValue({
      nodes: new Map([
        ['loop-node', { x: 10, y: 20, width: 360, height: 260, layer: 0 }],
        ['top-node', { x: 500, y: 30, width: 240, height: 100, layer: 0 }],
      ]),
    })

    const { result } = renderWorkflowHook(() => useWorkflowOrganize())

    await act(async () => {
      await result.current.handleLayout()
    })
    act(() => {
      vi.runAllTimers()
    })

    expect(mockSetNodes).toHaveBeenCalledTimes(1)
    const nextNodes = mockSetNodes.mock.calls[0]![0]
    expect(nextNodes.find((node: { id: string }) => node.id === 'loop-node')).toEqual(expect.objectContaining({
      width: expect.any(Number),
      height: expect.any(Number),
      position: { x: 10, y: 20 },
    }))
    expect(nextNodes.find((node: { id: string }) => node.id === 'loop-child')).toEqual(expect.objectContaining({
      position: { x: 100, y: 120 },
    }))
    expect(mockSetViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 0.7 })
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('LayoutOrganize')
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalled()
  })

  it('useWorkflowZoom should run zoom actions and sync draft when editable', () => {
    const { result } = renderWorkflowHook(() => useWorkflowZoom())

    act(() => {
      result.current.handleFitView()
      result.current.handleBackToOriginalSize()
      result.current.handleSizeToHalf()
      result.current.handleZoomOut()
      result.current.handleZoomIn()
    })

    expect(mockFitView).toHaveBeenCalled()
    expect(mockZoomTo).toHaveBeenCalledWith(1)
    expect(mockZoomTo).toHaveBeenCalledWith(0.5)
    expect(mockZoomOut).toHaveBeenCalled()
    expect(mockZoomIn).toHaveBeenCalled()
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(5)
  })

  it('should skip move, zoom, organize and maximize actions when read-only', async () => {
    runtimeState.nodesReadOnly = true
    runtimeState.workflowReadOnly = true
    runtimeState.nodes = [createNode({ id: 'n1' })]

    const moveMode = renderWorkflowHook(() => useWorkflowMoveMode(), {
      initialStoreState: { controlMode: ControlMode.Pointer },
    })
    const zoom = renderWorkflowHook(() => useWorkflowZoom())
    const organize = renderWorkflowHook(() => useWorkflowOrganize())
    const maximize = renderWorkflowHook(() => useWorkflowCanvasMaximize())

    act(() => {
      moveMode.result.current.handleModeHand()
      moveMode.result.current.handleModePointer()
      zoom.result.current.handleFitView()
      maximize.result.current.handleToggleMaximizeCanvas()
    })
    await act(async () => {
      await organize.result.current.handleLayout()
    })

    expect(moveMode.store.getState().controlMode).toBe(ControlMode.Pointer)
    expect(mockHandleSelectionCancel).not.toHaveBeenCalled()
    expect(mockFitView).not.toHaveBeenCalled()
    expect(mockSetViewport).not.toHaveBeenCalled()
    expect(localStorage.getItem('workflow-canvas-maximize')).toBeNull()
  })

  it('useWorkflowUpdate should emit initialized data and only set valid viewport', () => {
    const { result } = renderWorkflowHook(() => useWorkflowUpdate())

    act(() => {
      result.current.handleUpdateWorkflowCanvas({
        nodes: [createNode({ id: 'n1' })],
        edges: [],
        viewport: { x: 10, y: 20, zoom: 0.5 },
      } as never)
      result.current.handleUpdateWorkflowCanvas({
        nodes: [],
        edges: [],
        viewport: { x: 'bad' } as never,
      })
    })

    expect(mockInitialNodes).toHaveBeenCalled()
    expect(mockInitialEdges).toHaveBeenCalled()
    expect(mockEventEmit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'WORKFLOW_DATA_UPDATE',
    }))
    expect(mockSetViewport).toHaveBeenCalledTimes(1)
    expect(mockSetViewport).toHaveBeenCalledWith({ x: 10, y: 20, zoom: 0.5 })
  })

  it('useWorkflowCanvasMaximize should toggle store and emit event', () => {
    localStorage.removeItem('workflow-canvas-maximize')
    const { result, store } = renderWorkflowHook(() => useWorkflowCanvasMaximize(), {
      initialStoreState: {
        maximizeCanvas: false,
      },
    })

    act(() => {
      result.current.handleToggleMaximizeCanvas()
    })

    expect(store.getState().maximizeCanvas).toBe(true)
    expect(localStorage.getItem('workflow-canvas-maximize')).toBe('true')
    expect(mockEventEmit).toHaveBeenCalledWith({
      type: 'workflow-canvas-maximize',
      payload: true,
    })
  })
})
