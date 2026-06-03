import type AudioPlayer from '@/app/components/base/audio-btn/audio'
import type { IOtherOptions } from '@/service/base'
import { AudioPlayerManager } from '@/app/components/base/audio-btn/audio.player.manager'
import { sseGet } from '@/service/base'

type ContainerSize = {
  clientWidth: number
  clientHeight: number
}

type WorkflowRunEventHandlers = {
  handleWorkflowStarted: NonNullable<IOtherOptions['onWorkflowStarted']>
  handleWorkflowFinished: NonNullable<IOtherOptions['onWorkflowFinished']>
  handleWorkflowFailed: () => void
  handleWorkflowNodeStarted: (params: Parameters<NonNullable<IOtherOptions['onNodeStarted']>>[0], containerParams: ContainerSize) => void
  handleWorkflowNodeFinished: NonNullable<IOtherOptions['onNodeFinished']>
  handleWorkflowNodeHumanInputRequired: NonNullable<IOtherOptions['onHumanInputRequired']>
  handleWorkflowNodeHumanInputFormFilled: NonNullable<IOtherOptions['onHumanInputFormFilled']>
  handleWorkflowNodeHumanInputFormTimeout: NonNullable<IOtherOptions['onHumanInputFormTimeout']>
  handleWorkflowNodeIterationStarted: (params: Parameters<NonNullable<IOtherOptions['onIterationStart']>>[0], containerParams: ContainerSize) => void
  handleWorkflowNodeIterationNext: NonNullable<IOtherOptions['onIterationNext']>
  handleWorkflowNodeIterationFinished: NonNullable<IOtherOptions['onIterationFinish']>
  handleWorkflowNodeLoopStarted: (params: Parameters<NonNullable<IOtherOptions['onLoopStart']>>[0], containerParams: ContainerSize) => void
  handleWorkflowNodeLoopNext: NonNullable<IOtherOptions['onLoopNext']>
  handleWorkflowNodeLoopFinished: NonNullable<IOtherOptions['onLoopFinish']>
  handleWorkflowNodeRetry: NonNullable<IOtherOptions['onNodeRetry']>
  handleWorkflowAgentLog: NonNullable<IOtherOptions['onAgentLog']>
  handleWorkflowTextChunk: NonNullable<IOtherOptions['onTextChunk']>
  handleWorkflowTextReplace: NonNullable<IOtherOptions['onTextReplace']>
  handleWorkflowPaused: () => void
}

type UserCallbackHandlers = {
  onWorkflowStarted?: IOtherOptions['onWorkflowStarted']
  onWorkflowFinished?: IOtherOptions['onWorkflowFinished']
  onNodeStarted?: IOtherOptions['onNodeStarted']
  onNodeFinished?: IOtherOptions['onNodeFinished']
  onIterationStart?: IOtherOptions['onIterationStart']
  onIterationNext?: IOtherOptions['onIterationNext']
  onIterationFinish?: IOtherOptions['onIterationFinish']
  onLoopStart?: IOtherOptions['onLoopStart']
  onLoopNext?: IOtherOptions['onLoopNext']
  onLoopFinish?: IOtherOptions['onLoopFinish']
  onNodeRetry?: IOtherOptions['onNodeRetry']
  onAgentLog?: IOtherOptions['onAgentLog']
  onError?: IOtherOptions['onError']
  onWorkflowPaused?: IOtherOptions['onWorkflowPaused']
  onHumanInputRequired?: IOtherOptions['onHumanInputRequired']
  onHumanInputFormFilled?: IOtherOptions['onHumanInputFormFilled']
  onHumanInputFormTimeout?: IOtherOptions['onHumanInputFormTimeout']
  onCompleted?: IOtherOptions['onCompleted']
}

type CallbackContext = {
  clientWidth: number
  clientHeight: number
  runHistoryUrl: string
  isInWorkflowDebug: boolean
  fetchInspectVars: (params: Record<string, never>) => void
  invalidAllLastRun: () => void
  invalidateRunHistory: (url: string) => void
  clearAbortController: () => void
  clearListeningState: () => void
  getWorkflowRunningData: () => unknown
  trackWorkflowRunFailed: (params: unknown, workflowData: unknown) => void
  handlers: WorkflowRunEventHandlers
  callbacks: UserCallbackHandlers
  restCallback: IOtherOptions
}

type BaseCallbacksContext = CallbackContext & {
  getOrCreatePlayer: () => AudioPlayer | null
}

type FinalCallbacksContext = CallbackContext & {
  baseSseOptions: IOtherOptions
  player: AudioPlayer | null
  setAbortController: (controller: AbortController) => void
}

export const createBaseWorkflowRunCallbacks = ({
  clientWidth,
  clientHeight,
  runHistoryUrl,
  isInWorkflowDebug,
  fetchInspectVars,
  invalidAllLastRun,
  invalidateRunHistory,
  clearAbortController,
  clearListeningState,
  getWorkflowRunningData,
  trackWorkflowRunFailed,
  handlers,
  callbacks,
  restCallback,
  getOrCreatePlayer,
}: BaseCallbacksContext): IOtherOptions => {
  const {
    handleWorkflowStarted,
    handleWorkflowFinished,
    handleWorkflowFailed,
    handleWorkflowNodeStarted,
    handleWorkflowNodeFinished,
    handleWorkflowNodeHumanInputRequired,
    handleWorkflowNodeHumanInputFormFilled,
    handleWorkflowNodeHumanInputFormTimeout,
    handleWorkflowNodeIterationStarted,
    handleWorkflowNodeIterationNext,
    handleWorkflowNodeIterationFinished,
    handleWorkflowNodeLoopStarted,
    handleWorkflowNodeLoopNext,
    handleWorkflowNodeLoopFinished,
    handleWorkflowNodeRetry,
    handleWorkflowAgentLog,
    handleWorkflowTextChunk,
    handleWorkflowTextReplace,
    handleWorkflowPaused,
  } = handlers
  const {
    onWorkflowStarted,
    onWorkflowFinished,
    onNodeStarted,
    onNodeFinished,
    onIterationStart,
    onIterationNext,
    onIterationFinish,
    onLoopStart,
    onLoopNext,
    onLoopFinish,
    onNodeRetry,
    onAgentLog,
    onError,
    onWorkflowPaused,
    onHumanInputRequired,
    onHumanInputFormFilled,
    onHumanInputFormTimeout,
    onCompleted,
  } = callbacks

  const wrappedOnError: IOtherOptions['onError'] = (params, code) => {
    clearAbortController()
    handleWorkflowFailed()
    const workflowData = getWorkflowRunningData()
    invalidateRunHistory(runHistoryUrl)
    clearListeningState()

    if (onError)
      onError(params, code)

    trackWorkflowRunFailed(params, workflowData)
  }

  const wrappedOnCompleted: IOtherOptions['onCompleted'] = async (hasError, errorMessage) => {
    clearAbortController()
    clearListeningState()
    if (onCompleted)
      onCompleted(hasError, errorMessage)
  }

  const baseSseOptions: IOtherOptions = {
    ...restCallback,
    onWorkflowStarted: (params) => {
      handleWorkflowStarted(params)
      invalidateRunHistory(runHistoryUrl)

      if (onWorkflowStarted)
        onWorkflowStarted(params)
    },
    onWorkflowFinished: (params) => {
      clearListeningState()
      handleWorkflowFinished(params)
      invalidateRunHistory(runHistoryUrl)

      if (onWorkflowFinished)
        onWorkflowFinished(params)
      if (isInWorkflowDebug) {
        fetchInspectVars({})
        invalidAllLastRun()
      }
    },
    onNodeStarted: (params) => {
      handleWorkflowNodeStarted(params, { clientWidth, clientHeight })

      if (onNodeStarted)
        onNodeStarted(params)
    },
    onNodeFinished: (params) => {
      handleWorkflowNodeFinished(params)

      if (onNodeFinished)
        onNodeFinished(params)
    },
    onIterationStart: (params) => {
      handleWorkflowNodeIterationStarted(params, { clientWidth, clientHeight })

      if (onIterationStart)
        onIterationStart(params)
    },
    onIterationNext: (params) => {
      handleWorkflowNodeIterationNext(params)

      if (onIterationNext)
        onIterationNext(params)
    },
    onIterationFinish: (params) => {
      handleWorkflowNodeIterationFinished(params)

      if (onIterationFinish)
        onIterationFinish(params)
    },
    onLoopStart: (params) => {
      handleWorkflowNodeLoopStarted(params, { clientWidth, clientHeight })

      if (onLoopStart)
        onLoopStart(params)
    },
    onLoopNext: (params) => {
      handleWorkflowNodeLoopNext(params)

      if (onLoopNext)
        onLoopNext(params)
    },
    onLoopFinish: (params) => {
      handleWorkflowNodeLoopFinished(params)

      if (onLoopFinish)
        onLoopFinish(params)
    },
    onNodeRetry: (params) => {
      handleWorkflowNodeRetry(params)

      if (onNodeRetry)
        onNodeRetry(params)
    },
    onAgentLog: (params) => {
      handleWorkflowAgentLog(params)

      if (onAgentLog)
        onAgentLog(params)
    },
    onTextChunk: (params) => {
      handleWorkflowTextChunk(params)
    },
    onTextReplace: (params) => {
      handleWorkflowTextReplace(params)
    },
    onTTSChunk: (messageId: string, audio: string) => {
      if (!audio || audio === '')
        return
      const audioPlayer = getOrCreatePlayer()
      if (audioPlayer) {
        audioPlayer.playAudioWithAudio(audio, true)
        AudioPlayerManager.getInstance().resetMsgId(messageId)
      }
    },
    onTTSEnd: (_messageId: string, audio: string) => {
      const audioPlayer = getOrCreatePlayer()
      if (audioPlayer)
        audioPlayer.playAudioWithAudio(audio, false)
    },
    onWorkflowPaused: (params) => {
      handleWorkflowPaused()
      invalidateRunHistory(runHistoryUrl)
      if (onWorkflowPaused)
        onWorkflowPaused(params)
      const url = `/workflow/${params.workflow_run_id}/events`
      sseGet(url, {}, baseSseOptions)
    },
    onHumanInputRequired: (params) => {
      handleWorkflowNodeHumanInputRequired(params)
      if (onHumanInputRequired)
        onHumanInputRequired(params)
    },
    onHumanInputFormFilled: (params) => {
      handleWorkflowNodeHumanInputFormFilled(params)
      if (onHumanInputFormFilled)
        onHumanInputFormFilled(params)
    },
    onHumanInputFormTimeout: (params) => {
      handleWorkflowNodeHumanInputFormTimeout(params)
      if (onHumanInputFormTimeout)
        onHumanInputFormTimeout(params)
    },
    onError: wrappedOnError,
    onCompleted: wrappedOnCompleted,
  }

  return baseSseOptions
}

export const createFinalWorkflowRunCallbacks = ({
  clientWidth,
  clientHeight,
  runHistoryUrl,
  isInWorkflowDebug,
  fetchInspectVars,
  invalidAllLastRun,
  invalidateRunHistory,
  clearAbortController,
  clearListeningState,
  getWorkflowRunningData,
  trackWorkflowRunFailed,
  handlers,
  callbacks,
  restCallback,
  baseSseOptions,
  player,
  setAbortController,
}: FinalCallbacksContext): IOtherOptions => {
  const {
    handleWorkflowFinished,
    handleWorkflowFailed,
    handleWorkflowNodeStarted,
    handleWorkflowNodeFinished,
    handleWorkflowNodeHumanInputRequired,
    handleWorkflowNodeHumanInputFormFilled,
    handleWorkflowNodeHumanInputFormTimeout,
    handleWorkflowNodeIterationStarted,
    handleWorkflowNodeIterationNext,
    handleWorkflowNodeIterationFinished,
    handleWorkflowNodeLoopStarted,
    handleWorkflowNodeLoopNext,
    handleWorkflowNodeLoopFinished,
    handleWorkflowNodeRetry,
    handleWorkflowAgentLog,
    handleWorkflowTextChunk,
    handleWorkflowTextReplace,
    handleWorkflowPaused,
  } = handlers
  const {
    onWorkflowFinished,
    onNodeStarted,
    onNodeFinished,
    onIterationStart,
    onIterationNext,
    onIterationFinish,
    onLoopStart,
    onLoopNext,
    onLoopFinish,
    onNodeRetry,
    onAgentLog,
    onError,
    onWorkflowPaused,
    onHumanInputRequired,
    onHumanInputFormFilled,
    onHumanInputFormTimeout,
  } = callbacks

  const finalCallbacks: IOtherOptions = {
    ...baseSseOptions,
    getAbortController: (controller: AbortController) => {
      setAbortController(controller)
    },
    onWorkflowFinished: (params) => {
      handleWorkflowFinished(params)
      invalidateRunHistory(runHistoryUrl)

      if (onWorkflowFinished)
        onWorkflowFinished(params)
      if (isInWorkflowDebug) {
        fetchInspectVars({})
        invalidAllLastRun()
      }
    },
    onError: (params, code) => {
      clearAbortController()
      handleWorkflowFailed()
      const workflowData = getWorkflowRunningData()
      invalidateRunHistory(runHistoryUrl)
      clearListeningState()

      if (onError)
        onError(params, code)
      trackWorkflowRunFailed(params, workflowData)
    },
    onNodeStarted: (params) => {
      handleWorkflowNodeStarted(params, { clientWidth, clientHeight })

      if (onNodeStarted)
        onNodeStarted(params)
    },
    onNodeFinished: (params) => {
      handleWorkflowNodeFinished(params)

      if (onNodeFinished)
        onNodeFinished(params)
    },
    onIterationStart: (params) => {
      handleWorkflowNodeIterationStarted(params, { clientWidth, clientHeight })

      if (onIterationStart)
        onIterationStart(params)
    },
    onIterationNext: (params) => {
      handleWorkflowNodeIterationNext(params)

      if (onIterationNext)
        onIterationNext(params)
    },
    onIterationFinish: (params) => {
      handleWorkflowNodeIterationFinished(params)

      if (onIterationFinish)
        onIterationFinish(params)
    },
    onLoopStart: (params) => {
      handleWorkflowNodeLoopStarted(params, { clientWidth, clientHeight })

      if (onLoopStart)
        onLoopStart(params)
    },
    onLoopNext: (params) => {
      handleWorkflowNodeLoopNext(params)

      if (onLoopNext)
        onLoopNext(params)
    },
    onLoopFinish: (params) => {
      handleWorkflowNodeLoopFinished(params)

      if (onLoopFinish)
        onLoopFinish(params)
    },
    onNodeRetry: (params) => {
      handleWorkflowNodeRetry(params)

      if (onNodeRetry)
        onNodeRetry(params)
    },
    onAgentLog: (params) => {
      handleWorkflowAgentLog(params)

      if (onAgentLog)
        onAgentLog(params)
    },
    onTextChunk: (params) => {
      handleWorkflowTextChunk(params)
    },
    onTextReplace: (params) => {
      handleWorkflowTextReplace(params)
    },
    onTTSChunk: (messageId: string, audio: string) => {
      if (!audio || audio === '')
        return
      player?.playAudioWithAudio(audio, true)
      AudioPlayerManager.getInstance().resetMsgId(messageId)
    },
    onTTSEnd: (_messageId: string, audio: string) => {
      player?.playAudioWithAudio(audio, false)
    },
    onWorkflowPaused: (params) => {
      handleWorkflowPaused()
      invalidateRunHistory(runHistoryUrl)
      if (onWorkflowPaused)
        onWorkflowPaused(params)
      const url = `/workflow/${params.workflow_run_id}/events`
      sseGet(url, {}, finalCallbacks)
    },
    onHumanInputRequired: (params) => {
      handleWorkflowNodeHumanInputRequired(params)
      if (onHumanInputRequired)
        onHumanInputRequired(params)
    },
    onHumanInputFormFilled: (params) => {
      handleWorkflowNodeHumanInputFormFilled(params)
      if (onHumanInputFormFilled)
        onHumanInputFormFilled(params)
    },
    onHumanInputFormTimeout: (params) => {
      handleWorkflowNodeHumanInputFormTimeout(params)
      if (onHumanInputFormTimeout)
        onHumanInputFormTimeout(params)
    },
    ...restCallback,
  }

  return finalCallbacks
}
