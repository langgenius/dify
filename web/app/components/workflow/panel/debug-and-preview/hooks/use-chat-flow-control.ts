import type { RefObject } from 'react'
import { useCallback, useRef } from 'react'
import { DEFAULT_ITER_TIMES, DEFAULT_LOOP_TIMES } from '../../../constants'
import { useStore, useWorkflowStore } from '../../../store'

type UseChatFlowControlParams = {
  stopChat?: (taskId: string) => void
  suggestedQuestionsAbortControllerRef: RefObject<AbortController | null>
}

export function useChatFlowControl({
  stopChat,
  suggestedQuestionsAbortControllerRef,
}: UseChatFlowControlParams) {
  const workflowStore = useWorkflowStore()
  const setIsResponding = useStore(s => s.setIsResponding)
  const resetChatPreview = useStore(s => s.resetChatPreview)

  const hasStopResponded = useRef(false)
  const taskIdRef = useRef('')

  const { setIterTimes, setLoopTimes } = workflowStore.getState()

  const handleResponding = useCallback((responding: boolean) => {
    setIsResponding(responding)
  }, [setIsResponding])

  const handleStop = useCallback(() => {
    hasStopResponded.current = true
    handleResponding(false)
    if (stopChat && taskIdRef.current)
      stopChat(taskIdRef.current)
    setIterTimes(DEFAULT_ITER_TIMES)
    setLoopTimes(DEFAULT_LOOP_TIMES)
    if (suggestedQuestionsAbortControllerRef.current)
      suggestedQuestionsAbortControllerRef.current.abort()
  }, [handleResponding, setIterTimes, setLoopTimes, stopChat, suggestedQuestionsAbortControllerRef])

  const handleRestart = useCallback(() => {
    taskIdRef.current = ''
    handleStop()
    resetChatPreview()
    setIterTimes(DEFAULT_ITER_TIMES)
    setLoopTimes(DEFAULT_LOOP_TIMES)
  }, [handleStop, setIterTimes, setLoopTimes, resetChatPreview])

  return {
    hasStopResponded,
    taskIdRef,
    handleResponding,
    handleStop,
    handleRestart,
  }
}
