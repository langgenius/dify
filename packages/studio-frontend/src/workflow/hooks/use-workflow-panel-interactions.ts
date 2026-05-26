import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store/index'
import { ControlMode } from '@/app/components/workflow/types'
import { useEdgesInteractionsWithoutSync } from '@/app/components/workflow/hooks/use-edges-interactions-without-sync'
import { useNodesInteractionsWithoutSync } from '@/app/components/workflow/hooks/use-nodes-interactions-without-sync'
import { useSelectionInteractions } from '@/app/components/workflow/hooks/use-selection-interactions'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'

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
  const { data: isCommentModeAvailable } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_collaboration_mode,
  })

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
