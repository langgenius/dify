import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  BlockEnum,
  WorkflowRunningStatus,
} from '@/app/components/workflow/types'
import { useWorkflowInteractions } from '@/app/components/workflow/hooks'
import {
  useNodesSyncDraft,
  usePipelineRun,
} from '.'

export const usePipelineStartRun = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const { handleRun } = usePipelineRun()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()

  const handleWorkflowStartRunInWorkflow = useCallback(async () => {
    const {
      workflowRunningData,
    } = workflowStore.getState()

    if (workflowRunningData?.result.status === WorkflowRunningStatus.Running)
      return

    const { getNodes } = store.getState()
    const nodes = getNodes()
    const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
    const startVariables = startNode?.data.variables || []
    const {
      showDebugAndPreviewPanel,
      setShowInputsPanel,
      setShowEnvPanel,
      setShowDebugAndPreviewPanel,
    } = workflowStore.getState()

    setShowEnvPanel(false)

    if (showDebugAndPreviewPanel) {
      handleCancelDebugAndPreviewPanel()
      return
    }

    if (!startVariables.length) {
      await doSyncWorkflowDraft()
      handleRun({ inputs: {}, files: [] })
      setShowDebugAndPreviewPanel(true)
      setShowInputsPanel(false)
    }
    else {
      setShowDebugAndPreviewPanel(true)
      setShowInputsPanel(true)
    }
  }, [store, workflowStore, handleCancelDebugAndPreviewPanel, handleRun, doSyncWorkflowDraft])

  const handleStartWorkflowRun = useCallback(() => {
    handleWorkflowStartRunInWorkflow()
  }, [handleWorkflowStartRunInWorkflow])

  return {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
  }
}
