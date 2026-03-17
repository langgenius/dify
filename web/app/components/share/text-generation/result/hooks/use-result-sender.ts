import type { ResultInputValue } from '../result-request'
import type { ResultRunStateController } from './use-result-run-state'
import type { PromptConfig } from '@/models/debug'
import type { VisionFile, VisionSettings } from '@/types/app'
import { useCallback, useEffect, useRef } from 'react'
import { TEXT_GENERATION_TIMEOUT_MS } from '@/config'
import {
  AppSourceType,
  sendCompletionMessage,
  sendWorkflowMessage,
} from '@/service/share'
import { sleep } from '@/utils'
import { buildResultRequestData, validateResultRequest } from '../result-request'
import { createWorkflowStreamHandlers } from '../workflow-stream-handlers'

type Notify = (payload: { type: 'error' | 'info' | 'warning', message: string }) => void
type Translate = (key: string, options?: Record<string, unknown>) => string

type UseResultSenderOptions = {
  appId?: string
  appSourceType: AppSourceType
  completionFiles: VisionFile[]
  controlRetry?: number
  controlSend?: number
  inputs: Record<string, ResultInputValue>
  isCallBatchAPI: boolean
  isPC: boolean
  isWorkflow: boolean
  notify: Notify
  onCompleted: (completionRes: string, taskId?: number, success?: boolean) => void
  onRunStart: () => void
  onShowRes: () => void
  promptConfig: PromptConfig | null
  runState: ResultRunStateController
  t: Translate
  taskId?: number
  visionConfig: VisionSettings
}

const logRequestError = (notify: Notify, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  notify({ type: 'error', message })
}

export const useResultSender = ({
  appId,
  appSourceType,
  completionFiles,
  controlRetry,
  controlSend,
  inputs,
  isCallBatchAPI,
  isPC,
  isWorkflow,
  notify,
  onCompleted,
  onRunStart,
  onShowRes,
  promptConfig,
  runState,
  t,
  taskId,
  visionConfig,
}: UseResultSenderOptions) => {
  const { clearMoreLikeThis } = runState

  const handleSend = useCallback(async () => {
    if (runState.isResponding) {
      notify({ type: 'info', message: t('errorMessage.waitForResponse', { ns: 'appDebug' }) })
      return false
    }

    const validation = validateResultRequest({
      completionFiles,
      inputs,
      isCallBatchAPI,
      promptConfig,
      t,
    })
    if (!validation.canSend) {
      notify(validation.notification!)
      return false
    }

    const data = buildResultRequestData({
      completionFiles,
      inputs,
      promptConfig,
      visionConfig,
    })

    runState.prepareForNewRun()

    if (!isPC) {
      onShowRes()
      onRunStart()
    }

    runState.setRespondingTrue()

    let isEnd = false
    let isTimeout = false
    let completionChunks: string[] = []
    let tempMessageId = ''

    void (async () => {
      await sleep(TEXT_GENERATION_TIMEOUT_MS)
      if (!isEnd) {
        runState.setRespondingFalse()
        onCompleted(runState.getCompletionRes(), taskId, false)
        runState.resetRunState()
        isTimeout = true
      }
    })()

    if (isWorkflow) {
      const otherOptions = createWorkflowStreamHandlers({
        getCompletionRes: runState.getCompletionRes,
        getWorkflowProcessData: runState.getWorkflowProcessData,
        isPublicAPI: appSourceType === AppSourceType.webApp,
        isTimedOut: () => isTimeout,
        markEnded: () => {
          isEnd = true
        },
        notify,
        onCompleted,
        resetRunState: runState.resetRunState,
        setCompletionRes: runState.setCompletionRes,
        setCurrentTaskId: runState.setCurrentTaskId,
        setIsStopping: runState.setIsStopping,
        setMessageId: runState.setMessageId,
        setRespondingFalse: runState.setRespondingFalse,
        setWorkflowProcessData: runState.setWorkflowProcessData,
        t,
        taskId,
      })

      void sendWorkflowMessage(data, otherOptions, appSourceType, appId).catch((error) => {
        runState.setRespondingFalse()
        runState.resetRunState()
        logRequestError(notify, error)
      })
      return true
    }

    void sendCompletionMessage(data, {
      onData: (chunk, _isFirstMessage, { messageId, taskId: nextTaskId }) => {
        tempMessageId = messageId
        if (nextTaskId && nextTaskId.trim() !== '')
          runState.setCurrentTaskId(prev => prev ?? nextTaskId)

        completionChunks.push(chunk)
        runState.setCompletionRes(completionChunks.join(''))
      },
      onCompleted: () => {
        if (isTimeout) {
          notify({ type: 'warning', message: t('warningMessage.timeoutExceeded', { ns: 'appDebug' }) })
          return
        }

        runState.setRespondingFalse()
        runState.resetRunState()
        runState.setMessageId(tempMessageId)
        onCompleted(runState.getCompletionRes(), taskId, true)
        isEnd = true
      },
      onMessageReplace: (messageReplace) => {
        completionChunks = [messageReplace.answer]
        runState.setCompletionRes(completionChunks.join(''))
      },
      onError: () => {
        if (isTimeout) {
          notify({ type: 'warning', message: t('warningMessage.timeoutExceeded', { ns: 'appDebug' }) })
          return
        }

        runState.setRespondingFalse()
        runState.resetRunState()
        onCompleted(runState.getCompletionRes(), taskId, false)
        isEnd = true
      },
      getAbortController: (abortController) => {
        runState.abortControllerRef.current = abortController
      },
    }, appSourceType, appId)

    return true
  }, [
    appId,
    appSourceType,
    completionFiles,
    inputs,
    isCallBatchAPI,
    isPC,
    isWorkflow,
    notify,
    onCompleted,
    onRunStart,
    onShowRes,
    promptConfig,
    runState,
    t,
    taskId,
    visionConfig,
  ])

  const handleSendRef = useRef(handleSend)

  useEffect(() => {
    handleSendRef.current = handleSend
  }, [handleSend])

  useEffect(() => {
    if (!controlSend)
      return

    void handleSendRef.current()
    clearMoreLikeThis()
  }, [clearMoreLikeThis, controlSend])

  useEffect(() => {
    if (!controlRetry)
      return

    void handleSendRef.current()
  }, [controlRetry])

  return {
    handleSend,
  }
}
