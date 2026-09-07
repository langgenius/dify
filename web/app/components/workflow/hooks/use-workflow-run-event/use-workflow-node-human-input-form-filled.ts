import type { HumanInputFormFilledResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { applyHumanInputFilled } from '@/app/components/base/chat/chat/answer/human-input-content/form-state'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeHumanInputFormFilled = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeHumanInputFormFilled = useCallback(
    (params: HumanInputFormFilledResponse) => {
      const { data } = params
      const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()

      const newWorkflowRunningData = produce(workflowRunningData!, (draft) => {
        applyHumanInputFilled(draft, data)
      })
      setWorkflowRunningData(newWorkflowRunningData)
    },
    [workflowStore],
  )

  return {
    handleWorkflowNodeHumanInputFormFilled,
  }
}
