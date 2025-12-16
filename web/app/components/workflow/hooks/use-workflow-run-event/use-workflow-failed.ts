import { useCallback } from 'react'
import { produce } from 'immer'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'

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
  }, [workflowStore])

  return {
    handleWorkflowFailed,
  }
}
