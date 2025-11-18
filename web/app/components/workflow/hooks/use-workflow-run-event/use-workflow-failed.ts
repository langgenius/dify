import { useCallback } from 'react'
import { produce } from 'immer'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { trackEvent } from '@/app/components/amplitude'

export const useWorkflowFailed = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowFailed = useCallback(() => {
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.result = {
        ...draft.result,
        status: WorkflowRunningStatus.Failed,
      }
    }))

    trackEvent('workflow_run_failed', {
      workflow_id: workflowRunningData?.task_id,
      error: workflowRunningData?.result.error,
      data: workflowRunningData?.result,
    })
  }, [workflowStore])

  return {
    handleWorkflowFailed,
  }
}
