import type { WorkflowRunningData } from '../../types'
import type {
  IterationFinishedResponse,
  IterationNextResponse,
  LoopFinishedResponse,
  LoopNextResponse,
  NodeFinishedResponse,
  WorkflowStartedResponse,
} from '@/types/workflow'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { baseRunningData, renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { DEFAULT_ITER_TIMES } from '../../constants'
import { NodeRunningStatus, WorkflowRunningStatus } from '../../types'
import { useWorkflowNodeFinished } from '../use-workflow-run-event/use-workflow-node-finished'
import { useWorkflowNodeIterationFinished } from '../use-workflow-run-event/use-workflow-node-iteration-finished'
import { useWorkflowNodeIterationNext } from '../use-workflow-run-event/use-workflow-node-iteration-next'
import { useWorkflowNodeLoopFinished } from '../use-workflow-run-event/use-workflow-node-loop-finished'
import { useWorkflowNodeLoopNext } from '../use-workflow-run-event/use-workflow-node-loop-next'
import { useWorkflowNodeRetry } from '../use-workflow-run-event/use-workflow-node-retry'
import { useWorkflowStarted } from '../use-workflow-run-event/use-workflow-started'

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

describe('useWorkflowStarted', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, width: 200, height: 80, data: { _waitingRun: false } },
    ]
    rfState.edges = [
      { id: 'e1', source: 'n0', target: 'n1', data: {} },
    ]
  })

  it('should initialize workflow running data and reset nodes/edges', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowStarted(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowStarted({
      task_id: 'task-2',
      data: { id: 'run-1', workflow_id: 'wf-1', created_at: 1000 },
    } as WorkflowStartedResponse)

    const state = store.getState().workflowRunningData!
    expect(state.task_id).toBe('task-2')
    expect(state.result.status).toBe(WorkflowRunningStatus.Running)
    expect(state.resultText).toBe('')

    expect(rfState.setNodes).toHaveBeenCalledOnce()
    const updatedNodes = rfState.setNodes.mock.calls[0][0]
    expect(updatedNodes[0].data._waitingRun).toBe(true)

    expect(rfState.setEdges).toHaveBeenCalledOnce()
  })

  it('should resume from Paused without resetting nodes/edges', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowStarted(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: { status: WorkflowRunningStatus.Paused } as WorkflowRunningData['result'],
        }),
      },
    })

    result.current.handleWorkflowStarted({
      task_id: 'task-2',
      data: { id: 'run-2', workflow_id: 'wf-1', created_at: 2000 },
    } as WorkflowStartedResponse)

    expect(store.getState().workflowRunningData!.result.status).toBe(WorkflowRunningStatus.Running)
    expect(rfState.setNodes).not.toHaveBeenCalled()
    expect(rfState.setEdges).not.toHaveBeenCalled()
  })
})

describe('useWorkflowNodeFinished', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: { _runningStatus: NodeRunningStatus.Running } },
    ]
    rfState.edges = [
      { id: 'e1', source: 'n0', target: 'n1', data: {} },
    ]
  })

  it('should update tracing and node running status', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeFinished(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ id: 'trace-1', node_id: 'n1', status: NodeRunningStatus.Running }],
        }),
      },
    })

    result.current.handleWorkflowNodeFinished({
      data: { id: 'trace-1', node_id: 'n1', status: NodeRunningStatus.Succeeded },
    } as NodeFinishedResponse)

    const trace = store.getState().workflowRunningData!.tracing![0]
    expect(trace.status).toBe(NodeRunningStatus.Succeeded)

    const updatedNodes = rfState.setNodes.mock.calls[0][0]
    expect(updatedNodes[0].data._runningStatus).toBe(NodeRunningStatus.Succeeded)
    expect(rfState.setEdges).toHaveBeenCalledOnce()
  })

  it('should set _runningBranchId for IfElse node', () => {
    const { result } = renderWorkflowHook(() => useWorkflowNodeFinished(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ id: 'trace-1', node_id: 'n1', status: NodeRunningStatus.Running }],
        }),
      },
    })

    result.current.handleWorkflowNodeFinished({
      data: {
        id: 'trace-1',
        node_id: 'n1',
        node_type: 'if-else',
        status: NodeRunningStatus.Succeeded,
        outputs: { selected_case_id: 'branch-a' },
      },
    } as unknown as NodeFinishedResponse)

    const updatedNodes = rfState.setNodes.mock.calls[0][0]
    expect(updatedNodes[0].data._runningBranchId).toBe('branch-a')
  })
})

describe('useWorkflowNodeRetry', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: {} },
    ]
  })

  it('should push retry data to tracing and update _retryIndex', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeRetry(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowNodeRetry({
      data: { node_id: 'n1', retry_index: 2 },
    } as NodeFinishedResponse)

    expect(store.getState().workflowRunningData!.tracing).toHaveLength(1)
    const updatedNodes = rfState.setNodes.mock.calls[0][0]
    expect(updatedNodes[0].data._retryIndex).toBe(2)
  })
})

describe('useWorkflowNodeIterationNext', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: {} },
    ]
  })

  it('should set _iterationIndex and increment iterTimes', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeIterationNext(), {
      initialStoreState: {
        workflowRunningData: baseRunningData(),
        iterTimes: 3,
      },
    })

    result.current.handleWorkflowNodeIterationNext({
      data: { node_id: 'n1' },
    } as IterationNextResponse)

    const updatedNodes = rfState.setNodes.mock.calls[0][0]
    expect(updatedNodes[0].data._iterationIndex).toBe(3)
    expect(store.getState().iterTimes).toBe(4)
  })
})

describe('useWorkflowNodeIterationFinished', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: { _runningStatus: NodeRunningStatus.Running } },
    ]
    rfState.edges = [
      { id: 'e1', source: 'n0', target: 'n1', data: {} },
    ]
  })

  it('should update tracing, reset iterTimes, update node status and edges', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeIterationFinished(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ id: 'iter-1', node_id: 'n1', status: NodeRunningStatus.Running }],
        }),
        iterTimes: 10,
      },
    })

    result.current.handleWorkflowNodeIterationFinished({
      data: { id: 'iter-1', node_id: 'n1', status: NodeRunningStatus.Succeeded },
    } as IterationFinishedResponse)

    expect(store.getState().iterTimes).toBe(DEFAULT_ITER_TIMES)

    const updatedNodes = rfState.setNodes.mock.calls[0][0]
    expect(updatedNodes[0].data._runningStatus).toBe(NodeRunningStatus.Succeeded)
    expect(rfState.setEdges).toHaveBeenCalledOnce()
  })
})

describe('useWorkflowNodeLoopNext', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: {} },
      { id: 'n2', position: { x: 300, y: 0 }, parentId: 'n1', data: { _waitingRun: false } },
    ]
  })

  it('should set _loopIndex and reset child nodes to waiting', () => {
    const { result } = renderWorkflowHook(() => useWorkflowNodeLoopNext(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowNodeLoopNext({
      data: { node_id: 'n1', index: 5 },
    } as LoopNextResponse)

    const updatedNodes = rfState.setNodes.mock.calls[0][0]
    expect(updatedNodes[0].data._loopIndex).toBe(5)
    expect(updatedNodes[1].data._waitingRun).toBe(true)
    expect(updatedNodes[1].data._runningStatus).toBe(NodeRunningStatus.Waiting)
  })
})

describe('useWorkflowNodeLoopFinished', () => {
  beforeEach(() => {
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: { _runningStatus: NodeRunningStatus.Running } },
    ]
    rfState.edges = [
      { id: 'e1', source: 'n0', target: 'n1', data: {} },
    ]
  })

  it('should update tracing, node status and edges', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeLoopFinished(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ id: 'loop-1', node_id: 'n1', status: NodeRunningStatus.Running }],
        }),
      },
    })

    result.current.handleWorkflowNodeLoopFinished({
      data: { id: 'loop-1', node_id: 'n1', status: NodeRunningStatus.Succeeded },
    } as LoopFinishedResponse)

    const trace = store.getState().workflowRunningData!.tracing![0]
    expect(trace.status).toBe(NodeRunningStatus.Succeeded)
    expect(rfState.setEdges).toHaveBeenCalledOnce()
  })
})
