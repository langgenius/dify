import type { ReasoningChunkResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowReasoning = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowReasoning = useCallback((params: ReasoningChunkResponse) => {
    const { data: { reasoning, node_id, is_final } } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      const reasoningContent = (draft.reasoningContent ||= {})
      // key by producing LLM node so the panel can keep multiple nodes' reasoning ordered
      const key = node_id || '_'
      if (reasoning)
        reasoningContent[key] = (reasoningContent[key] || '') + reasoning
      if (is_final)
        draft.reasoningFinished = true
    }))
  }, [workflowStore])

  return {
    handleWorkflowReasoning,
  }
}
