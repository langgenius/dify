import { act, waitFor } from '@testing-library/react'
import { useEdges, useNodes } from 'reactflow'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { useEdgesInteractions } from '../use-edges-interactions'

// useWorkflowHistory uses a debounced save — mock for synchronous assertions
const mockSaveStateToHistory = vi.fn()
vi.mock('../use-workflow-history', () => ({
  useWorkflowHistory: () => ({ saveStateToHistory: mockSaveStateToHistory }),
  WorkflowHistoryEvent: {
    EdgeDelete: 'EdgeDelete',
    EdgeDeleteByDeleteBranch: 'EdgeDeleteByDeleteBranch',
    EdgeSourceHandleChange: 'EdgeSourceHandleChange',
  },
}))

// use-workflow.ts has heavy transitive imports — mock only useNodesReadOnly
let mockReadOnly = false
vi.mock('../use-workflow', () => ({
  useNodesReadOnly: () => ({
    getNodesReadOnly: () => mockReadOnly,
  }),
}))

vi.mock('../../utils', () => ({
  getNodesConnectedSourceOrTargetHandleIdsMap: vi.fn(() => ({})),
}))

type EdgeRuntimeState = {
  _hovering?: boolean
  _isBundled?: boolean
}

type NodeRuntimeState = {
  selected?: boolean
  _isBundled?: boolean
}

const getEdgeRuntimeState = (edge?: { data?: unknown }): EdgeRuntimeState =>
  (edge?.data ?? {}) as EdgeRuntimeState

const getNodeRuntimeState = (node?: { data?: unknown }): NodeRuntimeState =>
  (node?.data ?? {}) as NodeRuntimeState

function createFlowNodes() {
  return [
    createNode({ id: 'n1' }),
    createNode({ id: 'n2', position: { x: 100, y: 0 } }),
  ]
}

function createFlowEdges() {
  return [
    createEdge({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      sourceHandle: 'branch-a',
      data: { _hovering: false },
    }),
    createEdge({
      id: 'e2',
      source: 'n1',
      target: 'n2',
      sourceHandle: 'branch-b',
      data: { _hovering: false },
    }),
  ]
}

function renderEdgesInteractions(options?: {
  nodes?: ReturnType<typeof createFlowNodes>
  edges?: ReturnType<typeof createFlowEdges>
  initialStoreState?: Record<string, unknown>
}) {
  const mockDoSync = vi.fn().mockResolvedValue(undefined)
  const { nodes = createFlowNodes(), edges = createFlowEdges(), initialStoreState } = options ?? {}

  return {
    ...renderWorkflowFlowHook(() => ({
      ...useEdgesInteractions(),
      nodes: useNodes(),
      edges: useEdges(),
    }), {
      nodes,
      edges,
      initialStoreState,
      hooksStoreProps: { doSyncWorkflowDraft: mockDoSync },
      reactFlowProps: { fitView: false },
    }),
    mockDoSync,
  }
}

describe('useEdgesInteractions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadOnly = false
  })

  it('handleEdgeEnter should set _hovering to true', async () => {
    const { result } = renderEdgesInteractions()

    act(() => {
      result.current.handleEdgeEnter({} as never, result.current.edges[0] as never)
    })

    await waitFor(() => {
      expect(getEdgeRuntimeState(result.current.edges.find(edge => edge.id === 'e1'))._hovering).toBe(true)
      expect(getEdgeRuntimeState(result.current.edges.find(edge => edge.id === 'e2'))._hovering).toBe(false)
    })
  })

  it('handleEdgeLeave should set _hovering to false', async () => {
    const { result } = renderEdgesInteractions({
      edges: createFlowEdges().map(edge =>
        edge.id === 'e1'
          ? createEdge({ ...edge, data: { ...edge.data, _hovering: true } })
          : edge,
      ),
    })

    act(() => {
      result.current.handleEdgeLeave({} as never, result.current.edges[0] as never)
    })

    await waitFor(() => {
      expect(getEdgeRuntimeState(result.current.edges.find(edge => edge.id === 'e1'))._hovering).toBe(false)
    })
  })

  it('handleEdgesChange should update edge.selected for select changes', async () => {
    const { result } = renderEdgesInteractions()

    act(() => {
      result.current.handleEdgesChange([
        { type: 'select', id: 'e1', selected: true },
        { type: 'select', id: 'e2', selected: false },
      ])
    })

    await waitFor(() => {
      expect(result.current.edges.find(edge => edge.id === 'e1')?.selected).toBe(true)
      expect(result.current.edges.find(edge => edge.id === 'e2')?.selected).toBe(false)
    })
  })

  it('handleEdgeContextMenu should select the clicked edge and open edgeMenu', async () => {
    const preventDefault = vi.fn()
    const { result, store } = renderEdgesInteractions({
      nodes: [
        createNode({
          id: 'n1',
          data: { selected: true, _isBundled: true },
          selected: true,
        }),
        createNode({
          id: 'n2',
          position: { x: 100, y: 0 },
          data: { _isBundled: true },
        }),
      ],
      edges: [
        createEdge({
          id: 'e1',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'branch-a',
          data: { _hovering: false, _isBundled: true },
        }),
        createEdge({
          id: 'e2',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'branch-b',
          data: { _hovering: false, _isBundled: true },
        }),
      ],
    })

    act(() => {
      result.current.handleEdgeContextMenu({
        preventDefault,
        clientX: 320,
        clientY: 180,
      } as never, result.current.edges[1] as never)
    })

    expect(preventDefault).toHaveBeenCalled()

    await waitFor(() => {
      expect(result.current.edges.find(edge => edge.id === 'e1')?.selected).toBe(false)
      expect(result.current.edges.find(edge => edge.id === 'e2')?.selected).toBe(true)
      expect(result.current.edges.every(edge => !getEdgeRuntimeState(edge)._isBundled)).toBe(true)
      expect(result.current.nodes.every(node => !getNodeRuntimeState(node).selected && !node.selected && !getNodeRuntimeState(node)._isBundled)).toBe(true)
    })

    expect(store.getState().edgeMenu).toEqual({
      clientX: 320,
      clientY: 180,
      edgeId: 'e2',
    })
    expect(store.getState().nodeMenu).toBeUndefined()
    expect(store.getState().panelMenu).toBeUndefined()
    expect(store.getState().selectionMenu).toBeUndefined()
  })

  it('handleEdgeDelete should remove selected edge and trigger sync + history', async () => {
    const { result, store } = renderEdgesInteractions({
      edges: [
        createEdge({
          id: 'e1',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'branch-a',
          selected: true,
          data: { _hovering: false },
        }),
        createEdge({
          id: 'e2',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'branch-b',
          data: { _hovering: false },
        }),
      ],
      initialStoreState: {
        edgeMenu: { clientX: 320, clientY: 180, edgeId: 'e1' },
      },
    })

    act(() => {
      result.current.handleEdgeDelete()
    })

    await waitFor(() => {
      expect(result.current.edges).toHaveLength(1)
      expect(result.current.edges[0]?.id).toBe('e2')
    })

    expect(store.getState().edgeMenu).toBeUndefined()
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('EdgeDelete')
  })

  it('handleEdgeDelete should do nothing when no edge is selected', () => {
    const { result } = renderEdgesInteractions()

    act(() => {
      result.current.handleEdgeDelete()
    })

    expect(result.current.edges).toHaveLength(2)
  })

  it('handleEdgeDeleteById should remove the requested edge even when another edge is selected', async () => {
    const { result, store } = renderEdgesInteractions({
      edges: [
        createEdge({
          id: 'e1',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'branch-a',
          selected: true,
          data: { _hovering: false },
        }),
        createEdge({
          id: 'e2',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'branch-b',
          data: { _hovering: false },
        }),
      ],
      initialStoreState: {
        edgeMenu: { clientX: 320, clientY: 180, edgeId: 'e2' },
      },
    })

    act(() => {
      result.current.handleEdgeDeleteById('e2')
    })

    await waitFor(() => {
      expect(result.current.edges).toHaveLength(1)
      expect(result.current.edges[0]?.id).toBe('e1')
      expect(result.current.edges[0]?.selected).toBe(true)
    })

    expect(store.getState().edgeMenu).toBeUndefined()
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('EdgeDelete')
  })

  it('handleEdgeDeleteById should ignore unknown edge ids', () => {
    const { result } = renderEdgesInteractions()

    act(() => {
      result.current.handleEdgeDeleteById('missing-edge')
    })

    expect(result.current.edges).toHaveLength(2)
    expect(mockSaveStateToHistory).not.toHaveBeenCalled()
  })

  it('handleEdgeDeleteByDeleteBranch should remove edges for the given branch', async () => {
    const { result, store } = renderEdgesInteractions({
      initialStoreState: {
        edgeMenu: { clientX: 320, clientY: 180, edgeId: 'e1' },
      },
    })

    act(() => {
      result.current.handleEdgeDeleteByDeleteBranch('n1', 'branch-a')
    })

    await waitFor(() => {
      expect(result.current.edges).toHaveLength(1)
      expect(result.current.edges[0]?.id).toBe('e2')
    })

    expect(store.getState().edgeMenu).toBeUndefined()
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('EdgeDeleteByDeleteBranch')
  })

  it('handleEdgeSourceHandleChange should update sourceHandle and edge ID', async () => {
    const { result } = renderEdgesInteractions({
      edges: [
        createEdge({
          id: 'n1-old-handle-n2-target',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'old-handle',
          targetHandle: 'target',
          data: {},
        }),
      ],
    })

    act(() => {
      result.current.handleEdgeSourceHandleChange('n1', 'old-handle', 'new-handle')
    })

    await waitFor(() => {
      expect(result.current.edges[0]?.sourceHandle).toBe('new-handle')
      expect(result.current.edges[0]?.id).toBe('n1-new-handle-n2-target')
    })
  })

  it('handleEdgeSourceHandleChange should clear edgeMenu and save history for affected edges', async () => {
    const { result, store } = renderEdgesInteractions({
      edges: [
        createEdge({
          id: 'n1-old-handle-n2-target',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'old-handle',
          targetHandle: 'target',
          data: {},
        }),
      ],
      initialStoreState: {
        edgeMenu: { clientX: 120, clientY: 60, edgeId: 'n1-old-handle-n2-target' },
      },
    })

    act(() => {
      result.current.handleEdgeSourceHandleChange('n1', 'old-handle', 'new-handle')
    })

    await waitFor(() => {
      expect(result.current.edges[0]?.sourceHandle).toBe('new-handle')
    })

    expect(store.getState().edgeMenu).toBeUndefined()
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('EdgeSourceHandleChange')
  })

  it('handleEdgeSourceHandleChange should do nothing when no edges use the old handle', () => {
    const { result } = renderEdgesInteractions()

    act(() => {
      result.current.handleEdgeSourceHandleChange('n1', 'missing-handle', 'new-handle')
    })

    expect(result.current.edges.map(edge => edge.id)).toEqual(['e1', 'e2'])
    expect(mockSaveStateToHistory).not.toHaveBeenCalled()
  })

  describe('read-only mode', () => {
    beforeEach(() => {
      mockReadOnly = true
    })

    it('handleEdgeEnter should do nothing', () => {
      const { result } = renderEdgesInteractions()

      act(() => {
        result.current.handleEdgeEnter({} as never, result.current.edges[0] as never)
      })

      expect(getEdgeRuntimeState(result.current.edges[0])._hovering).toBe(false)
    })

    it('handleEdgeDelete should do nothing', () => {
      const { result } = renderEdgesInteractions({
        edges: [
          createEdge({
            id: 'e1',
            source: 'n1',
            target: 'n2',
            sourceHandle: 'branch-a',
            selected: true,
            data: { _hovering: false },
          }),
          createEdge({
            id: 'e2',
            source: 'n1',
            target: 'n2',
            sourceHandle: 'branch-b',
            data: { _hovering: false },
          }),
        ],
      })

      act(() => {
        result.current.handleEdgeDelete()
      })

      expect(result.current.edges).toHaveLength(2)
    })

    it('handleEdgeDeleteById should do nothing', () => {
      const { result } = renderEdgesInteractions()

      act(() => {
        result.current.handleEdgeDeleteById('e1')
      })

      expect(result.current.edges).toHaveLength(2)
    })

    it('handleEdgeContextMenu should do nothing', () => {
      const { result, store } = renderEdgesInteractions()

      act(() => {
        result.current.handleEdgeContextMenu({
          preventDefault: vi.fn(),
          clientX: 200,
          clientY: 120,
        } as never, result.current.edges[0] as never)
      })

      expect(result.current.edges.every(edge => !edge.selected)).toBe(true)
      expect(store.getState().edgeMenu).toBeUndefined()
    })

    it('handleEdgeDeleteByDeleteBranch should do nothing', () => {
      const { result } = renderEdgesInteractions()

      act(() => {
        result.current.handleEdgeDeleteByDeleteBranch('n1', 'branch-a')
      })

      expect(result.current.edges).toHaveLength(2)
    })

    it('handleEdgeSourceHandleChange should do nothing', () => {
      const { result } = renderEdgesInteractions({
        edges: [
          createEdge({
            id: 'n1-old-handle-n2-target',
            source: 'n1',
            target: 'n2',
            sourceHandle: 'old-handle',
            targetHandle: 'target',
            data: {},
          }),
        ],
      })

      act(() => {
        result.current.handleEdgeSourceHandleChange('n1', 'old-handle', 'new-handle')
      })

      expect(result.current.edges[0]?.sourceHandle).toBe('old-handle')
      expect(mockSaveStateToHistory).not.toHaveBeenCalled()
    })
  })
})
