import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useHooksStore } from '../hooks-store'
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
    workflowStore.setState({
      showDebugAndPreviewPanel: false,
      workflowRunningData: undefined,
    })
    handleNodeCancelRunningStatus()
    handleEdgeCancelRunningStatus()
  }, [workflowStore, handleNodeCancelRunningStatus, handleEdgeCancelRunningStatus])

  return {
    handleCancelDebugAndPreviewPanel,
  }
}

export const useWorkflowMoveMode = () => {
  const setControlMode = useStore(s => s.setControlMode)
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const isRestoring = useStore(s => s.isRestoring)
  const canComment = useHooksStore(s => s.accessControl.canComment)
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleSelectionCancel } = useSelectionInteractions()
  const { data: isCommentModeAvailable } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_collaboration_mode,
  })
  const isCommentModeOperationBlocked = !!(
    workflowRunningData?.result.status === WorkflowRunningStatus.Running
    || workflowRunningData?.result.status === WorkflowRunningStatus.Paused
    || historyWorkflowData
    || isRestoring
  )
  const canUseCommentMode = !!(canComment && !isCommentModeOperationBlocked && isCommentModeAvailable)

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
    if (!canUseCommentMode)
      return

    setControlMode(ControlMode.Comment)
    handleSelectionCancel()
  }, [canUseCommentMode, handleSelectionCancel, setControlMode])

  return {
    handleModePointer,
    handleModeHand,
    handleModeComment,
    isCommentModeAvailable,
    canUseCommentMode,
  }
}
