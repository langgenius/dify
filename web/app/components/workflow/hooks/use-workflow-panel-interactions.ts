import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { editorCollaborationEnabledAtom } from '../editor-resource/state'
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
  const workflowStore = useWorkflowStore()
  const setControlMode = useStore((s) => s.setControlMode)
  const workflowRunningData = useStore((s) => s.workflowRunningData)
  const historyWorkflowData = useStore((s) => s.historyWorkflowData)
  const isRestoring = useStore((s) => s.isRestoring)
  const { nodesReadOnly, getNodesReadOnly } = useNodesReadOnly()
  const canvasReadOnly = useStore((state) => state.canvasReadOnly)
  const moveModeReadOnly = nodesReadOnly && !canvasReadOnly
  const { handleSelectionCancel } = useSelectionInteractions()
  const isCommentModeAvailable = useAtomValue(editorCollaborationEnabledAtom)
  const isCommentModeOperationBlocked = !!(
    workflowRunningData?.result.status === WorkflowRunningStatus.Running ||
    workflowRunningData?.result.status === WorkflowRunningStatus.Paused ||
    historyWorkflowData ||
    isRestoring
  )
  const canUseCommentMode = !!(!isCommentModeOperationBlocked && isCommentModeAvailable)

  const handleModePointer = useCallback(() => {
    if (getNodesReadOnly() && !workflowStore.getState().canvasReadOnly) return

    setControlMode(ControlMode.Pointer)
  }, [getNodesReadOnly, setControlMode, workflowStore])

  const handleModeHand = useCallback(() => {
    if (getNodesReadOnly() && !workflowStore.getState().canvasReadOnly) return

    setControlMode(ControlMode.Hand)
    handleSelectionCancel()
  }, [getNodesReadOnly, handleSelectionCancel, setControlMode, workflowStore])

  const handleModeComment = useCallback(() => {
    if (!canUseCommentMode) return

    setControlMode(ControlMode.Comment)
    handleSelectionCancel()
  }, [canUseCommentMode, handleSelectionCancel, setControlMode])

  return {
    handleModePointer,
    handleModeHand,
    handleModeComment,
    isCommentModeAvailable,
    canUseCommentMode,
    moveModeReadOnly,
  }
}
