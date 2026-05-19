import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { AppSourceType } from '@/service/share'
import { useBoolean } from 'ahooks'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  stopChatMessageResponding,
  stopWorkflowMessage,
  updateFeedback,
} from '@/service/share'

type Notify = (payload: { type: 'error', message: string }) => void

type RunControlState = {
  currentTaskId: string | null
  isStopping: boolean
}

type RunControlAction
  = | { type: 'reset' }
    | { type: 'setCurrentTaskId', value: SetStateAction<string | null> }
    | { type: 'setIsStopping', value: SetStateAction<boolean> }

type UseResultRunStateOptions = {
  appId?: string
  appSourceType: AppSourceType
  controlStopResponding?: number
  isWorkflow: boolean
  notify: Notify
  onRunControlChange?: (control: { onStop: () => Promise<void> | void, isStopping: boolean } | null) => void
}

export type ResultRunStateController = {
  abortControllerRef: MutableRefObject<AbortController | null>
  clearMoreLikeThis: () => void
  completionRes: string
  controlClearMoreLikeThis: number
  currentTaskId: string | null
  feedback: FeedbackType
  getCompletionRes: () => string
  getWorkflowProcessData: () => WorkflowProcess | undefined
  handleFeedback: (feedback: FeedbackType) => Promise<void>
  handleStop: () => Promise<void>
  isResponding: boolean
  isStopping: boolean
  messageId: string | null
  prepareForNewRun: () => void
  resetRunState: () => void
  setCompletionRes: (res: string) => void
  setCurrentTaskId: Dispatch<SetStateAction<string | null>>
  setIsStopping: Dispatch<SetStateAction<boolean>>
  setMessageId: Dispatch<SetStateAction<string | null>>
  setRespondingFalse: () => void
  setRespondingTrue: () => void
  setWorkflowProcessData: (data: WorkflowProcess | undefined) => void
  workflowProcessData: WorkflowProcess | undefined
}

const runControlReducer = (state: RunControlState, action: RunControlAction): RunControlState => {
  switch (action.type) {
    case 'reset':
      return {
        currentTaskId: null,
        isStopping: false,
      }
    case 'setCurrentTaskId':
      return {
        ...state,
        currentTaskId: typeof action.value === 'function' ? action.value(state.currentTaskId) : action.value,
      }
    case 'setIsStopping':
      return {
        ...state,
        isStopping: typeof action.value === 'function' ? action.value(state.isStopping) : action.value,
      }
  }
}

export const useResultRunState = ({
  appId,
  appSourceType,
  controlStopResponding,
  isWorkflow,
  notify,
  onRunControlChange,
}: UseResultRunStateOptions): ResultRunStateController => {
  const [isResponding, { setTrue: setRespondingTrue, setFalse: setRespondingFalse }] = useBoolean(false)
  const [completionResState, setCompletionResState] = useState<string>('')
  const completionResRef = useRef<string>('')
  const [workflowProcessDataState, setWorkflowProcessDataState] = useState<WorkflowProcess>()
  const workflowProcessDataRef = useRef<WorkflowProcess | undefined>(undefined)
  const [messageId, setMessageId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<FeedbackType>({
    rating: null,
  })
  const [controlClearMoreLikeThis, setControlClearMoreLikeThis] = useState(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [{ currentTaskId, isStopping }, dispatchRunControl] = useReducer(runControlReducer, {
    currentTaskId: null,
    isStopping: false,
  })

  const setCurrentTaskId = useCallback<Dispatch<SetStateAction<string | null>>>((value) => {
    dispatchRunControl({
      type: 'setCurrentTaskId',
      value,
    })
  }, [])

  const setIsStopping = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    dispatchRunControl({
      type: 'setIsStopping',
      value,
    })
  }, [])

  const setCompletionRes = useCallback((res: string) => {
    completionResRef.current = res
    setCompletionResState(res)
  }, [])

  const getCompletionRes = useCallback(() => completionResRef.current, [])

  const setWorkflowProcessData = useCallback((data: WorkflowProcess | undefined) => {
    workflowProcessDataRef.current = data
    setWorkflowProcessDataState(data)
  }, [])

  const getWorkflowProcessData = useCallback(() => workflowProcessDataRef.current, [])

  const resetRunState = useCallback(() => {
    dispatchRunControl({ type: 'reset' })
    abortControllerRef.current = null
    onRunControlChange?.(null)
  }, [onRunControlChange])

  const prepareForNewRun = useCallback(() => {
    setMessageId(null)
    setFeedback({ rating: null })
    setCompletionRes('')
    setWorkflowProcessData(undefined)
    resetRunState()
  }, [resetRunState, setCompletionRes, setWorkflowProcessData])

  const handleFeedback = useCallback(async (nextFeedback: FeedbackType) => {
    await updateFeedback({
      url: `/messages/${messageId}/feedbacks`,
      body: {
        rating: nextFeedback.rating,
        content: nextFeedback.content,
      },
    }, appSourceType, appId)
    setFeedback(nextFeedback)
  }, [appId, appSourceType, messageId])

  const handleStop = useCallback(async () => {
    if (!currentTaskId || isStopping)
      return

    setIsStopping(true)
    try {
      if (isWorkflow)
        await stopWorkflowMessage(appId!, currentTaskId, appSourceType, appId || '')
      else
        await stopChatMessageResponding(appId!, currentTaskId, appSourceType, appId || '')

      abortControllerRef.current?.abort()
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      notify({ type: 'error', message })
    }
    finally {
      setIsStopping(false)
    }
  }, [appId, appSourceType, currentTaskId, isStopping, isWorkflow, notify, setIsStopping])

  const clearMoreLikeThis = useCallback(() => {
    setControlClearMoreLikeThis(Date.now())
  }, [])

  useEffect(() => {
    const abortCurrentRequest = () => {
      abortControllerRef.current?.abort()
    }

    if (controlStopResponding) {
      abortCurrentRequest()
      setRespondingFalse()
      resetRunState()
    }

    return abortCurrentRequest
  }, [controlStopResponding, resetRunState, setRespondingFalse])

  useEffect(() => {
    if (!onRunControlChange)
      return

    if (isResponding && currentTaskId) {
      onRunControlChange({
        onStop: handleStop,
        isStopping,
      })
      return
    }

    onRunControlChange(null)
  }, [currentTaskId, handleStop, isResponding, isStopping, onRunControlChange])

  return {
    abortControllerRef,
    clearMoreLikeThis,
    completionRes: completionResState,
    controlClearMoreLikeThis,
    currentTaskId,
    feedback,
    getCompletionRes,
    getWorkflowProcessData,
    handleFeedback,
    handleStop,
    isResponding,
    isStopping,
    messageId,
    prepareForNewRun,
    resetRunState,
    setCompletionRes,
    setCurrentTaskId,
    setIsStopping,
    setMessageId,
    setRespondingFalse,
    setRespondingTrue,
    setWorkflowProcessData,
    workflowProcessData: workflowProcessDataState,
  }
}
