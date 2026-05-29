import { act, waitFor } from '@testing-library/react'
import { createNode } from '../../../__tests__/fixtures'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { DEFAULT_ITER_TIMES } from '../../../constants'
import { NodeRunningStatus } from '../../../types'
import { useWorkflowNodeIterationFinished } from '../use-workflow-node-iteration-finished'
import {
  createIterationFinishedResponse,
  getEdgeRuntimeState,
  getNodeRuntimeState,
  renderRunEventHook,
} from './test-helpers'

describe('useWorkflowNodeIterationFinished', () => {
  it('updates tracing, resets iterTimes, updates node status and edges', async () => {
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
      result.current.handleWorkflowNodeIterationFinished(createIterationFinishedResponse())
    })

    expect(store.getState().iterTimes).toBe(DEFAULT_ITER_TIMES)

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._runningStatus).toBe(NodeRunningStatus.Succeeded)
      expect(getEdgeRuntimeState(result.current.edges[0])._targetRunningStatus).toBe(NodeRunningStatus.Succeeded)
    })
  })
})
