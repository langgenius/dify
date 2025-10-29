import { useCallback } from 'react'
import { produce } from 'immer'
import type { WorkflowFinishedResponse } from '@/types/workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { getFilesInLogs } from '@/app/components/base/file-uploader/utils'

export const useWorkflowFinished = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowFinished = useCallback((params: WorkflowFinishedResponse) => {
    const { data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()

    const isStringOutput = data.outputs && Object.keys(data.outputs).length === 1 && typeof data.outputs[Object.keys(data.outputs)[0]] === 'string'

    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.result = {
        ...draft.result,
        ...data,
        files: getFilesInLogs(data.outputs),
      } as any
      if (isStringOutput) {
        draft.resultTabActive = true
        draft.resultText = data.outputs[Object.keys(data.outputs)[0]]
      }
    }))
  }, [workflowStore])

  return {
    handleWorkflowFinished,
  }
}
