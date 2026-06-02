import type { SnippetDraftRunPayload } from '@/types/snippet'
import { useCallback } from 'react'
import { useWorkflowInteractions } from '@/app/components/workflow/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useSnippetDetailStore } from '../store'

type UseSnippetStartRunOptions = {
  handleRun: (params: SnippetDraftRunPayload) => void
}

export const useSnippetStartRun = ({
  handleRun,
}: UseSnippetStartRunOptions) => {
  const workflowStore = useWorkflowStore()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()

  const handleWorkflowStartRunInWorkflow = useCallback(() => {
    const {
      workflowRunningData,
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setShowInputsPanel,
      setShowEnvPanel,
      setShowGlobalVariablePanel,
    } = workflowStore.getState()

    if (workflowRunningData?.result.status === WorkflowRunningStatus.Running)
      return

    setShowEnvPanel(false)
    setShowGlobalVariablePanel(false)

    if (showDebugAndPreviewPanel) {
      handleCancelDebugAndPreviewPanel()
      return
    }

    setShowDebugAndPreviewPanel(true)

    const currentInputFields = useSnippetDetailStore.getState().fields

    if (currentInputFields.length > 0) {
      setShowInputsPanel(true)
      return
    }

    setShowInputsPanel(false)
    handleRun({ inputs: {} })
  }, [handleCancelDebugAndPreviewPanel, handleRun, workflowStore])

  const handleStartWorkflowRun = useCallback(() => {
    handleWorkflowStartRunInWorkflow()
  }, [handleWorkflowStartRunInWorkflow])

  return {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
  }
}
