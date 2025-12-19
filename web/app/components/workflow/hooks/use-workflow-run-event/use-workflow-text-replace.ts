import { useCallback } from 'react'
import { produce } from 'immer'
import type { TextReplaceResponse } from '@/types/workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowTextReplace = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowTextReplace = useCallback((params: TextReplaceResponse) => {
    const { data: { text } } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()
    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.resultText = text
    }))
  }, [workflowStore])

  return {
    handleWorkflowTextReplace,
  }
}
