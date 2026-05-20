import { act, waitFor } from '@testing-library/react'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { NodeRunningStatus } from '../../../types'
import { useWorkflowNodeStarted } from '../use-workflow-node-started'
import {
  containerParams,
  createNodeStartedResponse,
  getEdgeRuntimeState,
  getNodeRuntimeState,
  renderViewportHook,
} from './test-helpers'

describe('useWorkflowNodeStarted', () => {
  it('pushes to tracing, sets node running, and adjusts viewport for root node', async () => {
    const { result, store } = renderViewportHook(() => useWorkflowNodeStarted(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    act(() => {
      result.current.handleWorkflowNodeStarted(createNodeStartedResponse(), containerParams)
    })

    const tracing = store.getState().workflowRunningData!.tracing!
    expect(tracing).toHaveLength(1)
    expect(tracing[0]!.status).toBe(NodeRunningStatus.Running)

    await waitFor(() => {
      const transform = result.current.reactFlowStore.getState().transform
      expect(transform[0]).toBe(200)
      expect(transform[1]).toBe(310)
      expect(transform[2]).toBe(1)

      const node = result.current.nodes.find(item => item.id === 'n1')
      expect(getNodeRuntimeState(node)._runningStatus).toBe(NodeRunningStatus.Running)
      expect(getNodeRuntimeState(node)._waitingRun).toBe(false)
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBe(NodeRunningStatus.Running)
    })
  })

  it('does not adjust viewport for child nodes', async () => {
    const { result } = renderViewportHook(() => useWorkflowNodeStarted(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    act(() => {
      result.current.handleWorkflowNodeStarted(createNodeStartedResponse({
        data: { node_id: 'n2' } as never,
      }), containerParams)
    })

    await waitFor(() => {
      const transform = result.current.reactFlowStore.getState().transform
      expect(transform[0]).toBe(0)
      expect(transform[1]).toBe(0)
      expect(transform[2]).toBe(1)
      expect(getNodeRuntimeState(result.current.nodes.find(item => item.id === 'n2'))._runningStatus).toBe(NodeRunningStatus.Running)
    })
  })

  it('updates existing tracing entry when node_id already exists', () => {
    const { result, store } = renderViewportHook(() => useWorkflowNodeStarted(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [
            { node_id: 'n0', status: NodeRunningStatus.Succeeded } as never,
            { node_id: 'n1', status: NodeRunningStatus.Succeeded } as never,
          ],
        }),
      },
    })

    act(() => {
      result.current.handleWorkflowNodeStarted(createNodeStartedResponse(), containerParams)
    })

    const tracing = store.getState().workflowRunningData!.tracing!
    expect(tracing).toHaveLength(2)
    expect(tracing[1]!.status).toBe(NodeRunningStatus.Running)
  })
})
