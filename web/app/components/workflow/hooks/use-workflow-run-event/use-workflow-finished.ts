import type { WorkflowFinishedResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { getFilesInLogs } from '@/app/components/base/file-uploader/utils'
import { useWorkflowStore } from '@/app/components/workflow/store'

const formatTextOutputs = (outputs: WorkflowFinishedResponse['data']['outputs']) => {
  if (!outputs || typeof outputs !== 'object')
    return undefined

  const textOutputs = Object.values(outputs).flatMap((value) => {
    if (typeof value === 'string')
      return [value]

    if (Array.isArray(value) && value.every(item => typeof item === 'string'))
      return [value.join('\n')]

    return []
  }).filter(Boolean)

  if (!textOutputs.length)
    return undefined

  return textOutputs.join('\n')
}

export const useWorkflowFinished = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowFinished = useCallback((params: WorkflowFinishedResponse) => {
    const { data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()
    const formattedTextOutput = formatTextOutputs(data.outputs)

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.result = {
        ...draft.result,
        ...data,
        files: getFilesInLogs(data.outputs),
      } as any
      if (formattedTextOutput) {
        draft.resultTabActive = true
        draft.resultText = formattedTextOutput
      }
    }))
  }, [workflowStore])

  return {
    handleWorkflowFinished,
  }
}
