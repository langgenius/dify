import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '../../../types'
import { useWorkflowPaused } from '../use-workflow-paused'

describe('useWorkflowPaused', () => {
  it('sets status to Paused', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowPaused(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowPaused()

    expect(store.getState().workflowRunningData!.result.status).toBe(WorkflowRunningStatus.Paused)
  })
})
