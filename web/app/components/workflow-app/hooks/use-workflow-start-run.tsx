import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  BlockEnum,
  WorkflowRunningStatus,
} from '@/app/components/workflow/types'
import { useWorkflowInteractions } from '@/app/components/workflow/hooks'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import {
  useIsChatMode,
  useNodesSyncDraft,
  useWorkflowRun,
} from '.'

export const useWorkflowStartRun = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const isChatMode = useIsChatMode()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const { handleRun } = useWorkflowRun()
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
    const fileSettings = featuresStore!.getState().features.file
    const {
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setShowInputsPanel,
      setShowEnvPanel,
    } = workflowStore.getState()

    setShowEnvPanel(false)

    if (showDebugAndPreviewPanel) {
      handleCancelDebugAndPreviewPanel()
      return
    }

    if (!startVariables.length && !fileSettings?.image?.enabled) {
      await doSyncWorkflowDraft()
      handleRun({ inputs: {}, files: [] })
      setShowDebugAndPreviewPanel(true)
      setShowInputsPanel(false)
    }
    else {
      setShowDebugAndPreviewPanel(true)
      setShowInputsPanel(true)
    }
  }, [store, workflowStore, featuresStore, handleCancelDebugAndPreviewPanel, handleRun, doSyncWorkflowDraft])

  const handleWorkflowStartRunInChatflow = useCallback(async () => {
    const {
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setHistoryWorkflowData,
      setShowEnvPanel,
      setShowChatVariablePanel,
    } = workflowStore.getState()

    setShowEnvPanel(false)
    setShowChatVariablePanel(false)

    if (showDebugAndPreviewPanel)
      handleCancelDebugAndPreviewPanel()
    else
      setShowDebugAndPreviewPanel(true)

    setHistoryWorkflowData(undefined)
  }, [workflowStore, handleCancelDebugAndPreviewPanel])

  const handleStartWorkflowRun = useCallback(() => {
    if (!isChatMode)
      handleWorkflowStartRunInWorkflow()
    else
      handleWorkflowStartRunInChatflow()
  }, [isChatMode, handleWorkflowStartRunInWorkflow, handleWorkflowStartRunInChatflow])

  return {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
    handleWorkflowStartRunInChatflow,
  }
}
