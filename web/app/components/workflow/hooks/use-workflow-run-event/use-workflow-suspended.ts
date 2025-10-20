import { useCallback } from 'react'
import { produce } from 'immer'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'

export const useWorkflowSuspended = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowSuspended = useCallback(() => {
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.result = {
        ...draft.result,
        status: WorkflowRunningStatus.Suspended,
      }
    }))
  }, [workflowStore])

  return {
    handleWorkflowSuspended,
  }
}
