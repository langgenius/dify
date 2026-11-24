import type { WorkflowFinishedResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { getFilesInLogs } from '@/app/components/base/file-uploader/utils'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { hasOpenUIParts, interruptContentParts } from '@/features/generative-ui/stream-reducer'

export const useWorkflowFinished = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowFinished = useCallback(
    (params: WorkflowFinishedResponse) => {
      const { data } = params
      const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()

      const isStringOutput =
        data.outputs &&
        Object.keys(data.outputs).length === 1 &&
        typeof data.outputs[Object.keys(data.outputs)[0]!] === 'string'

      setWorkflowRunningData(
        produce(workflowRunningData!, (draft) => {
          draft.result = {
            ...draft.result,
            ...data,
            files: getFilesInLogs(data.outputs),
          } as any
          if (hasOpenUIParts(data.parts)) {
            draft.resultTabActive = true
            draft.parts = data.parts
          } else if (draft.parts) {
            draft.parts = interruptContentParts(
              draft.parts,
              data.status === WorkflowRunningStatus.Stopped ? 'cancelled' : 'error',
            )
          }
          if (isStringOutput) {
            draft.resultTabActive = true
            draft.resultText = data.outputs[Object.keys(data.outputs)[0]!]
          }
        }),
      )
    },
    [workflowStore],
  )

  return {
    handleWorkflowFinished,
  }
}
