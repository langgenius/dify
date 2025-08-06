import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  WorkflowRunningStatus,
} from '@/app/components/workflow/types'
import { useWorkflowInteractions } from '@/app/components/workflow/hooks'
import {
  useInputFieldPanel,
  useNodesSyncDraft,
} from '.'

export const usePipelineStartRun = () => {
  const workflowStore = useWorkflowStore()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const { closeAllInputFieldPanels } = useInputFieldPanel()

  const handleWorkflowStartRunInWorkflow = useCallback(async () => {
    const {
      workflowRunningData,
    } = workflowStore.getState()

    if (workflowRunningData?.result.status === WorkflowRunningStatus.Running)
      return

    const {
      showDebugAndPreviewPanel,
      setShowEnvPanel,
      setShowDebugAndPreviewPanel,
    } = workflowStore.getState()

    setShowEnvPanel(false)
    closeAllInputFieldPanels()

    if (showDebugAndPreviewPanel) {
      handleCancelDebugAndPreviewPanel()
      return
    }

    await doSyncWorkflowDraft()
    setShowDebugAndPreviewPanel(true)
  }, [workflowStore, handleCancelDebugAndPreviewPanel, doSyncWorkflowDraft])

  const handleStartWorkflowRun = useCallback(() => {
    handleWorkflowStartRunInWorkflow()
  }, [handleWorkflowStartRunInWorkflow])

  return {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
  }
}
