import { act, waitFor } from '@testing-library/react'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { useWorkflowNodeRetry } from '../use-workflow-node-retry'
import {
  getNodeRuntimeState,
  renderRunEventHook,
} from './test-helpers'

describe('useWorkflowNodeRetry', () => {
  it('pushes retry data to tracing and updates _retryIndex', async () => {
    const { result, store } = renderRunEventHook(() => useWorkflowNodeRetry(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    act(() => {
      result.current.handleWorkflowNodeRetry({
        data: { node_id: 'n1', retry_index: 2 },
      } as never)
    })

    expect(store.getState().workflowRunningData!.tracing).toHaveLength(1)

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._retryIndex).toBe(2)
    })
  })
})
