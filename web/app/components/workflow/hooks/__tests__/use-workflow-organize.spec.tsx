import { act } from '@testing-library/react'
import { useStoreApi } from 'reactflow'
import { createLoopNode, createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { useWorkflowOrganize } from '../use-workflow-organize'

const mockSetViewport = vi.hoisted(() => vi.fn())
const mockHandleSyncWorkflowDraft = vi.hoisted(() => vi.fn())
const mockSaveStateToHistory = vi.hoisted(() => vi.fn())
const mockGetLayoutForChildNodes = vi.hoisted(() => vi.fn())
const mockGetLayoutByELK = vi.hoisted(() => vi.fn())

const runtimeState = vi.hoisted(() => ({
  nodes: [] as ReturnType<typeof createNode>[],
  edges: [] as { id: string; source: string; target: string }[],
  nodesReadOnly: false,
}))

vi.mock('reactflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('reactflow')>()
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow(), setViewport: mockSetViewport }),
  }
})

vi.mock('../use-workflow', () => ({
  useNodesReadOnly: () => ({
    getNodesReadOnly: () => runtimeState.nodesReadOnly,
    nodesReadOnly: runtimeState.nodesReadOnly,
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

vi.mock('../../utils/elk-layout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/elk-layout')>()),
  getLayoutForChildNodes: (...args: unknown[]) => mockGetLayoutForChildNodes(...args),
  getLayoutByELK: (...args: unknown[]) => mockGetLayoutByELK(...args),
}))

describe('useWorkflowOrganize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    runtimeState.nodesReadOnly = false
    runtimeState.nodes = []
    runtimeState.edges = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resizes containers, lays out nodes, and syncs draft when editable', async () => {
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
      nodes: new Map([['loop-child', { x: 40, y: 60, width: 100, height: 60 }]]),
    })
    mockGetLayoutByELK.mockResolvedValue({
      nodes: new Map([
        ['loop-node', { x: 10, y: 20, width: 360, height: 260, layer: 0 }],
        ['top-node', { x: 500, y: 30, width: 240, height: 100, layer: 0 }],
      ]),
    })

    const { result } = renderWorkflowFlowHook(
      () => ({ ...useWorkflowOrganize(), graph: useStoreApi() }),
      { nodes: runtimeState.nodes },
    )

    await act(async () => {
      await result.current.handleLayout()
    })
    act(() => {
      vi.runAllTimers()
    })

    const nextNodes = result.current.graph.getState().getNodes()
    expect(nextNodes.find((node: { id: string }) => node.id === 'loop-node')).toEqual(
      expect.objectContaining({
        width: 440,
        height: 340,
        position: { x: 10, y: 20 },
      }),
    )
    expect(nextNodes.find((node: { id: string }) => node.id === 'loop-child')).toEqual(
      expect.objectContaining({
        position: { x: 100, y: 120 },
      }),
    )
    expect(mockSetViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 0.7 })
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('LayoutOrganize')
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalled()
  })

  it('skips layout when nodes are read-only', async () => {
    runtimeState.nodesReadOnly = true
    runtimeState.nodes = [createNode({ id: 'n1' })]

    const { result } = renderWorkflowFlowHook(
      () => ({ ...useWorkflowOrganize(), graph: useStoreApi() }),
      { nodes: runtimeState.nodes },
    )

    await act(async () => {
      await result.current.handleLayout()
    })

    expect(mockGetLayoutForChildNodes).not.toHaveBeenCalled()
    expect(mockGetLayoutByELK).not.toHaveBeenCalled()
    expect(result.current.graph.getState().getNodes()).toMatchObject(runtimeState.nodes)
    expect(mockSaveStateToHistory).not.toHaveBeenCalled()
    expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockSetViewport).not.toHaveBeenCalled()
  })
})
