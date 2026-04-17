import { useCallback } from 'react'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useStore, useWorkflowStore } from '../store'
import { ControlMode } from '../types'
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
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleSelectionCancel } = useSelectionInteractions()
  const isCommentModeAvailable = useGlobalPublicStore(s => s.systemFeatures.enable_collaboration_mode)

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
