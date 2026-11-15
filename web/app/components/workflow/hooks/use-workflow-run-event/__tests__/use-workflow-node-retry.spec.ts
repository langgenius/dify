import { act, waitFor } from '@testing-library/react'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { useWorkflowNodeRetry } from '../use-workflow-node-retry'
import { createNodeFinishedResponse, getNodeRuntimeState, renderRunEventHook } from './test-helpers'

describe('useWorkflowNodeRetry', () => {
  it('pushes retry data to tracing and updates _retryIndex', async () => {
    const { result, store } = renderRunEventHook(() => useWorkflowNodeRetry(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    const response = createNodeFinishedResponse()
    response.data.retry_index = 2
    act(() => {
      result.current.handleWorkflowNodeRetry(response)
    })

    expect(store.getState().workflowRunningData!.tracing).toEqual([response.data])

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._retryIndex).toBe(2)
    })
  })
})
