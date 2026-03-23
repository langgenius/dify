import { act, renderHook } from '@testing-library/react'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { baseRunningData, renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '../../types'
import {
  useIsChatMode,
  useIsNodeInIteration,
  useIsNodeInLoop,
  useNodesReadOnly,
  useWorkflowReadOnly,
} from '../use-workflow'

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

let mockAppMode = 'workflow'
vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: { mode: string } }) => unknown) => selector({ appDetail: { mode: mockAppMode } }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  resetReactFlowMockState()
  mockAppMode = 'workflow'
})

// ---------------------------------------------------------------------------
// useIsChatMode
// ---------------------------------------------------------------------------

describe('useIsChatMode', () => {
  it('should return true when app mode is advanced-chat', () => {
    mockAppMode = 'advanced-chat'
    const { result } = renderHook(() => useIsChatMode())
    expect(result.current).toBe(true)
  })

  it('should return false when app mode is workflow', () => {
    mockAppMode = 'workflow'
    const { result } = renderHook(() => useIsChatMode())
    expect(result.current).toBe(false)
  })

  it('should return false when app mode is chat', () => {
    mockAppMode = 'chat'
    const { result } = renderHook(() => useIsChatMode())
    expect(result.current).toBe(false)
  })

  it('should return false when app mode is completion', () => {
    mockAppMode = 'completion'
    const { result } = renderHook(() => useIsChatMode())
    expect(result.current).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// useWorkflowReadOnly
// ---------------------------------------------------------------------------

describe('useWorkflowReadOnly', () => {
  it('should return workflowReadOnly true when status is Running', () => {
    const { result } = renderWorkflowHook(() => useWorkflowReadOnly(), {
      initialStoreState: {
        workflowRunningData: baseRunningData(),
      },
    })
    expect(result.current.workflowReadOnly).toBe(true)
  })

  it('should return workflowReadOnly false when status is Succeeded', () => {
    const { result } = renderWorkflowHook(() => useWorkflowReadOnly(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ result: { status: WorkflowRunningStatus.Succeeded } }),
      },
    })
    expect(result.current.workflowReadOnly).toBe(false)
  })

  it('should return workflowReadOnly false when no running data', () => {
    const { result } = renderWorkflowHook(() => useWorkflowReadOnly())
    expect(result.current.workflowReadOnly).toBe(false)
  })

  it('should expose getWorkflowReadOnly that reads from store state', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowReadOnly())

    expect(result.current.getWorkflowReadOnly()).toBe(false)

    act(() => {
      store.setState({
        workflowRunningData: baseRunningData({ task_id: 'task-2' }),
      })
    })

    expect(result.current.getWorkflowReadOnly()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// useNodesReadOnly
// ---------------------------------------------------------------------------

describe('useNodesReadOnly', () => {
  it('should return true when status is Running', () => {
    const { result } = renderWorkflowHook(() => useNodesReadOnly(), {
      initialStoreState: {
        workflowRunningData: baseRunningData(),
      },
    })
    expect(result.current.nodesReadOnly).toBe(true)
  })

  it('should return true when status is Paused', () => {
    const { result } = renderWorkflowHook(() => useNodesReadOnly(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ result: { status: WorkflowRunningStatus.Paused } }),
      },
    })
    expect(result.current.nodesReadOnly).toBe(true)
  })

  it('should return true when historyWorkflowData is present', () => {
    const { result } = renderWorkflowHook(() => useNodesReadOnly(), {
      initialStoreState: {
        historyWorkflowData: { id: 'run-1', status: 'succeeded' },
      },
    })
    expect(result.current.nodesReadOnly).toBe(true)
  })

  it('should return true when isRestoring is true', () => {
    const { result } = renderWorkflowHook(() => useNodesReadOnly(), {
      initialStoreState: { isRestoring: true },
    })
    expect(result.current.nodesReadOnly).toBe(true)
  })

  it('should return false when none of the conditions are met', () => {
    const { result } = renderWorkflowHook(() => useNodesReadOnly())
    expect(result.current.nodesReadOnly).toBe(false)
  })

  it('should expose getNodesReadOnly that reads from store state', () => {
    const { result, store } = renderWorkflowHook(() => useNodesReadOnly())

    expect(result.current.getNodesReadOnly()).toBe(false)

    act(() => {
      store.setState({ isRestoring: true })
    })
    expect(result.current.getNodesReadOnly()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// useIsNodeInIteration
// ---------------------------------------------------------------------------

describe('useIsNodeInIteration', () => {
  beforeEach(() => {
    rfState.nodes = [
      { id: 'iter-1', position: { x: 0, y: 0 }, data: { type: 'iteration' } },
      { id: 'child-1', position: { x: 10, y: 0 }, parentId: 'iter-1', data: {} },
      { id: 'grandchild-1', position: { x: 20, y: 0 }, parentId: 'child-1', data: {} },
      { id: 'outside-1', position: { x: 100, y: 0 }, data: {} },
    ]
  })

  it('should return true when node is a direct child of the iteration', () => {
    const { result } = renderHook(() => useIsNodeInIteration('iter-1'))
    expect(result.current.isNodeInIteration('child-1')).toBe(true)
  })

  it('should return false for a grandchild (only checks direct parentId)', () => {
    const { result } = renderHook(() => useIsNodeInIteration('iter-1'))
    expect(result.current.isNodeInIteration('grandchild-1')).toBe(false)
  })

  it('should return false when node is outside the iteration', () => {
    const { result } = renderHook(() => useIsNodeInIteration('iter-1'))
    expect(result.current.isNodeInIteration('outside-1')).toBe(false)
  })

  it('should return false when node does not exist', () => {
    const { result } = renderHook(() => useIsNodeInIteration('iter-1'))
    expect(result.current.isNodeInIteration('nonexistent')).toBe(false)
  })

  it('should return false when iteration id has no children', () => {
    const { result } = renderHook(() => useIsNodeInIteration('no-such-iter'))
    expect(result.current.isNodeInIteration('child-1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// useIsNodeInLoop
// ---------------------------------------------------------------------------

describe('useIsNodeInLoop', () => {
  beforeEach(() => {
    rfState.nodes = [
      { id: 'loop-1', position: { x: 0, y: 0 }, data: { type: 'loop' } },
      { id: 'child-1', position: { x: 10, y: 0 }, parentId: 'loop-1', data: {} },
      { id: 'grandchild-1', position: { x: 20, y: 0 }, parentId: 'child-1', data: {} },
      { id: 'outside-1', position: { x: 100, y: 0 }, data: {} },
    ]
  })

  it('should return true when node is a direct child of the loop', () => {
    const { result } = renderHook(() => useIsNodeInLoop('loop-1'))
    expect(result.current.isNodeInLoop('child-1')).toBe(true)
  })

  it('should return false for a grandchild (only checks direct parentId)', () => {
    const { result } = renderHook(() => useIsNodeInLoop('loop-1'))
    expect(result.current.isNodeInLoop('grandchild-1')).toBe(false)
  })

  it('should return false when node is outside the loop', () => {
    const { result } = renderHook(() => useIsNodeInLoop('loop-1'))
    expect(result.current.isNodeInLoop('outside-1')).toBe(false)
  })

  it('should return false when node does not exist', () => {
    const { result } = renderHook(() => useIsNodeInLoop('loop-1'))
    expect(result.current.isNodeInLoop('nonexistent')).toBe(false)
  })

  it('should return false when loop id has no children', () => {
    const { result } = renderHook(() => useIsNodeInLoop('no-such-loop'))
    expect(result.current.isNodeInLoop('child-1')).toBe(false)
  })
})
