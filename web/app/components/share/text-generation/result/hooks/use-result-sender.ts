import type { MutableRefObject } from 'react'
import type { TextGenerationTranslate } from '../../types'
import type { ResultInputValue } from '../result-request'
import type { ResultRunStateController } from './use-result-run-state'
import type AudioPlayer from '@/app/components/base/audio-btn/audio'
import type { PromptConfig } from '@/models/debug'
import type { VisionFile, VisionSettings } from '@/types/app'
import { useCallback, useEffect, useRef } from 'react'
import { v4 as uuidV4 } from 'uuid'
import { AudioPlayerManager } from '@/app/components/base/audio-btn/audio.player.manager'
import { TEXT_GENERATION_TIMEOUT_MS } from '@/config'
import { AppSourceType, getUrl, sendCompletionMessage, sendWorkflowMessage } from '@/service/share'
import { sleep } from '@/utils'
import { buildResultRequestData, validateResultRequest } from '../result-request'
import { createWorkflowStreamHandlers } from '../workflow-stream-handlers'

type Notify = (payload: { type: 'error' | 'info' | 'warning'; message: string }) => void
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
  t: TextGenerationTranslate
  taskId?: number
  ttsAutoPlayEnabled?: boolean
  visionConfig: VisionSettings
  autoTTSPlayerRef?: MutableRefObject<AudioPlayer | null>
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
  ttsAutoPlayEnabled = false,
  visionConfig,
  autoTTSPlayerRef: providedAutoTTSPlayerRef,
}: UseResultSenderOptions) => {
  const { clearMoreLikeThis } = runState
  const fallbackAutoTTSPlayerRef = useRef<AudioPlayer | null>(null)
  const autoTTSPlayerRef = providedAutoTTSPlayerRef ?? fallbackAutoTTSPlayerRef

  const handleSend = useCallback(
    async (preparedPlayerId?: string) => {
      let player = autoTTSPlayerRef.current
      let acceptsTTS = true
      const destroyAutoTTSPlayer = () => {
        acceptsTTS = false
        if (player) AudioPlayerManager.getInstance().destroyAutoPlayAudioPlayer(player)
        if (autoTTSPlayerRef.current === player) autoTTSPlayerRef.current = null
      }
      const releasePreparedPlayer = () => {
        if (player) AudioPlayerManager.getInstance().destroyAutoPlayAudioPlayer(player)
        if (autoTTSPlayerRef.current === player) autoTTSPlayerRef.current = null
        player = null
      }

      if (runState.isResponding) {
        destroyAutoTTSPlayer()
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
        destroyAutoTTSPlayer()
        notify(validation.notification!)
        return false
      }

      const data = buildResultRequestData({
        completionFiles,
        inputs,
        promptConfig,
        visionConfig,
      })

      if (!preparedPlayerId) releasePreparedPlayer()

      const getOrCreatePlayer = () => {
        if (!acceptsTTS) return null
        if (player && autoTTSPlayerRef.current !== player) {
          acceptsTTS = false
          return null
        }
        if (!player) {
          player = AudioPlayerManager.getInstance().getAutoPlayAudioPlayer(
            getUrl('text-to-audio', appSourceType, appId || ''),
            appSourceType === AppSourceType.webApp,
            preparedPlayerId || uuidV4(),
            'none',
            'none',
            null,
          )
          autoTTSPlayerRef.current = player
        }

        return player
      }

      if (ttsAutoPlayEnabled) getOrCreatePlayer()?.preparePlayback()

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
          destroyAutoTTSPlayer()
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
          onStreamError: destroyAutoTTSPlayer,
          resetRunState: runState.resetRunState,
          setCompletionRes: runState.setCompletionRes,
          setCurrentTaskId: runState.setCurrentTaskId,
          setIsStopping: runState.setIsStopping,
          setMessageId: runState.setMessageId,
          setRespondingFalse: runState.setRespondingFalse,
          setWorkflowProcessData: runState.setWorkflowProcessData,
          t,
          taskId,
          getOrCreatePlayer: ttsAutoPlayEnabled ? getOrCreatePlayer : undefined,
        })

        void sendWorkflowMessage(data, otherOptions, appSourceType, appId).catch((error) => {
          destroyAutoTTSPlayer()
          runState.setRespondingFalse()
          runState.resetRunState()
          logRequestError(notify, error)
        })
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
            destroyAutoTTSPlayer()
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
          onTTSChunk: ttsAutoPlayEnabled
            ? (_messageId, audio) => {
                const player = getOrCreatePlayer()
                if (audio && player) void player.playAudioWithAudio(audio, true)
              }
            : undefined,
          onTTSEnd: ttsAutoPlayEnabled
            ? (_messageId, audio) => {
                const player = getOrCreatePlayer()
                if (player) void player.playAudioWithAudio(audio, false)
              }
            : undefined,
        },
        appSourceType,
        appId,
      )

      return true
    },
    [
      appId,
      appSourceType,
      autoTTSPlayerRef,
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
      ttsAutoPlayEnabled,
      visionConfig,
    ],
  )

  const handleSendRef = useRef(handleSend)

  useEffect(() => {
    handleSendRef.current = handleSend
  }, [handleSend])

  useEffect(() => {
    if (!controlSend) return

    void handleSendRef.current(`text-generation-${controlSend}`)
    clearMoreLikeThis()
  }, [clearMoreLikeThis, controlSend])

  useEffect(() => {
    if (!controlRetry) return

    void handleSendRef.current()
  }, [controlRetry])

  return {
    handleSend,
  }
}
