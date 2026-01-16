import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { TriggerType } from '@/app/components/workflow/header/test-run-menu'
import { useWorkflowInteractions } from '@/app/components/workflow/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  BlockEnum,
  WorkflowRunningStatus,
} from '@/app/components/workflow/types'
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
      setShowGlobalVariablePanel,
    } = workflowStore.getState()

    setShowEnvPanel(false)
    setShowGlobalVariablePanel(false)

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

  const handleWorkflowTriggerScheduleRunInWorkflow = useCallback(async (nodeId?: string) => {
    if (!nodeId)
      return

    const {
      workflowRunningData,
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setShowInputsPanel,
      setShowEnvPanel,
      setShowGlobalVariablePanel,
      setListeningTriggerType,
      setListeningTriggerNodeId,
      setListeningTriggerNodeIds,
      setListeningTriggerIsAll,
    } = workflowStore.getState()

    if (workflowRunningData?.result.status === WorkflowRunningStatus.Running)
      return

    const { getNodes } = store.getState()
    const nodes = getNodes()
    const scheduleNode = nodes.find(node => node.id === nodeId && node.data.type === BlockEnum.TriggerSchedule)

    if (!scheduleNode) {
      console.warn('handleWorkflowTriggerScheduleRunInWorkflow: schedule node not found', nodeId)
      return
    }

    setShowEnvPanel(false)
    setShowGlobalVariablePanel(false)

    if (showDebugAndPreviewPanel) {
      handleCancelDebugAndPreviewPanel()
      return
    }

    setListeningTriggerType(BlockEnum.TriggerSchedule)
    setListeningTriggerNodeId(nodeId)
    setListeningTriggerNodeIds([nodeId])
    setListeningTriggerIsAll(false)

    await doSyncWorkflowDraft()
    handleRun(
      {},
      undefined,
      {
        mode: TriggerType.Schedule,
        scheduleNodeId: nodeId,
      },
    )
    setShowDebugAndPreviewPanel(true)
    setShowInputsPanel(false)
  }, [store, workflowStore, handleCancelDebugAndPreviewPanel, handleRun, doSyncWorkflowDraft])

  const handleWorkflowTriggerWebhookRunInWorkflow = useCallback(async ({ nodeId }: { nodeId: string }) => {
    if (!nodeId)
      return

    const {
      workflowRunningData,
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setShowInputsPanel,
      setShowEnvPanel,
      setShowGlobalVariablePanel,
      setListeningTriggerType,
      setListeningTriggerNodeId,
      setListeningTriggerNodeIds,
      setListeningTriggerIsAll,
    } = workflowStore.getState()

    if (workflowRunningData?.result.status === WorkflowRunningStatus.Running)
      return

    const { getNodes } = store.getState()
    const nodes = getNodes()
    const webhookNode = nodes.find(node => node.id === nodeId && node.data.type === BlockEnum.TriggerWebhook)

    if (!webhookNode) {
      console.warn('handleWorkflowTriggerWebhookRunInWorkflow: webhook node not found', nodeId)
      return
    }

    setShowEnvPanel(false)
    setShowGlobalVariablePanel(false)

    if (!showDebugAndPreviewPanel)
      setShowDebugAndPreviewPanel(true)

    setShowInputsPanel(false)
    setListeningTriggerType(BlockEnum.TriggerWebhook)
    setListeningTriggerNodeId(nodeId)
    setListeningTriggerNodeIds([nodeId])
    setListeningTriggerIsAll(false)

    await doSyncWorkflowDraft()
    handleRun(
      { node_id: nodeId },
      undefined,
      {
        mode: TriggerType.Webhook,
        webhookNodeId: nodeId,
      },
    )
  }, [store, workflowStore, handleRun, doSyncWorkflowDraft])

  const handleWorkflowTriggerPluginRunInWorkflow = useCallback(async (nodeId?: string) => {
    if (!nodeId)
      return
    const {
      workflowRunningData,
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setShowInputsPanel,
      setShowEnvPanel,
      setShowGlobalVariablePanel,
      setListeningTriggerType,
      setListeningTriggerNodeId,
      setListeningTriggerNodeIds,
      setListeningTriggerIsAll,
    } = workflowStore.getState()

    if (workflowRunningData?.result.status === WorkflowRunningStatus.Running)
      return

    const { getNodes } = store.getState()
    const nodes = getNodes()
    const pluginNode = nodes.find(node => node.id === nodeId && node.data.type === BlockEnum.TriggerPlugin)

    if (!pluginNode) {
      console.warn('handleWorkflowTriggerPluginRunInWorkflow: plugin node not found', nodeId)
      return
    }

    setShowEnvPanel(false)
    setShowGlobalVariablePanel(false)

    if (!showDebugAndPreviewPanel)
      setShowDebugAndPreviewPanel(true)

    setShowInputsPanel(false)
    setListeningTriggerType(BlockEnum.TriggerPlugin)
    setListeningTriggerNodeId(nodeId)
    setListeningTriggerNodeIds([nodeId])
    setListeningTriggerIsAll(false)

    await doSyncWorkflowDraft()
    handleRun(
      { node_id: nodeId },
      undefined,
      {
        mode: TriggerType.Plugin,
        pluginNodeId: nodeId,
      },
    )
  }, [store, workflowStore, handleRun, doSyncWorkflowDraft])

  const handleWorkflowRunAllTriggersInWorkflow = useCallback(async (nodeIds: string[]) => {
    if (!nodeIds.length)
      return
    const {
      workflowRunningData,
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setShowInputsPanel,
      setShowEnvPanel,
      setShowGlobalVariablePanel,
      setListeningTriggerIsAll,
      setListeningTriggerNodeIds,
      setListeningTriggerNodeId,
    } = workflowStore.getState()

    if (workflowRunningData?.result.status === WorkflowRunningStatus.Running)
      return

    setShowEnvPanel(false)
    setShowGlobalVariablePanel(false)
    setShowInputsPanel(false)
    setListeningTriggerIsAll(true)
    setListeningTriggerNodeIds(nodeIds)
    setListeningTriggerNodeId(null)

    if (!showDebugAndPreviewPanel)
      setShowDebugAndPreviewPanel(true)

    await doSyncWorkflowDraft()
    handleRun(
      { node_ids: nodeIds },
      undefined,
      {
        mode: TriggerType.All,
        allNodeIds: nodeIds,
      },
    )
  }, [store, workflowStore, handleRun, doSyncWorkflowDraft])

  const handleWorkflowStartRunInChatflow = useCallback(async () => {
    const {
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setHistoryWorkflowData,
      setShowEnvPanel,
      setShowChatVariablePanel,
      setShowGlobalVariablePanel,
    } = workflowStore.getState()

    setShowEnvPanel(false)
    setShowChatVariablePanel(false)
    setShowGlobalVariablePanel(false)

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
    handleWorkflowTriggerScheduleRunInWorkflow,
    handleWorkflowTriggerWebhookRunInWorkflow,
    handleWorkflowTriggerPluginRunInWorkflow,
    handleWorkflowRunAllTriggersInWorkflow,
  }
}
