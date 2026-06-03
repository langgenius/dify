import { act, waitFor } from '@testing-library/react'
import { createNode } from '../../../__tests__/fixtures'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { NodeRunningStatus } from '../../../types'
import { useWorkflowNodeLoopFinished } from '../use-workflow-node-loop-finished'
import {
  createLoopFinishedResponse,
  getEdgeRuntimeState,
  getNodeRuntimeState,
  renderRunEventHook,
} from './test-helpers'

describe('useWorkflowNodeLoopFinished', () => {
  it('updates tracing, node status and edges', async () => {
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
      result.current.handleWorkflowNodeLoopFinished(createLoopFinishedResponse())
    })

    expect(store.getState().workflowRunningData!.tracing![0]!.status).toBe(NodeRunningStatus.Succeeded)

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._runningStatus).toBe(NodeRunningStatus.Succeeded)
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBe(NodeRunningStatus.Succeeded)
    })
  })
})
