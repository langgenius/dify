import type { TextChunkResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { appendTextPart } from '@/features/generative-ui/stream-reducer'

export const useWorkflowTextChunk = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowTextChunk = useCallback(
    (params: TextChunkResponse) => {
      const {
        data: { text, from_variable_selector },
      } = params
      const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()
      const nextSelectorKey = from_variable_selector?.join('.')

      setWorkflowRunningData(
        produce(workflowRunningData!, (draft) => {
          draft.resultTabActive = true
          const shouldInsertLineBreak =
            nextSelectorKey &&
            draft.resultText &&
            draft.resultTextSelectorKey &&
            draft.resultTextSelectorKey !== nextSelectorKey &&
            !draft.resultText.endsWith('\n') &&
            !text.startsWith('\n')
          const chunk = shouldInsertLineBreak ? `\n${text}` : text
          draft.resultText += chunk
          if (draft.parts) draft.parts = appendTextPart(draft.parts, chunk)
          if (nextSelectorKey) draft.resultTextSelectorKey = nextSelectorKey
        }),
      )
    },
    [workflowStore],
  )

  return {
    handleWorkflowTextChunk,
  }
}
