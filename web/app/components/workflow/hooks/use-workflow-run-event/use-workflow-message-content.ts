import type { MessageContentEvent } from '@/features/generative-ui/protocol/types'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { appendTextPart, updateContentPart } from '@/features/generative-ui/stream-reducer'

export const useWorkflowMessageContent = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowMessageContent = useCallback(
    (params: MessageContentEvent) => {
      const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()
      if (!workflowRunningData) return

      setWorkflowRunningData(
        produce(workflowRunningData, (draft) => {
          draft.resultTabActive = true
          if (!draft.parts && draft.resultText)
            draft.parts = appendTextPart(undefined, draft.resultText)
          draft.parts = updateContentPart(draft.parts, params.data)
        }),
      )
    },
    [workflowStore],
  )

  return {
    handleWorkflowMessageContent,
  }
}
