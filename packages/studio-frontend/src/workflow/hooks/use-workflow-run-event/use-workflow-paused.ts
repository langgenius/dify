import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStore } from '../../store'
import { WorkflowRunningStatus } from '../../types'

export const useWorkflowPaused = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowPaused = useCallback(() => {
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.result = {
        ...draft.result,
        status: WorkflowRunningStatus.Paused,
      }
    }))
  }, [workflowStore])

  return {
    handleWorkflowPaused,
  }
}
