import type { TextChunkResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback, useRef } from 'react'
import { v4 as uuidV4 } from 'uuid'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowTextChunk = () => {
  const workflowStore = useWorkflowStore()
  const toolCallIdRef = useRef<string | null>(null)

  const handleWorkflowTextChunk = useCallback((params: TextChunkResponse) => {
    const { data: {
      text,
      chunk_type,
      tool_name,
      tool_arguments,
      tool_icon,
      tool_icon_dark,
      tool_error,
      tool_elapsed_time,
      tool_files,
    } } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.resultTabActive = true

      if (chunk_type === 'text') {
        draft.resultText += text

        if (!draft.resultLLMGenerationItems)
          draft.resultLLMGenerationItems = []

        const isNotCompletedTextItemIndex = draft.resultLLMGenerationItems?.findIndex(item => item.type === 'text' && !item.textCompleted)

        if (isNotCompletedTextItemIndex > -1) {
          draft.resultLLMGenerationItems![isNotCompletedTextItemIndex].text += text
        }
        else {
          draft.resultLLMGenerationItems?.push({
            id: uuidV4(),
            type: 'text',
            text,
          })
        }
      }

      if (chunk_type === 'tool_call') {
        if (!draft.resultLLMGenerationItems)
          draft.resultLLMGenerationItems = []

        const isNotCompletedTextItemIndex = draft.resultLLMGenerationItems?.findIndex(item => item.type === 'text' && !item.textCompleted)
        if (isNotCompletedTextItemIndex > -1) {
          draft.resultLLMGenerationItems![isNotCompletedTextItemIndex].textCompleted = true
        }
        toolCallIdRef.current = uuidV4()
        draft.resultLLMGenerationItems?.push({
          id: toolCallIdRef.current,
          type: 'tool',
          toolName: tool_name,
          toolArguments: tool_arguments,
          toolIcon: tool_icon,
          toolIconDark: tool_icon_dark,
        })
      }

      if (chunk_type === 'tool_result') {
        const currentToolCallIndex = draft.resultLLMGenerationItems?.findIndex(item => item.id === toolCallIdRef.current) ?? -1

        if (currentToolCallIndex > -1) {
          draft.resultLLMGenerationItems![currentToolCallIndex].toolError = tool_error
          draft.resultLLMGenerationItems![currentToolCallIndex].toolDuration = tool_elapsed_time
          draft.resultLLMGenerationItems![currentToolCallIndex].toolFiles = tool_files
          draft.resultLLMGenerationItems![currentToolCallIndex].toolOutput = text
        }
      }

      if (chunk_type === 'thought_start') {
        if (!draft.resultLLMGenerationItems)
          draft.resultLLMGenerationItems = []

        const isNotCompletedTextItemIndex = draft.resultLLMGenerationItems?.findIndex(item => item.type === 'text' && !item.textCompleted)
        if (isNotCompletedTextItemIndex > -1) {
          draft.resultLLMGenerationItems![isNotCompletedTextItemIndex].textCompleted = true
        }
        toolCallIdRef.current = uuidV4()
        draft.resultLLMGenerationItems?.push({
          id: toolCallIdRef.current,
          type: 'thought',
          thoughtOutput: '',
        })
      }

      if (chunk_type === 'thought') {
        const currentThoughtIndex = draft.resultLLMGenerationItems?.findIndex(item => item.id === toolCallIdRef.current) ?? -1
        if (currentThoughtIndex > -1) {
          draft.resultLLMGenerationItems![currentThoughtIndex].thoughtOutput += text
        }
      }

      if (chunk_type === 'thought_end') {
        const currentThoughtIndex = draft.resultLLMGenerationItems?.findIndex(item => item.id === toolCallIdRef.current) ?? -1
        if (currentThoughtIndex > -1) {
          draft.resultLLMGenerationItems![currentThoughtIndex].thoughtOutput += text
          draft.resultLLMGenerationItems![currentThoughtIndex].thoughtCompleted = true
        }
      }
    }))
  }, [workflowStore])

  return {
    handleWorkflowTextChunk,
  }
}
