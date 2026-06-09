import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '../../../types'
import { useWorkflowFailed } from '../use-workflow-failed'

describe('useWorkflowFailed', () => {
  it('sets status to Failed', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowFailed(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowFailed()

    expect(store.getState().workflowRunningData!.result.status).toBe(WorkflowRunningStatus.Failed)
  })
})
