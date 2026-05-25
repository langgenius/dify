import type { SnippetInputField } from '@/models/snippet'
import type { SnippetDraftRunPayload } from '@/types/snippet'
import { useCallback } from 'react'
import { useWorkflowInteractions } from '@/app/components/workflow/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'

type UseSnippetStartRunOptions = {
  handleRun: (params: SnippetDraftRunPayload) => void
  inputFields: SnippetInputField[]
}

export const useSnippetStartRun = ({
  handleRun,
  inputFields,
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

    if (inputFields.length > 0) {
      setShowInputsPanel(true)
      return
    }

    setShowInputsPanel(false)
    handleRun({ inputs: {} })
  }, [handleCancelDebugAndPreviewPanel, handleRun, inputFields.length, workflowStore])

  const handleStartWorkflowRun = useCallback(() => {
    handleWorkflowStartRunInWorkflow()
  }, [handleWorkflowStartRunInWorkflow])

  return {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
  }
}
