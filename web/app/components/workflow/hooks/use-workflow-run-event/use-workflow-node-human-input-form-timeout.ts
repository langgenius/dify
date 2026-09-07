import type { HumanInputFormTimeoutResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { applyHumanInputTimeout } from '@/app/components/base/chat/chat/answer/human-input-content/form-state'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeHumanInputFormTimeout = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeHumanInputFormTimeout = useCallback(
    (params: HumanInputFormTimeoutResponse) => {
      const { data } = params
      const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()

      const newWorkflowRunningData = produce(workflowRunningData!, (draft) => {
        applyHumanInputTimeout(draft, data)
      })
      setWorkflowRunningData(newWorkflowRunningData)
    },
    [workflowStore],
  )

  return {
    handleWorkflowNodeHumanInputFormTimeout,
  }
}
