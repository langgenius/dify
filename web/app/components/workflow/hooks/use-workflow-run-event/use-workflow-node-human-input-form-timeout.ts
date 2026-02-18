import type { HumanInputFormTimeoutResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeHumanInputFormTimeout = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeHumanInputFormTimeout = useCallback((params: HumanInputFormTimeoutResponse) => {
    const { data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()

    const newWorkflowRunningData = produce(workflowRunningData!, (draft) => {
      if (draft.humanInputFormDataList?.length) {
        const currentFormIndex = draft.humanInputFormDataList.findIndex(item => item.node_id === data.node_id)
        draft.humanInputFormDataList[currentFormIndex].expiration_time = data.expiration_time
      }
    })
    setWorkflowRunningData(newWorkflowRunningData)
  }, [workflowStore])

  return {
    handleWorkflowNodeHumanInputFormTimeout,
  }
}
