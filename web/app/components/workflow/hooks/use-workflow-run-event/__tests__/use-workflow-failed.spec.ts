import { act, waitFor } from '@testing-library/react'
import { createEdge, createNode, createNodeTracing } from '../../../__tests__/fixtures'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { NodeRunningStatus, WorkflowRunningStatus } from '../../../types'
import { useWorkflowFailed } from '../use-workflow-failed'
import { getEdgeRuntimeState, getNodeRuntimeState, renderRunEventHook } from './test-helpers'

describe('useWorkflowFailed', () => {
  it('settles active workflow and canvas state as failed', async () => {
    const { result, store } = renderRunEventHook(() => useWorkflowFailed(), {
      nodes: [
        createNode({
          id: 'running-node',
          data: {
            _runningStatus: NodeRunningStatus.Running,
            _waitingRun: false,
          },
        }),
        createNode({
          id: 'succeeded-node',
          data: {
            _runningStatus: NodeRunningStatus.Succeeded,
            _waitingRun: false,
          },
        }),
        createNode({
          id: 'waiting-node',
          data: { _waitingRun: true },
        }),
      ],
      edges: [
        createEdge({
          id: 'running-edge',
          source: 'succeeded-node',
          target: 'running-node',
          data: {
            _sourceRunningStatus: NodeRunningStatus.Succeeded,
            _targetRunningStatus: NodeRunningStatus.Running,
            _waitingRun: false,
          },
        }),
        createEdge({
          id: 'waiting-edge',
          source: 'running-node',
          target: 'waiting-node',
          data: {
            _sourceRunningStatus: NodeRunningStatus.Running,
            _waitingRun: true,
          },
        }),
      ],
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [
            createNodeTracing({
              node_id: 'running-node',
              status: NodeRunningStatus.Running,
            }),
            createNodeTracing({
              node_id: 'succeeded-node',
              status: NodeRunningStatus.Succeeded,
            }),
          ],
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowFailed('LLM provider and model are required.')
    })

    expect(store.getState().workflowRunningData!.result.status).toBe(WorkflowRunningStatus.Failed)
    expect(store.getState().workflowRunningData!.result.error).toBe(
      'LLM provider and model are required.',
    )
    expect(store.getState().workflowRunningData!.tracing!.map((trace) => trace.status)).toEqual([
      NodeRunningStatus.Failed,
      NodeRunningStatus.Succeeded,
    ])

    await waitFor(() => {
      const runningNode = result.current.nodes.find((node) => node.id === 'running-node')
      const succeededNode = result.current.nodes.find((node) => node.id === 'succeeded-node')
      const waitingNode = result.current.nodes.find((node) => node.id === 'waiting-node')
      const runningEdge = result.current.edges.find((edge) => edge.id === 'running-edge')
      const waitingEdge = result.current.edges.find((edge) => edge.id === 'waiting-edge')

      expect(getNodeRuntimeState(runningNode)).toMatchObject({
        _runningStatus: NodeRunningStatus.Failed,
        _waitingRun: false,
      })
      expect(getNodeRuntimeState(succeededNode)._runningStatus).toBe(NodeRunningStatus.Succeeded)
      expect(getNodeRuntimeState(waitingNode)._waitingRun).toBe(false)
      expect(getEdgeRuntimeState(runningEdge)).toMatchObject({
        _sourceRunningStatus: NodeRunningStatus.Succeeded,
        _targetRunningStatus: NodeRunningStatus.Failed,
        _waitingRun: false,
      })
      expect(getEdgeRuntimeState(waitingEdge)).toMatchObject({
        _sourceRunningStatus: NodeRunningStatus.Failed,
        _waitingRun: false,
      })
    })
  })

  it('ignores a late failure after the workflow has stopped', () => {
    const { result, store } = renderRunEventHook(() => useWorkflowFailed(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: { status: WorkflowRunningStatus.Stopped },
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowFailed()
    })

    expect(store.getState().workflowRunningData!.result.status).toBe(WorkflowRunningStatus.Stopped)
  })

  it('adds a late error message to an already failed workflow', () => {
    const { result, store } = renderRunEventHook(() => useWorkflowFailed(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: { status: WorkflowRunningStatus.Failed },
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowFailed('LLM provider and model are required.')
    })

    expect(store.getState().workflowRunningData!.result).toMatchObject({
      status: WorkflowRunningStatus.Failed,
      error: 'LLM provider and model are required.',
    })
  })

  it('keeps the workflow_finished error when a generic error arrives later', () => {
    const { result, store } = renderRunEventHook(() => useWorkflowFailed(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: {
            status: WorkflowRunningStatus.Failed,
            error: 'LLM provider and model are required.',
          },
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowFailed('Server Error')
    })

    expect(store.getState().workflowRunningData!.result.error).toBe(
      'LLM provider and model are required.',
    )
  })
})
