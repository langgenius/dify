import type { AudioPlayer } from '@/app/components/base/audio-btn/audio'
import type { StreamCallbacks } from '@/service/event-stream'
import { AudioPlayerManager } from '@/app/components/base/audio-btn/audio.player.manager'
import { streamEvents } from '@/service/event-stream'
import { workflowRunEventsRequest } from '@/service/workflow-events'

type ContainerSize = {
  clientWidth: number
  clientHeight: number
}

type WorkflowRunEventHandlers = {
  handleWorkflowStarted: NonNullable<StreamCallbacks['onWorkflowStarted']>
  handleWorkflowFinished: NonNullable<StreamCallbacks['onWorkflowFinished']>
  handleWorkflowFailed: (error?: string) => void
  handleWorkflowNodeStarted: (
    params: Parameters<NonNullable<StreamCallbacks['onNodeStarted']>>[0],
    containerParams: ContainerSize,
  ) => void
  handleWorkflowNodeFinished: NonNullable<StreamCallbacks['onNodeFinished']>
  handleWorkflowNodeHumanInputRequired: NonNullable<StreamCallbacks['onHumanInputRequired']>
  handleWorkflowNodeHumanInputFormFilled: NonNullable<StreamCallbacks['onHumanInputFormFilled']>
  handleWorkflowNodeHumanInputFormTimeout: NonNullable<StreamCallbacks['onHumanInputFormTimeout']>
  handleWorkflowNodeIterationStarted: (
    params: Parameters<NonNullable<StreamCallbacks['onIterationStart']>>[0],
    containerParams: ContainerSize,
  ) => void
  handleWorkflowNodeIterationNext: NonNullable<StreamCallbacks['onIterationNext']>
  handleWorkflowNodeIterationFinished: NonNullable<StreamCallbacks['onIterationFinish']>
  handleWorkflowNodeLoopStarted: (
    params: Parameters<NonNullable<StreamCallbacks['onLoopStart']>>[0],
    containerParams: ContainerSize,
  ) => void
  handleWorkflowNodeLoopNext: NonNullable<StreamCallbacks['onLoopNext']>
  handleWorkflowNodeLoopFinished: NonNullable<StreamCallbacks['onLoopFinish']>
  handleWorkflowNodeRetry: NonNullable<StreamCallbacks['onNodeRetry']>
  handleWorkflowAgentLog: NonNullable<StreamCallbacks['onAgentLog']>
  handleWorkflowTextChunk: NonNullable<StreamCallbacks['onTextChunk']>
  handleWorkflowTextReplace: NonNullable<StreamCallbacks['onTextReplace']>
  handleWorkflowReasoning: NonNullable<StreamCallbacks['onReasoning']>
  handleWorkflowPaused: () => void
}

type UserCallbackHandlers = {
  onWorkflowStarted?: StreamCallbacks['onWorkflowStarted']
  onWorkflowFinished?: StreamCallbacks['onWorkflowFinished']
  onNodeStarted?: StreamCallbacks['onNodeStarted']
  onNodeFinished?: StreamCallbacks['onNodeFinished']
  onIterationStart?: StreamCallbacks['onIterationStart']
  onIterationNext?: StreamCallbacks['onIterationNext']
  onIterationFinish?: StreamCallbacks['onIterationFinish']
  onLoopStart?: StreamCallbacks['onLoopStart']
  onLoopNext?: StreamCallbacks['onLoopNext']
  onLoopFinish?: StreamCallbacks['onLoopFinish']
  onNodeRetry?: StreamCallbacks['onNodeRetry']
  onAgentLog?: StreamCallbacks['onAgentLog']
  onError?: StreamCallbacks['onError']
  onWorkflowPaused?: StreamCallbacks['onWorkflowPaused']
  onHumanInputRequired?: StreamCallbacks['onHumanInputRequired']
  onHumanInputFormFilled?: StreamCallbacks['onHumanInputFormFilled']
  onHumanInputFormTimeout?: StreamCallbacks['onHumanInputFormTimeout']
  onCompleted?: StreamCallbacks['onCompleted']
}

type CallbackContext = {
  clientWidth: number
  clientHeight: number
  isInWorkflowDebug: boolean
  fetchInspectVars: (params: Record<string, never>) => void
  invalidAllLastRun: () => void
  invalidateRunHistory: () => void
  clearAbortController: () => void
  clearListeningState: () => void
  getWorkflowRunningData: () => unknown
  trackWorkflowRunFailed: (params: unknown, workflowData: unknown) => void
  handlers: WorkflowRunEventHandlers
  callbacks: UserCallbackHandlers
  restCallback: StreamCallbacks
}

type BaseCallbacksContext = CallbackContext & {
  getOrCreatePlayer: () => AudioPlayer | null
}

type FinalCallbacksContext = CallbackContext & {
  baseSseOptions: StreamCallbacks
  player: AudioPlayer | null
  setAbortController: (controller: AbortController) => void
}

export const createBaseWorkflowRunCallbacks = ({
  clientWidth,
  clientHeight,
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
}: BaseCallbacksContext): StreamCallbacks => {
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
    handleWorkflowReasoning,
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
  let hasStartedResumeStream = false

  const wrappedOnError: StreamCallbacks['onError'] = (params, code) => {
    clearAbortController()
    handleWorkflowFailed(params)
    const workflowData = getWorkflowRunningData()
    invalidateRunHistory()
    clearListeningState()

    if (onError) onError(params, code)

    trackWorkflowRunFailed(params, workflowData)
  }

  const wrappedOnCompleted: StreamCallbacks['onCompleted'] = async (hasError, errorMessage) => {
    clearAbortController()
    clearListeningState()
    if (onCompleted) onCompleted(hasError, errorMessage)
  }

  const baseSseOptions: StreamCallbacks = {
    ...restCallback,
    onWorkflowStarted: (params) => {
      handleWorkflowStarted(params)
      invalidateRunHistory()

      if (onWorkflowStarted) onWorkflowStarted(params)
    },
    onWorkflowFinished: (params) => {
      clearListeningState()
      handleWorkflowFinished(params)
      invalidateRunHistory()

      if (onWorkflowFinished) onWorkflowFinished(params)
      if (isInWorkflowDebug) {
        fetchInspectVars({})
        invalidAllLastRun()
      }
    },
    onNodeStarted: (params) => {
      handleWorkflowNodeStarted(params, { clientWidth, clientHeight })

      if (onNodeStarted) onNodeStarted(params)
    },
    onNodeFinished: (params) => {
      handleWorkflowNodeFinished(params)

      if (onNodeFinished) onNodeFinished(params)
    },
    onIterationStart: (params) => {
      handleWorkflowNodeIterationStarted(params, { clientWidth, clientHeight })

      if (onIterationStart) onIterationStart(params)
    },
    onIterationNext: (params) => {
      handleWorkflowNodeIterationNext(params)

      if (onIterationNext) onIterationNext(params)
    },
    onIterationFinish: (params) => {
      handleWorkflowNodeIterationFinished(params)

      if (onIterationFinish) onIterationFinish(params)
    },
    onLoopStart: (params) => {
      handleWorkflowNodeLoopStarted(params, { clientWidth, clientHeight })

      if (onLoopStart) onLoopStart(params)
    },
    onLoopNext: (params) => {
      handleWorkflowNodeLoopNext(params)

      if (onLoopNext) onLoopNext(params)
    },
    onLoopFinish: (params) => {
      handleWorkflowNodeLoopFinished(params)

      if (onLoopFinish) onLoopFinish(params)
    },
    onNodeRetry: (params) => {
      handleWorkflowNodeRetry(params)

      if (onNodeRetry) onNodeRetry(params)
    },
    onAgentLog: (params) => {
      handleWorkflowAgentLog(params)

      if (onAgentLog) onAgentLog(params)
    },
    onTextChunk: (params) => {
      handleWorkflowTextChunk(params)
    },
    onTextReplace: (params) => {
      handleWorkflowTextReplace(params)
    },
    onReasoning: (params) => {
      handleWorkflowReasoning(params)
    },
    onTTSChunk: (messageId: string, audio: string, audioType?: string) => {
      if (!audio || audio === '') return
      const audioPlayer = getOrCreatePlayer()
      if (audioPlayer) {
        audioPlayer.playAudioWithAudio(audio, true, audioType)
        AudioPlayerManager.getInstance().resetMsgId(messageId)
      }
    },
    onTTSEnd: (_messageId: string, audio: string) => {
      const audioPlayer = getOrCreatePlayer()
      if (audioPlayer) audioPlayer.playAudioWithAudio(audio, false)
    },
    onWorkflowPaused: (params) => {
      handleWorkflowPaused()
      invalidateRunHistory()
      if (onWorkflowPaused) onWorkflowPaused(params)
      if (!hasStartedResumeStream) {
        hasStartedResumeStream = true
        streamEvents(workflowRunEventsRequest(params.workflow_run_id), baseSseOptions)
      }
    },
    onHumanInputRequired: (params) => {
      handleWorkflowNodeHumanInputRequired(params)
      if (onHumanInputRequired) onHumanInputRequired(params)
    },
    onHumanInputFormFilled: (params) => {
      handleWorkflowNodeHumanInputFormFilled(params)
      if (onHumanInputFormFilled) onHumanInputFormFilled(params)
    },
    onHumanInputFormTimeout: (params) => {
      handleWorkflowNodeHumanInputFormTimeout(params)
      if (onHumanInputFormTimeout) onHumanInputFormTimeout(params)
    },
    onError: wrappedOnError,
    onCompleted: wrappedOnCompleted,
  }

  return baseSseOptions
}

export const createFinalWorkflowRunCallbacks = ({
  clientWidth,
  clientHeight,
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
}: FinalCallbacksContext): StreamCallbacks => {
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
    handleWorkflowReasoning,
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
  let hasStartedResumeStream = false

  const finalCallbacks: StreamCallbacks = {
    ...baseSseOptions,
    getAbortController: (controller: AbortController) => {
      setAbortController(controller)
    },
    onWorkflowFinished: (params) => {
      handleWorkflowFinished(params)
      invalidateRunHistory()

      if (onWorkflowFinished) onWorkflowFinished(params)
      if (isInWorkflowDebug) {
        fetchInspectVars({})
        invalidAllLastRun()
      }
    },
    onError: (params, code) => {
      clearAbortController()
      handleWorkflowFailed(params)
      const workflowData = getWorkflowRunningData()
      invalidateRunHistory()
      clearListeningState()

      if (onError) onError(params, code)
      trackWorkflowRunFailed(params, workflowData)
    },
    onNodeStarted: (params) => {
      handleWorkflowNodeStarted(params, { clientWidth, clientHeight })

      if (onNodeStarted) onNodeStarted(params)
    },
    onNodeFinished: (params) => {
      handleWorkflowNodeFinished(params)

      if (onNodeFinished) onNodeFinished(params)
    },
    onIterationStart: (params) => {
      handleWorkflowNodeIterationStarted(params, { clientWidth, clientHeight })

      if (onIterationStart) onIterationStart(params)
    },
    onIterationNext: (params) => {
      handleWorkflowNodeIterationNext(params)

      if (onIterationNext) onIterationNext(params)
    },
    onIterationFinish: (params) => {
      handleWorkflowNodeIterationFinished(params)

      if (onIterationFinish) onIterationFinish(params)
    },
    onLoopStart: (params) => {
      handleWorkflowNodeLoopStarted(params, { clientWidth, clientHeight })

      if (onLoopStart) onLoopStart(params)
    },
    onLoopNext: (params) => {
      handleWorkflowNodeLoopNext(params)

      if (onLoopNext) onLoopNext(params)
    },
    onLoopFinish: (params) => {
      handleWorkflowNodeLoopFinished(params)

      if (onLoopFinish) onLoopFinish(params)
    },
    onNodeRetry: (params) => {
      handleWorkflowNodeRetry(params)

      if (onNodeRetry) onNodeRetry(params)
    },
    onAgentLog: (params) => {
      handleWorkflowAgentLog(params)

      if (onAgentLog) onAgentLog(params)
    },
    onTextChunk: (params) => {
      handleWorkflowTextChunk(params)
    },
    onTextReplace: (params) => {
      handleWorkflowTextReplace(params)
    },
    onReasoning: (params) => {
      handleWorkflowReasoning(params)
    },
    onTTSChunk: (messageId: string, audio: string, audioType?: string) => {
      if (!audio || audio === '') return
      player?.playAudioWithAudio(audio, true, audioType)
      AudioPlayerManager.getInstance().resetMsgId(messageId)
    },
    onTTSEnd: (_messageId: string, audio: string) => {
      player?.playAudioWithAudio(audio, false)
    },
    onWorkflowPaused: (params) => {
      handleWorkflowPaused()
      invalidateRunHistory()
      if (onWorkflowPaused) onWorkflowPaused(params)
      if (!hasStartedResumeStream) {
        hasStartedResumeStream = true
        streamEvents(workflowRunEventsRequest(params.workflow_run_id), finalCallbacks)
      }
    },
    onHumanInputRequired: (params) => {
      handleWorkflowNodeHumanInputRequired(params)
      if (onHumanInputRequired) onHumanInputRequired(params)
    },
    onHumanInputFormFilled: (params) => {
      handleWorkflowNodeHumanInputFormFilled(params)
      if (onHumanInputFormFilled) onHumanInputFormFilled(params)
    },
    onHumanInputFormTimeout: (params) => {
      handleWorkflowNodeHumanInputFormTimeout(params)
      if (onHumanInputFormTimeout) onHumanInputFormTimeout(params)
    },
    ...restCallback,
  }

  return finalCallbacks
}
