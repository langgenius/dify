import { useCallback, useEffect, useRef } from 'react'
import { DEFAULT_ITER_TIMES, DEFAULT_LOOP_TIMES } from '../../../constants'
import { useEdgesInteractionsWithoutSync } from '../../../hooks/use-edges-interactions-without-sync'
import { useNodesInteractionsWithoutSync } from '../../../hooks/use-nodes-interactions-without-sync'
import { useStore, useWorkflowStore } from '../../../store'
import { WorkflowRunningStatus } from '../../../types'

type UseChatFlowControlParams = {
  stopChat?: (taskId: string) => void
}

export function useChatFlowControl({
  stopChat,
}: UseChatFlowControlParams) {
  const workflowStore = useWorkflowStore()
  const setIsResponding = useStore(s => s.setIsResponding)
  const resetChatPreview = useStore(s => s.resetChatPreview)
  const setActiveTaskId = useStore(s => s.setActiveTaskId)
  const setHasStopResponded = useStore(s => s.setHasStopResponded)
  const setSuggestedQuestionsAbortController = useStore(s => s.setSuggestedQuestionsAbortController)
  const invalidateRun = useStore(s => s.invalidateRun)

  const isMountedRef = useRef(true)
  useEffect(() => () => {
    isMountedRef.current = false
  }, [])

  const { handleNodeCancelRunningStatus } = useNodesInteractionsWithoutSync(isMountedRef)
  const { handleEdgeCancelRunningStatus } = useEdgesInteractionsWithoutSync(isMountedRef)

  const { setIterTimes, setLoopTimes } = workflowStore.getState()

  const handleResponding = useCallback((responding: boolean) => {
    setIsResponding(responding)
  }, [setIsResponding])

  const handleStop = useCallback(() => {
    const {
      activeTaskId,
      suggestedQuestionsAbortController,
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()
    const runningStatus = workflowRunningData?.result?.status
    const isActiveRun = runningStatus === WorkflowRunningStatus.Running || runningStatus === WorkflowRunningStatus.Waiting
    setHasStopResponded(true)
    handleResponding(false)
    if (stopChat && activeTaskId)
      stopChat(activeTaskId)
    setIterTimes(DEFAULT_ITER_TIMES)
    setLoopTimes(DEFAULT_LOOP_TIMES)
    if (suggestedQuestionsAbortController)
      suggestedQuestionsAbortController.abort()
    setSuggestedQuestionsAbortController(null)
    setActiveTaskId('')
    invalidateRun()
    if (isActiveRun && workflowRunningData) {
      setWorkflowRunningData({
        ...workflowRunningData,
        result: {
          ...workflowRunningData.result,
          status: WorkflowRunningStatus.Stopped,
        },
      })
    }
    if (isActiveRun) {
      handleNodeCancelRunningStatus()
      handleEdgeCancelRunningStatus()
    }
  }, [
    handleResponding,
    setIterTimes,
    setLoopTimes,
    stopChat,
    workflowStore,
    setHasStopResponded,
    setSuggestedQuestionsAbortController,
    setActiveTaskId,
    invalidateRun,
    handleNodeCancelRunningStatus,
    handleEdgeCancelRunningStatus,
  ])

  const handleRestart = useCallback(() => {
    handleStop()
    resetChatPreview()
    setIterTimes(DEFAULT_ITER_TIMES)
    setLoopTimes(DEFAULT_LOOP_TIMES)
  }, [handleStop, setIterTimes, setLoopTimes, resetChatPreview])

  return {
    handleResponding,
    handleStop,
    handleRestart,
  }
}
