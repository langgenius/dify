import type { TextGenerationTranslate } from '../../types'
import type { WorkflowRunSnapshot } from '../../workflow-run-configuration'
import type { ResultInputValue } from '../result-request'
import type { ResultRunStateController } from './use-result-run-state'
import type { PromptConfig } from '@/models/debug'
import type { VisionFile, VisionSettings } from '@/types/app'
import { useCallback, useEffect, useRef } from 'react'
import { trackWebAppEvent } from '@/app/components/base/amplitude/web-app-event'
import { useOptionalWebAppConnections } from '@/app/components/share/connections/use-connections'
import { TEXT_GENERATION_TIMEOUT_MS } from '@/config'
import { useWebAppStore } from '@/context/web-app-context'
import {
  captureAppAccessScope,
  hasAppAccessError,
  isAppAccessScopeCurrent,
} from '@/features/app-access-error/state'
import { AppSourceType, sendCompletionMessage, sendWorkflowMessage } from '@/service/share'
import { sleep } from '@/utils'
import {
  captureWorkflowRunConfiguration,
  isWorkflowRunSnapshotCurrent,
} from '../../workflow-run-configuration'
import { buildResultRequestData, validateResultRequest } from '../result-request'
import { createWorkflowStreamHandlers } from '../workflow-stream-handlers'

type Notify = (payload: { type: 'error' | 'info' | 'warning'; message: string }) => void
type UseResultSenderOptions = {
  runSnapshot?: WorkflowRunSnapshot
  onTaskStart?: (taskId?: number) => void
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
  t: TextGenerationTranslate
  taskId?: number
  visionConfig: VisionSettings
}

const logRequestError = (notify: Notify, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  notify({ type: 'error', message })
}

export const useResultSender = ({
  runSnapshot,
  onTaskStart,
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
  const connections = useOptionalWebAppConnections()
  const { clearMoreLikeThis } = runState
  const appMode = useWebAppStore((state) => state.appInfo?.mode)

  const handleSend = useCallback(
    async (useAcceptedSnapshot = false) => {
      let snapshot: WorkflowRunSnapshot | false | undefined
      if (isWorkflow && appSourceType === AppSourceType.webApp) {
        snapshot =
          useAcceptedSnapshot && runSnapshot
            ? runSnapshot
            : captureWorkflowRunConfiguration(connections)
      }
      if (snapshot === false || (snapshot && !isWorkflowRunSnapshotCurrent(snapshot))) {
        if (isCallBatchAPI && taskId !== undefined) onCompleted('', taskId, false)
        return false
      }
      if (runState.isResponding) {
        notify({
          type: 'info',
          message: t(($) => $['errorMessage.waitForResponse'], { ns: 'appDebug' }),
        })
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
        if (isCallBatchAPI && taskId !== undefined) onCompleted('', taskId, false)
        return false
      }

      const data = buildResultRequestData({
        completionFiles,
        inputs,
        promptConfig,
        visionConfig,
      })
      const appAccessScope = appSourceType === AppSourceType.webApp ? captureAppAccessScope() : null

      onTaskStart?.(taskId)
      runState.prepareForNewRun()

      if (!isPC) {
        onShowRes()
        onRunStart()
      }

      runState.setRespondingTrue()

      if (appSourceType === AppSourceType.webApp && appMode)
        trackWebAppEvent('webapp_run', { app_mode: appMode })

      let isEnd = false
      let isTimeout = false
      let completionChunks: string[] = []
      let tempMessageId = ''
      const stopInactiveRequest = () => {
        if (isAppAccessScopeCurrent(appAccessScope) && !hasAppAccessError(appAccessScope))
          return false

        if (!isEnd) {
          runState.setRespondingFalse()
          runState.resetRunState()
          if (!isTimeout) onCompleted(runState.getCompletionRes(), taskId, false)
          isEnd = true
        }
        return true
      }

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

        const workflowData = snapshot?.configuration ? { ...data, ...snapshot.configuration } : data
        void sendWorkflowMessage(workflowData, otherOptions, appSourceType, appId).catch(
          (error) => {
            if (stopInactiveRequest()) return
            runState.setRespondingFalse()
            runState.resetRunState()
            logRequestError(notify, error)
            if (!isEnd && !isTimeout) onCompleted(runState.getCompletionRes(), taskId, false)
            isEnd = true
          },
        )
        return true
      }

      void sendCompletionMessage(
        data,
        {
          onData: (chunk, _isFirstMessage, { messageId, taskId: nextTaskId }) => {
            tempMessageId = messageId
            if (nextTaskId && nextTaskId.trim() !== '')
              runState.setCurrentTaskId((prev) => prev ?? nextTaskId)

            completionChunks.push(chunk)
            runState.setCompletionRes(completionChunks.join(''))
          },
          onCompleted: () => {
            if (stopInactiveRequest()) return
            if (isTimeout) {
              notify({
                type: 'warning',
                message: t(($) => $['warningMessage.timeoutExceeded'], { ns: 'appDebug' }),
              })
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
            if (stopInactiveRequest()) return
            if (isTimeout) {
              notify({
                type: 'warning',
                message: t(($) => $['warningMessage.timeoutExceeded'], { ns: 'appDebug' }),
              })
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
        },
        appSourceType,
        appId,
      )

      return true
    },
    [
      runSnapshot,
      connections,
      onTaskStart,
      appId,
      appMode,
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
    ],
  )

  const handleSendRef = useRef(handleSend)

  useEffect(() => {
    handleSendRef.current = handleSend
  }, [handleSend])

  useEffect(() => {
    if (!controlSend) return

    void handleSendRef.current(true).then((accepted) => {
      if (accepted) clearMoreLikeThis()
    })
  }, [clearMoreLikeThis, controlSend])

  useEffect(() => {
    if (!controlRetry) return

    void handleSendRef.current(true)
  }, [controlRetry])

  return {
    handleSend,
  }
}
