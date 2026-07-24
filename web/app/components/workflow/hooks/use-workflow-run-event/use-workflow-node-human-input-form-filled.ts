import type { HumanInputFormFilledResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeHumanInputFormFilled = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeHumanInputFormFilled = useCallback((params: HumanInputFormFilledResponse) => {
    const { data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()

    const newWorkflowRunningData = produce(workflowRunningData!, (draft) => {
      if (draft.humanInputFormDataList?.length) {
        const currentFormIndex = draft.humanInputFormDataList.findIndex(item => item.node_id === data.node_id)
        draft.humanInputFormDataList.splice(currentFormIndex, 1)
      }
      if (!draft.humanInputFilledFormDataList) {
        draft.humanInputFilledFormDataList = [data]
      }
      else {
        draft.humanInputFilledFormDataList.push(data)
      }
    })
    setWorkflowRunningData(newWorkflowRunningData)
  }, [workflowStore])

  return {
    handleWorkflowNodeHumanInputFormFilled,
  }
}
