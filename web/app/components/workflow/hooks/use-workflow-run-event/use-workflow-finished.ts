import type { WorkflowFinishedResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { getFilesInLogs } from '@/app/components/base/file-uploader/utils'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowFinished = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowFinished = useCallback((params: WorkflowFinishedResponse) => {
    const { data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()

    const out = data.outputs
    const outputKeys = out && typeof out === 'object' && !Array.isArray(out) ? Object.keys(out) : []
    const firstOutputKey = outputKeys[0]
    const firstOutputVal = firstOutputKey !== undefined && out && typeof out === 'object' && !Array.isArray(out)
      ? (out as Record<string, unknown>)[firstOutputKey]
      : undefined
    const isSingleKeyedString = outputKeys.length === 1 && typeof firstOutputVal === 'string'

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.result = {
        ...draft.result,
        ...data,
        files: getFilesInLogs(data.outputs),
      } as any
      if (typeof out === 'string') {
        draft.resultTabActive = true
        draft.resultText = out
      }
      else if (isSingleKeyedString && typeof firstOutputVal === 'string') {
        draft.resultTabActive = true
        draft.resultText = firstOutputVal
      }
    }))
  }, [workflowStore])

  return {
    handleWorkflowFinished,
  }
}
