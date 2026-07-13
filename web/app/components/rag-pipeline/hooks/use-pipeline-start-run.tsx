import type { useNodesSyncDraft } from '.'
import { useCallback } from 'react'
import { useWorkflowInteractions } from '@/app/components/workflow/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useInputFieldPanel, useNodesSyncDraftByCanEdit } from '.'

type DoSyncWorkflowDraft = ReturnType<typeof useNodesSyncDraft>['doSyncWorkflowDraft']

const usePipelineStartRunBase = (doSyncWorkflowDraft: DoSyncWorkflowDraft) => {
  const workflowStore = useWorkflowStore()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const { closeAllInputFieldPanels } = useInputFieldPanel()

  const handleWorkflowStartRunInWorkflow = useCallback(async () => {
    const { workflowRunningData } = workflowStore.getState()

    if (workflowRunningData?.result.status === WorkflowRunningStatus.Running) return

    const {
      isPreparingDataSource,
      setIsPreparingDataSource,
      showDebugAndPreviewPanel,
      setShowEnvPanel,
      setShowDebugAndPreviewPanel,
    } = workflowStore.getState()

    if (!isPreparingDataSource && workflowRunningData) {
      workflowStore.setState({
        isPreparingDataSource: true,
        workflowRunningData: undefined,
      })
      return
    }

    setShowEnvPanel(false)
    closeAllInputFieldPanels()

    if (showDebugAndPreviewPanel) {
      setIsPreparingDataSource?.(false)
      handleCancelDebugAndPreviewPanel()
      return
    }

    await doSyncWorkflowDraft()
    setIsPreparingDataSource?.(true)
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

export const usePipelineStartRunByCanEdit = (canEdit: boolean) => {
  const { doSyncWorkflowDraft } = useNodesSyncDraftByCanEdit(canEdit)

  return usePipelineStartRunBase(doSyncWorkflowDraft)
}
