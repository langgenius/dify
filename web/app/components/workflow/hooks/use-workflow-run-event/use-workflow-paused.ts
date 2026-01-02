import type { WorkflowPausedResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'

export const useWorkflowPaused = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowPaused = useCallback((params: WorkflowPausedResponse) => {
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()

    if (!workflowRunningData) {
      console.warn('[handleWorkflowPaused] No running data found')
      return
    }

    try {
      setWorkflowRunningData(produce(workflowRunningData, (draft) => {
        if (!draft.result) {
          console.warn('[handleWorkflowPaused] No result found in draft')
          return
        }
        draft.result.status = WorkflowRunningStatus.Paused
        // 使用 params 中的数据
        draft.result.pauseReason = params.data.pause_reason
        draft.result.pausedAt = new Date(params.data.paused_at * 1000).toISOString()
      }))
    }
    catch (error) {
      console.error('[handleWorkflowPaused] Failed to update workflow running data:', error)
    }
  }, [workflowStore])

  return {
    handleWorkflowPaused,
  }
}
