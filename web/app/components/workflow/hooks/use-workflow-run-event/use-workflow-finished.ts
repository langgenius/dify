import type { WorkflowFinishedResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { getFilesInLogs } from '@/app/components/base/file-uploader/utils'
import { useWorkflowStore } from '@/app/components/workflow/store'

const SKIP_DISPLAY = Symbol('skip-display')

const isFileOutput = (value: unknown) => {
  return !!(value && typeof value === 'object' && 'dify_model_identity' in value && value.dify_model_identity === '__dify__file__')
}

const toDisplayText = (value: unknown): string | typeof SKIP_DISPLAY | undefined => {
  if (isFileOutput(value))
    return SKIP_DISPLAY

  if (typeof value === 'string')
    return value

  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)

  if (value === null)
    return SKIP_DISPLAY

  if (Array.isArray(value)) {
    if (value.every(item => isFileOutput(item)))
      return SKIP_DISPLAY
  }

  if (typeof value === 'object' || Array.isArray(value)) {
    try {
      return JSON.stringify(value, null, 2)
    }
    catch {
      return undefined
    }
  }

  return undefined
}

const formatTextOutputs = (outputs: WorkflowFinishedResponse['data']['outputs']) => {
  if (!outputs || typeof outputs !== 'object')
    return undefined

  const formattedOutputs = Object.values(outputs).map(toDisplayText)
  if (formattedOutputs.includes(undefined))
    return undefined

  const textOutputs = formattedOutputs.filter((value): value is string => value !== SKIP_DISPLAY)

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
      if (formattedTextOutput !== undefined) {
        draft.resultTabActive = true
        draft.resultText = formattedTextOutput
      }
    }))
  }, [workflowStore])

  return {
    handleWorkflowFinished,
  }
}
