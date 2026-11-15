import { act, waitFor } from '@testing-library/react'
import { baseRunningData } from '../../../__tests__/workflow-test-env'
import { useWorkflowNodeIterationNext } from '../use-workflow-node-iteration-next'
import {
  createIterationNextResponse,
  getNodeRuntimeState,
  renderRunEventHook,
} from './test-helpers'

describe('useWorkflowNodeIterationNext', () => {
  it('sets _iterationIndex and increments iterTimes', async () => {
    const { result, store } = renderRunEventHook(() => useWorkflowNodeIterationNext(), {
      initialStoreState: {
        workflowRunningData: baseRunningData(),
        iterTimes: 3,
      },
    })

    act(() => {
      result.current.handleWorkflowNodeIterationNext(createIterationNextResponse())
    })

    await waitFor(() => {
      expect(getNodeRuntimeState(result.current.nodes[0])._iterationIndex).toBe(3)
    })
    expect(store.getState().iterTimes).toBe(4)
  })
})
