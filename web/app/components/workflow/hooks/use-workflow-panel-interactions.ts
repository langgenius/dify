import { useCallback } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useStore, useWorkflowStore } from '../store'
import { ControlMode, WorkflowRunningStatus } from '../types'
import { useEdgesInteractionsWithoutSync } from './use-edges-interactions-without-sync'
import { useNodesInteractionsWithoutSync } from './use-nodes-interactions-without-sync'
import { useSelectionInteractions } from './use-selection-interactions'
import { useNodesReadOnly } from './use-workflow'

export const useWorkflowInteractions = () => {
  const workflowStore = useWorkflowStore()
  const { handleNodeCancelRunningStatus } = useNodesInteractionsWithoutSync()
  const { handleEdgeCancelRunningStatus } = useEdgesInteractionsWithoutSync()

  const handleCancelDebugAndPreviewPanel = useCallback(() => {
    const { workflowRunningData } = workflowStore.getState()
    const runningStatus = workflowRunningData?.result?.status
    const isActiveRun = runningStatus === WorkflowRunningStatus.Running || runningStatus === WorkflowRunningStatus.Waiting
    workflowStore.setState({
      showDebugAndPreviewPanel: false,
      workflowRunningData: isActiveRun ? workflowRunningData : undefined,
    })
    if (!isActiveRun) {
      handleNodeCancelRunningStatus()
      handleEdgeCancelRunningStatus()
    }
  }, [workflowStore, handleNodeCancelRunningStatus, handleEdgeCancelRunningStatus])

  const handleClearWorkflowRunHistory = useCallback(() => {
    workflowStore.setState({
      workflowRunningData: undefined,
      inputs: {},
      files: [],
    })
    handleNodeCancelRunningStatus()
    handleEdgeCancelRunningStatus()
  }, [workflowStore, handleNodeCancelRunningStatus, handleEdgeCancelRunningStatus])

  return {
    handleCancelDebugAndPreviewPanel,
    handleClearWorkflowRunHistory,
  }
}

export const useWorkflowMoveMode = () => {
  const setControlMode = useStore(s => s.setControlMode)
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleSelectionCancel } = useSelectionInteractions()
  const isCollaborationEnabled = useGlobalPublicStore(s => s.systemFeatures.enable_collaboration_mode)
  const appDetail = useAppStore(state => state.appDetail)
  const isCommentModeAvailable = isCollaborationEnabled && (appDetail?.mode === 'workflow' || appDetail?.mode === 'advanced-chat')

  const handleModePointer = useCallback(() => {
    if (getNodesReadOnly())
      return

    setControlMode(ControlMode.Pointer)
  }, [getNodesReadOnly, setControlMode])

  const handleModeHand = useCallback(() => {
    if (getNodesReadOnly())
      return

    setControlMode(ControlMode.Hand)
    handleSelectionCancel()
  }, [getNodesReadOnly, handleSelectionCancel, setControlMode])

  const handleModeComment = useCallback(() => {
    if (getNodesReadOnly() || !isCommentModeAvailable)
      return

    setControlMode(ControlMode.Comment)
    handleSelectionCancel()
  }, [getNodesReadOnly, handleSelectionCancel, isCommentModeAvailable, setControlMode])

  return {
    handleModePointer,
    handleModeHand,
    handleModeComment,
    isCommentModeAvailable,
  }
}
