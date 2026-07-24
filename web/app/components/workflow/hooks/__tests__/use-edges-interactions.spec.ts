import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useEdgesInteractions } from '../use-edges-interactions'

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

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

// useNodesSyncDraft is used REAL — via renderWorkflowHook + hooksStoreProps
function renderEdgesInteractions() {
  const mockDoSync = vi.fn().mockResolvedValue(undefined)
  return {
    ...renderWorkflowHook(() => useEdgesInteractions(), {
      hooksStoreProps: { doSyncWorkflowDraft: mockDoSync },
    }),
    mockDoSync,
  }
}

describe('useEdgesInteractions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    mockReadOnly = false
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: {} },
      { id: 'n2', position: { x: 100, y: 0 }, data: {} },
    ]
    rfState.edges = [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'branch-a', data: { _hovering: false } },
      { id: 'e2', source: 'n1', target: 'n2', sourceHandle: 'branch-b', data: { _hovering: false } },
    ]
  })

  it('handleEdgeEnter should set _hovering to true', () => {
    const { result } = renderEdgesInteractions()
    result.current.handleEdgeEnter({} as never, rfState.edges[0] as never)

    const updated = rfState.setEdges.mock.calls[0][0]
    expect(updated.find((e: { id: string }) => e.id === 'e1').data._hovering).toBe(true)
    expect(updated.find((e: { id: string }) => e.id === 'e2').data._hovering).toBe(false)
  })

  it('handleEdgeLeave should set _hovering to false', () => {
    rfState.edges[0].data._hovering = true
    const { result } = renderEdgesInteractions()
    result.current.handleEdgeLeave({} as never, rfState.edges[0] as never)

    expect(rfState.setEdges.mock.calls[0][0].find((e: { id: string }) => e.id === 'e1').data._hovering).toBe(false)
  })

  it('handleEdgesChange should update edge.selected for select changes', () => {
    const { result } = renderEdgesInteractions()
    result.current.handleEdgesChange([
      { type: 'select', id: 'e1', selected: true },
      { type: 'select', id: 'e2', selected: false },
    ])

    const updated = rfState.setEdges.mock.calls[0][0]
    expect(updated.find((e: { id: string }) => e.id === 'e1').selected).toBe(true)
    expect(updated.find((e: { id: string }) => e.id === 'e2').selected).toBe(false)
  })

  it('handleEdgeDelete should remove selected edge and trigger sync + history', () => {
    ;(rfState.edges[0] as Record<string, unknown>).selected = true
    const { result } = renderEdgesInteractions()

    result.current.handleEdgeDelete()

    const updated = rfState.setEdges.mock.calls[0][0]
    expect(updated).toHaveLength(1)
    expect(updated[0].id).toBe('e2')
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('EdgeDelete')
  })

  it('handleEdgeDelete should do nothing when no edge is selected', () => {
    const { result } = renderEdgesInteractions()
    result.current.handleEdgeDelete()
    expect(rfState.setEdges).not.toHaveBeenCalled()
  })

  it('handleEdgeDeleteByDeleteBranch should remove edges for the given branch', () => {
    const { result } = renderEdgesInteractions()
    result.current.handleEdgeDeleteByDeleteBranch('n1', 'branch-a')

    const updated = rfState.setEdges.mock.calls[0][0]
    expect(updated).toHaveLength(1)
    expect(updated[0].id).toBe('e2')
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('EdgeDeleteByDeleteBranch')
  })

  it('handleEdgeSourceHandleChange should update sourceHandle and edge ID', () => {
    rfState.edges = [
      { id: 'n1-old-handle-n2-target', source: 'n1', target: 'n2', sourceHandle: 'old-handle', targetHandle: 'target', data: {} } as typeof rfState.edges[0],
    ]

    const { result } = renderEdgesInteractions()
    result.current.handleEdgeSourceHandleChange('n1', 'old-handle', 'new-handle')

    const updated = rfState.setEdges.mock.calls[0][0]
    expect(updated[0].sourceHandle).toBe('new-handle')
    expect(updated[0].id).toBe('n1-new-handle-n2-target')
  })

  describe('read-only mode', () => {
    beforeEach(() => {
      mockReadOnly = true
    })

    it('handleEdgeEnter should do nothing', () => {
      const { result } = renderEdgesInteractions()
      result.current.handleEdgeEnter({} as never, rfState.edges[0] as never)
      expect(rfState.setEdges).not.toHaveBeenCalled()
    })

    it('handleEdgeDelete should do nothing', () => {
      ;(rfState.edges[0] as Record<string, unknown>).selected = true
      const { result } = renderEdgesInteractions()
      result.current.handleEdgeDelete()
      expect(rfState.setEdges).not.toHaveBeenCalled()
    })

    it('handleEdgeDeleteByDeleteBranch should do nothing', () => {
      const { result } = renderEdgesInteractions()
      result.current.handleEdgeDeleteByDeleteBranch('n1', 'branch-a')
      expect(rfState.setEdges).not.toHaveBeenCalled()
    })
  })
})
