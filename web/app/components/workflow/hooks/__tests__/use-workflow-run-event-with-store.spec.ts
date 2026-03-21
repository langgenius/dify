import type { WorkflowRunningData } from '../../types'
import type {
  IterationFinishedResponse,
  IterationNextResponse,
  LoopFinishedResponse,
  LoopNextResponse,
  NodeFinishedResponse,
  WorkflowStartedResponse,
} from '@/types/workflow'
import { act, waitFor } from '@testing-library/react'
import { useEdges, useNodes } from 'reactflow'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { baseRunningData, renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { DEFAULT_ITER_TIMES } from '../../constants'
import { NodeRunningStatus, WorkflowRunningStatus } from '../../types'
import { useWorkflowNodeFinished } from '../use-workflow-run-event/use-workflow-node-finished'
import { useWorkflowNodeIterationFinished } from '../use-workflow-run-event/use-workflow-node-iteration-finished'
import { useWorkflowNodeIterationNext } from '../use-workflow-run-event/use-workflow-node-iteration-next'
import { useWorkflowNodeLoopFinished } from '../use-workflow-run-event/use-workflow-node-loop-finished'
import { useWorkflowNodeLoopNext } from '../use-workflow-run-event/use-workflow-node-loop-next'
import { useWorkflowNodeRetry } from '../use-workflow-run-event/use-workflow-node-retry'
import { useWorkflowStarted } from '../use-workflow-run-event/use-workflow-started'

type NodeRuntimeState = {
  _waitingRun?: boolean
  _runningStatus?: NodeRunningStatus
  _retryIndex?: number
  _iterationIndex?: number
  _loopIndex?: number
  _runningBranchId?: string
}

type EdgeRuntimeState = {
  _sourceRunningStatus?: NodeRunningStatus
  _targetRunningStatus?: NodeRunningStatus
  _waitingRun?: boolean
}

const getNodeRuntimeState = (node?: { data?: unknown }): NodeRuntimeState =>
  (node?.data ?? {}) as NodeRuntimeState

const getEdgeRuntimeState = (edge?: { data?: unknown }): EdgeRuntimeState =>
  (edge?.data ?? {}) as EdgeRuntimeState

function createRunNodes() {
  return [
    createNode({
      id: 'n1',
      width: 200,
      height: 80,
      data: { _waitingRun: false },
    }),
  ]
}

function createRunEdges() {
  return [
    createEdge({
      id: 'e1',
      source: 'n0',
      target: 'n1',
      data: {},
    }),
  ]
}

function renderRunEventHook<T extends Record<string, unknown>>(
  useHook: () => T,
  options?: {
    nodes?: ReturnType<typeof createRunNodes>
    edges?: ReturnType<typeof createRunEdges>
    initialStoreState?: Record<string, unknown>
  },
) {
  const { nodes = createRunNodes(), edges = createRunEdges(), initialStoreState } = options ?? {}

  return renderWorkflowFlowHook(() => ({
    ...useHook(),
    nodes: useNodes(),
    edges: useEdges(),
  }), {
    nodes,
    edges,
    reactFlowProps: { fitView: false },
    initialStoreState,
  })
}

describe('useWorkflowStarted', () => {
  it('should initialize workflow running data and reset nodes/edges', async () => {
    const { result, store } = renderRunEventHook(() => useWorkflowStarted(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    act(() => {
      result.current.handleWorkflowStarted({
        task_id: 'task-2',
        data: { id: 'run-1', workflow_id: 'wf-1', created_at: 1000 },
      } as WorkflowStartedResponse)
    })

    const state = store.getState().workflowRunningData!
    expect(state.task_id).toBe('task-2')
    expect(state.result.status).toBe(WorkflowRunningStatus.Running)
    expect(state.resultText).toBe('')

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._waitingRun).toBe(true)
      expect(getNodeRuntimeState(result.current.nodes[0])._runningBranchId).toBeUndefined()
      expect(getEdgeRuntimeState(result.current.edges[0])._sourceRunningStatus).toBeUndefined()
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBeUndefined()
      expect(getEdgeRuntimeState(result.current.edges[0])._waitingRun).toBe(true)
    })
  })

  it('should resume from Paused without resetting nodes/edges', () => {
    const { result, store } = renderRunEventHook(() => useWorkflowStarted(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: { status: WorkflowRunningStatus.Paused } as WorkflowRunningData['result'],
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowStarted({
        task_id: 'task-2',
        data: { id: 'run-2', workflow_id: 'wf-1', created_at: 2000 },
      } as WorkflowStartedResponse)
    })

    expect(store.getState().workflowRunningData!.result.status).toBe(WorkflowRunningStatus.Running)
    expect(getNodeRuntimeState(result.current.nodes[0])._waitingRun).toBe(false)
    expect(getEdgeRuntimeState(result.current.edges[0])._waitingRun).toBeUndefined()
  })
})

describe('useWorkflowNodeFinished', () => {
  it('should update tracing and node running status', async () => {
    const { result, store } = renderRunEventHook(() => useWorkflowNodeFinished(), {
      nodes: [
        createNode({
          id: 'n1',
          data: { _runningStatus: NodeRunningStatus.Running },
        }),
      ],
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ id: 'trace-1', node_id: 'n1', status: NodeRunningStatus.Running }],
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowNodeFinished({
        data: { id: 'trace-1', node_id: 'n1', status: NodeRunningStatus.Succeeded },
      } as NodeFinishedResponse)
    })

    const trace = store.getState().workflowRunningData!.tracing![0]
    expect(trace.status).toBe(NodeRunningStatus.Succeeded)

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._runningStatus).toBe(NodeRunningStatus.Succeeded)
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBe(NodeRunningStatus.Succeeded)
    })
  })

  it('should set _runningBranchId for IfElse node', async () => {
    const { result } = renderRunEventHook(() => useWorkflowNodeFinished(), {
      nodes: [
        createNode({
          id: 'n1',
          data: { _runningStatus: NodeRunningStatus.Running },
        }),
      ],
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ id: 'trace-1', node_id: 'n1', status: NodeRunningStatus.Running }],
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowNodeFinished({
        data: {
          id: 'trace-1',
          node_id: 'n1',
          node_type: 'if-else',
          status: NodeRunningStatus.Succeeded,
          outputs: { selected_case_id: 'branch-a' },
        },
      } as unknown as NodeFinishedResponse)
    })

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._runningBranchId).toBe('branch-a')
    })
  })
})

describe('useWorkflowNodeRetry', () => {
  it('should push retry data to tracing and update _retryIndex', async () => {
    const { result, store } = renderRunEventHook(() => useWorkflowNodeRetry(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    act(() => {
      result.current.handleWorkflowNodeRetry({
        data: { node_id: 'n1', retry_index: 2 },
      } as NodeFinishedResponse)
    })

    expect(store.getState().workflowRunningData!.tracing).toHaveLength(1)

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._retryIndex).toBe(2)
    })
  })
})

describe('useWorkflowNodeIterationNext', () => {
  it('should set _iterationIndex and increment iterTimes', async () => {
    const { result, store } = renderRunEventHook(() => useWorkflowNodeIterationNext(), {
      initialStoreState: {
        workflowRunningData: baseRunningData(),
        iterTimes: 3,
      },
    })

    act(() => {
      result.current.handleWorkflowNodeIterationNext({
        data: { node_id: 'n1' },
      } as IterationNextResponse)
    })

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._iterationIndex).toBe(3)
    })
    expect(store.getState().iterTimes).toBe(4)
  })
})

describe('useWorkflowNodeIterationFinished', () => {
  it('should update tracing, reset iterTimes, update node status and edges', async () => {
    const { result, store } = renderRunEventHook(() => useWorkflowNodeIterationFinished(), {
      nodes: [
        createNode({
          id: 'n1',
          data: { _runningStatus: NodeRunningStatus.Running },
        }),
      ],
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ id: 'iter-1', node_id: 'n1', status: NodeRunningStatus.Running }],
        }),
        iterTimes: 10,
      },
    })

    act(() => {
      result.current.handleWorkflowNodeIterationFinished({
        data: { id: 'iter-1', node_id: 'n1', status: NodeRunningStatus.Succeeded },
      } as IterationFinishedResponse)
    })

    expect(store.getState().iterTimes).toBe(DEFAULT_ITER_TIMES)

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._runningStatus).toBe(NodeRunningStatus.Succeeded)
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBe(NodeRunningStatus.Succeeded)
    })
  })
})

describe('useWorkflowNodeLoopNext', () => {
  it('should set _loopIndex and reset child nodes to waiting', async () => {
    const { result } = renderRunEventHook(() => useWorkflowNodeLoopNext(), {
      nodes: [
        createNode({ id: 'n1', data: {} }),
        createNode({
          id: 'n2',
          position: { x: 300, y: 0 },
          parentId: 'n1',
          data: { _waitingRun: false },
        }),
      ],
      edges: [],
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    act(() => {
      result.current.handleWorkflowNodeLoopNext({
        data: { node_id: 'n1', index: 5 },
      } as LoopNextResponse)
    })

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes.find(node => node.id === 'n1'))._loopIndex).toBe(5)
      expect(getNodeRuntimeState(result.current.nodes.find(node => node.id === 'n2'))._waitingRun).toBe(true)
      expect(getNodeRuntimeState(result.current.nodes.find(node => node.id === 'n2'))._runningStatus).toBe(NodeRunningStatus.Waiting)
    })
  })
})

describe('useWorkflowNodeLoopFinished', () => {
  it('should update tracing, node status and edges', async () => {
    const { result, store } = renderRunEventHook(() => useWorkflowNodeLoopFinished(), {
      nodes: [
        createNode({
          id: 'n1',
          data: { _runningStatus: NodeRunningStatus.Running },
        }),
      ],
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ id: 'loop-1', node_id: 'n1', status: NodeRunningStatus.Running }],
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowNodeLoopFinished({
        data: { id: 'loop-1', node_id: 'n1', status: NodeRunningStatus.Succeeded },
      } as LoopFinishedResponse)
    })

    const trace = store.getState().workflowRunningData!.tracing![0]
    expect(trace.status).toBe(NodeRunningStatus.Succeeded)

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._runningStatus).toBe(NodeRunningStatus.Succeeded)
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBe(NodeRunningStatus.Succeeded)
    })
  })
})
