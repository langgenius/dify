import type { WorkflowPausedResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import {
  hasExternalWaitReason,
  hasHumanInputWaitReason,
} from '@/app/components/workflow/nodes/agent-v2/execution'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'

export const useWorkflowPaused = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowPaused = useCallback(
    (params?: WorkflowPausedResponse) => {
      const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()

      setWorkflowRunningData(
        produce(workflowRunningData!, (draft) => {
          draft.result = {
            ...draft.result,
            status: WorkflowRunningStatus.Paused,
            external_wait: hasExternalWaitReason(params?.data.reasons),
            human_input_wait: hasHumanInputWaitReason(params?.data.reasons),
          }
        }),
      )
    },
    [workflowStore],
  )

  return {
    handleWorkflowPaused,
  }
}
