import type { TextChunkResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowTextChunk = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowTextChunk = useCallback((params: TextChunkResponse) => {
    const { data: { text } } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.resultTabActive = true
      draft.resultText += text
    }))
  }, [workflowStore])

  return {
    handleWorkflowTextChunk,
  }
}
