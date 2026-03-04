import type AudioPlayer from '@/app/components/base/audio-btn/audio'
import type { Node } from '@/app/components/workflow/types'
import type { IOtherOptions } from '@/service/base'
import type { VersionHistory } from '@/types/workflow'
import { noop } from 'es-toolkit/function'
import { produce } from 'immer'
import { usePathname } from 'next/navigation'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import { v4 as uuidV4 } from 'uuid'
import { useStore as useAppStore } from '@/app/components/app/store'
import { trackEvent } from '@/app/components/base/amplitude'
import { AudioPlayerManager } from '@/app/components/base/audio-btn/audio.player.manager'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import Toast from '@/app/components/base/toast'
import { TriggerType } from '@/app/components/workflow/header/test-run-menu'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-interactions'
import { useWorkflowRunEvent } from '@/app/components/workflow/hooks/use-workflow-run-event/use-workflow-run-event'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { handleStream, post, sseGet, ssePost } from '@/service/base'
import { ContentType } from '@/service/fetch'
import { useInvalidAllLastRun, useInvalidateWorkflowRunHistory } from '@/service/use-workflow'
import { stopWorkflowRun } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { useSetWorkflowVarsWithValue } from '../../workflow/hooks/use-fetch-workflow-inspect-vars'
import { useConfigsMap } from './use-configs-map'
import { useNodesSyncDraft } from './use-nodes-sync-draft'

type HandleRunMode = TriggerType
type HandleRunOptions = {
  mode?: HandleRunMode
  scheduleNodeId?: string
  webhookNodeId?: string
  pluginNodeId?: string
  allNodeIds?: string[]
}
type HandleRunParams = {
  token?: string
  appId?: string
} & Record<string, unknown>

type SetupRunSessionOptions = {
  syncDraft?: boolean
  abortCurrentRun?: boolean
}

type DebuggableTriggerType = Exclude<TriggerType, TriggerType.UserInput>
type DebugControllerKey = '__webhookDebugAbortController' | '__pluginDebugAbortController' | '__allTriggersDebugAbortController' | '__scheduleDebugAbortController'
type DebugControllerWindow = Window & {
  __webhookDebugAbortController?: AbortController
  __pluginDebugAbortController?: AbortController
  __allTriggersDebugAbortController?: AbortController
  __scheduleDebugAbortController?: AbortController
}
const controllerKeyMap: Record<DebuggableTriggerType, DebugControllerKey> = {
  [TriggerType.Webhook]: '__webhookDebugAbortController',
  [TriggerType.Plugin]: '__pluginDebugAbortController',
  [TriggerType.All]: '__allTriggersDebugAbortController',
  [TriggerType.Schedule]: '__scheduleDebugAbortController',
}

const debugLabelMap: Record<DebuggableTriggerType, string> = {
  [TriggerType.Webhook]: 'Webhook',
  [TriggerType.Plugin]: 'Plugin',
  [TriggerType.All]: 'All',
  [TriggerType.Schedule]: 'Schedule',
}

const getDebugControllerWindow = (): DebugControllerWindow => window as DebugControllerWindow

const getStringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string')
    return value
  return undefined
}

type ForwardSseCallbacks = {
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
  onWorkflowPaused?: IOtherOptions['onWorkflowPaused']
  onHumanInputRequired?: IOtherOptions['onHumanInputRequired']
  onHumanInputFormFilled?: IOtherOptions['onHumanInputFormFilled']
  onHumanInputFormTimeout?: IOtherOptions['onHumanInputFormTimeout']
}

type CreateSseCallbacksOptions = {
  runHistoryUrl: string
  clientWidth: number
  clientHeight: number
  forwardCallbacks?: ForwardSseCallbacks
  continueFromPause?: (workflowRunId: string) => void
  onTTSChunk?: IOtherOptions['onTTSChunk']
  onTTSEnd?: IOtherOptions['onTTSEnd']
}

export const useWorkflowRun = () => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()
  const featuresStore = useFeaturesStore()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const pathname = usePathname()
  const configsMap = useConfigsMap()
  const { flowId, flowType } = configsMap
  const invalidAllLastRun = useInvalidAllLastRun(flowType, flowId)
  const invalidateRunHistory = useInvalidateWorkflowRunHistory()

  const { fetchInspectVars } = useSetWorkflowVarsWithValue({
    ...configsMap,
  })

  const abortControllerRef = useRef<AbortController | null>(null)

  const getRerunErrorMessage = useCallback((code?: string, fallbackMessage?: string) => {
    switch (code) {
      case 'invalid_param':
        return t('debug.rerun.errors.invalidParam', { ns: 'workflow' })
      case 'workflow_run_not_found':
      case 'target_node_not_found':
        return t('debug.rerun.errors.notFound', { ns: 'workflow' })
      case 'workflow_run_not_ended':
        return t('debug.rerun.errors.sourceNotEnded', { ns: 'workflow' })
      case 'unsupported_target_node_scope':
        return t('debug.rerun.errors.unsupportedScope', { ns: 'workflow' })
      case 'override_selector_invalid':
      case 'override_out_of_scope':
      case 'override_type_mismatch':
        return t('debug.rerun.errors.overrideInvalid', { ns: 'workflow' })
      case 'unsupported_app_mode':
        return t('debug.rerun.errors.unsupportedAppMode', { ns: 'workflow' })
      case 'rerun_execution_failed':
        return t('debug.rerun.errors.executionFailed', { ns: 'workflow' })
      default:
        return fallbackMessage || t('debug.rerun.errors.executionFailed', { ns: 'workflow' })
    }
  }, [t])

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
  } = useWorkflowRunEvent()

  const handleBackupDraft = useCallback(() => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const { getViewport } = reactflow
    const {
      backupDraft,
      setBackupDraft,
      environmentVariables,
    } = workflowStore.getState()
    const { features } = featuresStore!.getState()

    if (!backupDraft) {
      setBackupDraft({
        nodes: getNodes(),
        edges,
        viewport: getViewport(),
        features,
        environmentVariables,
      })
      doSyncWorkflowDraft()
    }
  }, [reactflow, workflowStore, store, featuresStore, doSyncWorkflowDraft])

  const handleLoadBackupDraft = useCallback(() => {
    const {
      backupDraft,
      setBackupDraft,
      setEnvironmentVariables,
    } = workflowStore.getState()

    if (backupDraft) {
      const {
        nodes,
        edges,
        viewport,
        features,
        environmentVariables,
      } = backupDraft
      handleUpdateWorkflowCanvas({
        nodes,
        edges,
        viewport,
      })
      setEnvironmentVariables(environmentVariables)
      featuresStore!.setState({ features })
      setBackupDraft(undefined)
    }
  }, [handleUpdateWorkflowCanvas, workflowStore, featuresStore])

  const clearAbortController = useCallback(() => {
    abortControllerRef.current = null
    const debugWindow = getDebugControllerWindow()
    delete debugWindow.__webhookDebugAbortController
    delete debugWindow.__pluginDebugAbortController
    delete debugWindow.__scheduleDebugAbortController
    delete debugWindow.__allTriggersDebugAbortController
  }, [])

  const clearListeningState = useCallback(() => {
    const state = workflowStore.getState()
    state.setIsListening(false)
    state.setListeningTriggerType(null)
    state.setListeningTriggerNodeId(null)
    state.setListeningTriggerNodeIds([])
    state.setListeningTriggerIsAll(false)
  }, [workflowStore])

  const setWorkflowRunningState = useCallback(() => {
    workflowStore.getState().setWorkflowRunningData({
      result: {
        status: WorkflowRunningStatus.Running,
        inputs_truncated: false,
        process_data_truncated: false,
        outputs_truncated: false,
      },
      tracing: [],
      resultText: '',
    })
  }, [workflowStore])

  const setWorkflowFailedState = useCallback((message: string, withResultText = true) => {
    const failedData = {
      result: {
        status: WorkflowRunningStatus.Failed,
        error: message,
        inputs_truncated: false,
        process_data_truncated: false,
        outputs_truncated: false,
      },
      tracing: [],
      ...(withResultText ? { resultText: '' } : {}),
    }

    workflowStore.getState().setWorkflowRunningData(failedData)
  }, [workflowStore])

  const setupRunSession = useCallback(async ({
    syncDraft = false,
    abortCurrentRun = false,
  }: SetupRunSessionOptions = {}) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft: Node[]) => {
      draft.forEach((node) => {
        node.data.selected = false
        node.data._runningStatus = undefined
      })
    })
    setNodes(newNodes)

    if (syncDraft)
      await doSyncWorkflowDraft()

    if (abortCurrentRun) {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [store, doSyncWorkflowDraft])

  const createSseCallbacks = useCallback(({
    runHistoryUrl,
    clientWidth,
    clientHeight,
    forwardCallbacks,
    continueFromPause,
    onTTSChunk,
    onTTSEnd,
  }: CreateSseCallbacksOptions): IOtherOptions => {
    const callbacks: IOtherOptions = {
      onNodeStarted: (params) => {
        handleWorkflowNodeStarted(params, { clientWidth, clientHeight })
        if (forwardCallbacks?.onNodeStarted)
          forwardCallbacks.onNodeStarted(params)
      },
      onNodeFinished: (params) => {
        handleWorkflowNodeFinished(params)
        if (forwardCallbacks?.onNodeFinished)
          forwardCallbacks.onNodeFinished(params)
      },
      onIterationStart: (params) => {
        handleWorkflowNodeIterationStarted(params, { clientWidth, clientHeight })
        if (forwardCallbacks?.onIterationStart)
          forwardCallbacks.onIterationStart(params)
      },
      onIterationNext: (params) => {
        handleWorkflowNodeIterationNext(params)
        if (forwardCallbacks?.onIterationNext)
          forwardCallbacks.onIterationNext(params)
      },
      onIterationFinish: (params) => {
        handleWorkflowNodeIterationFinished(params)
        if (forwardCallbacks?.onIterationFinish)
          forwardCallbacks.onIterationFinish(params)
      },
      onLoopStart: (params) => {
        handleWorkflowNodeLoopStarted(params, { clientWidth, clientHeight })
        if (forwardCallbacks?.onLoopStart)
          forwardCallbacks.onLoopStart(params)
      },
      onLoopNext: (params) => {
        handleWorkflowNodeLoopNext(params)
        if (forwardCallbacks?.onLoopNext)
          forwardCallbacks.onLoopNext(params)
      },
      onLoopFinish: (params) => {
        handleWorkflowNodeLoopFinished(params)
        if (forwardCallbacks?.onLoopFinish)
          forwardCallbacks.onLoopFinish(params)
      },
      onNodeRetry: (params) => {
        handleWorkflowNodeRetry(params)
        if (forwardCallbacks?.onNodeRetry)
          forwardCallbacks.onNodeRetry(params)
      },
      onAgentLog: (params) => {
        handleWorkflowAgentLog(params)
        if (forwardCallbacks?.onAgentLog)
          forwardCallbacks.onAgentLog(params)
      },
      onTextChunk: (params) => {
        handleWorkflowTextChunk(params)
      },
      onTextReplace: (params) => {
        handleWorkflowTextReplace(params)
      },
      onWorkflowPaused: (params) => {
        handleWorkflowPaused()
        invalidateRunHistory(runHistoryUrl)
        if (forwardCallbacks?.onWorkflowPaused)
          forwardCallbacks.onWorkflowPaused(params)
        continueFromPause?.(params.workflow_run_id)
      },
      onHumanInputRequired: (params) => {
        handleWorkflowNodeHumanInputRequired(params)
        if (forwardCallbacks?.onHumanInputRequired)
          forwardCallbacks.onHumanInputRequired(params)
      },
      onHumanInputFormFilled: (params) => {
        handleWorkflowNodeHumanInputFormFilled(params)
        if (forwardCallbacks?.onHumanInputFormFilled)
          forwardCallbacks.onHumanInputFormFilled(params)
      },
      onHumanInputFormTimeout: (params) => {
        handleWorkflowNodeHumanInputFormTimeout(params)
        if (forwardCallbacks?.onHumanInputFormTimeout)
          forwardCallbacks.onHumanInputFormTimeout(params)
      },
    }

    if (onTTSChunk)
      callbacks.onTTSChunk = onTTSChunk

    if (onTTSEnd)
      callbacks.onTTSEnd = onTTSEnd

    return callbacks
  }, [
    handleWorkflowNodeStarted,
    handleWorkflowNodeFinished,
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
    handleWorkflowNodeHumanInputRequired,
    handleWorkflowNodeHumanInputFormFilled,
    handleWorkflowNodeHumanInputFormTimeout,
    invalidateRunHistory,
  ])

  const handleRun = useCallback(async (
    params: HandleRunParams | undefined,
    callback?: IOtherOptions,
    options?: HandleRunOptions,
  ) => {
    const runMode: HandleRunMode = options?.mode ?? TriggerType.UserInput
    const resolvedParams = params ?? {}
    await setupRunSession({ syncDraft: true })

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
      ...restCallback
    } = callback || {}
    workflowStore.setState({ historyWorkflowData: undefined })
    const appDetail = useAppStore.getState().appDetail
    const runHistoryUrl = appDetail?.mode === AppModeEnum.ADVANCED_CHAT
      ? `/apps/${appDetail.id}/advanced-chat/workflow-runs`
      : `/apps/${appDetail?.id}/workflow-runs`
    const workflowContainer = document.getElementById('workflow-container')

    const {
      clientWidth,
      clientHeight,
    } = workflowContainer!

    const isInWorkflowDebug = appDetail?.mode === AppModeEnum.WORKFLOW

    let url = ''
    if (runMode === TriggerType.Plugin || runMode === TriggerType.Webhook || runMode === TriggerType.Schedule) {
      if (!appDetail?.id) {
        console.error('handleRun: missing app id for trigger plugin run')
        return
      }
      url = `/apps/${appDetail.id}/workflows/draft/trigger/run`
    }
    else if (runMode === TriggerType.All) {
      if (!appDetail?.id) {
        console.error('handleRun: missing app id for trigger run all')
        return
      }
      url = `/apps/${appDetail.id}/workflows/draft/trigger/run-all`
    }
    else if (appDetail?.mode === AppModeEnum.ADVANCED_CHAT) {
      url = `/apps/${appDetail.id}/advanced-chat/workflows/draft/run`
    }
    else if (isInWorkflowDebug && appDetail?.id) {
      url = `/apps/${appDetail.id}/workflows/draft/run`
    }

    let requestBody = {}

    if (runMode === TriggerType.Schedule)
      requestBody = { node_id: options?.scheduleNodeId }

    else if (runMode === TriggerType.Webhook)
      requestBody = { node_id: options?.webhookNodeId }

    else if (runMode === TriggerType.Plugin)
      requestBody = { node_id: options?.pluginNodeId }

    else if (runMode === TriggerType.All)
      requestBody = { node_ids: options?.allNodeIds }

    else
      requestBody = resolvedParams

    if (!url)
      return

    if (runMode === TriggerType.Schedule && !options?.scheduleNodeId) {
      console.error('handleRun: schedule trigger run requires node id')
      return
    }

    if (runMode === TriggerType.Webhook && !options?.webhookNodeId) {
      console.error('handleRun: webhook trigger run requires node id')
      return
    }

    if (runMode === TriggerType.Plugin && !options?.pluginNodeId) {
      console.error('handleRun: plugin trigger run requires node id')
      return
    }

    if (runMode === TriggerType.All && !options?.allNodeIds && options?.allNodeIds?.length === 0) {
      console.error('handleRun: all trigger run requires node ids')
      return
    }

    abortControllerRef.current?.abort()
    abortControllerRef.current = null

    const {
      setIsListening,
      setShowVariableInspectPanel,
      setListeningTriggerType,
      setListeningTriggerNodeIds,
      setListeningTriggerIsAll,
      setListeningTriggerNodeId,
    } = workflowStore.getState()

    if (
      runMode === TriggerType.Webhook
      || runMode === TriggerType.Plugin
      || runMode === TriggerType.All
      || runMode === TriggerType.Schedule
    ) {
      setIsListening(true)
      setShowVariableInspectPanel(true)
      setListeningTriggerIsAll(runMode === TriggerType.All)
      if (runMode === TriggerType.All)
        setListeningTriggerNodeIds(options?.allNodeIds ?? [])
      else if (runMode === TriggerType.Webhook && options?.webhookNodeId)
        setListeningTriggerNodeIds([options.webhookNodeId])
      else if (runMode === TriggerType.Schedule && options?.scheduleNodeId)
        setListeningTriggerNodeIds([options.scheduleNodeId])
      else if (runMode === TriggerType.Plugin && options?.pluginNodeId)
        setListeningTriggerNodeIds([options.pluginNodeId])
      else
        setListeningTriggerNodeIds([])
      setWorkflowRunningState()
    }
    else {
      setIsListening(false)
      setListeningTriggerType(null)
      setListeningTriggerNodeId(null)
      setListeningTriggerNodeIds([])
      setListeningTriggerIsAll(false)
      setWorkflowRunningState()
    }

    let ttsUrl = ''
    let ttsIsPublic = false
    if (resolvedParams.token) {
      ttsUrl = '/text-to-audio'
      ttsIsPublic = true
    }
    else if (resolvedParams.appId) {
      if (pathname.search('explore/installed') > -1)
        ttsUrl = `/installed-apps/${resolvedParams.appId}/text-to-audio`
      else
        ttsUrl = `/apps/${resolvedParams.appId}/text-to-audio`
    }
    // Lazy initialization: Only create AudioPlayer when TTS is actually needed
    // This prevents opening audio channel unnecessarily
    let player: AudioPlayer | null = null
    const getOrCreatePlayer = () => {
      if (!player)
        player = AudioPlayerManager.getInstance().getAudioPlayer(ttsUrl, ttsIsPublic, uuidV4(), 'none', 'none', noop)

      return player
    }

    const wrappedOnError = (message: string) => {
      clearAbortController()
      handleWorkflowFailed()
      invalidateRunHistory(runHistoryUrl)
      clearListeningState()

      if (onError)
        onError(message)
      trackEvent('workflow_run_failed', { workflow_id: flowId, reason: message })
    }

    const wrappedOnCompleted: IOtherOptions['onCompleted'] = async (hasError?: boolean, errorMessage?: string) => {
      clearAbortController()
      clearListeningState()
      if (onCompleted)
        onCompleted(hasError, errorMessage)
    }

    let baseSseOptions: IOtherOptions
    const baseSharedCallbacks = createSseCallbacks({
      runHistoryUrl,
      clientWidth,
      clientHeight,
      forwardCallbacks: {
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
        onWorkflowPaused,
        onHumanInputRequired,
        onHumanInputFormFilled,
        onHumanInputFormTimeout,
      },
      continueFromPause: (workflowRunId) => {
        sseGet(
          `/workflow/${workflowRunId}/events`,
          {},
          baseSseOptions,
        )
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
      onTTSEnd: (messageId: string, audio: string) => {
        const audioPlayer = getOrCreatePlayer()
        if (audioPlayer)
          audioPlayer.playAudioWithAudio(audio, false)
      },
    })

    baseSseOptions = {
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
      onError: wrappedOnError,
      onCompleted: wrappedOnCompleted,
      ...baseSharedCallbacks,
    }

    const waitWithAbort = (signal: AbortSignal, delay: number) => new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, delay)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })

    const runTriggerDebug = async (debugType: DebuggableTriggerType) => {
      const controller = new AbortController()
      abortControllerRef.current = controller

      const controllerKey = controllerKeyMap[debugType]

      const debugWindow = getDebugControllerWindow()
      debugWindow[controllerKey] = controller

      const debugLabel = debugLabelMap[debugType]

      const poll = async (): Promise<void> => {
        try {
          const response = await post<Response>(url, {
            body: requestBody,
            signal: controller.signal,
          }, {
            needAllResponseContent: true,
          })

          if (controller.signal.aborted)
            return

          if (!response) {
            const message = `${debugLabel} debug request failed`
            Toast.notify({ type: 'error', message })
            clearAbortController()
            return
          }

          const contentType = response.headers.get('content-type') || ''

          if (contentType.includes(ContentType.json)) {
            let data: Record<string, unknown> | null = null
            try {
              data = await response.json() as Record<string, unknown>
            }
            catch (jsonError) {
              console.error(`handleRun: ${debugLabel.toLowerCase()} debug response parse error`, jsonError)
              Toast.notify({ type: 'error', message: `${debugLabel} debug request failed` })
              clearAbortController()
              clearListeningState()
              return
            }

            if (controller.signal.aborted)
              return

            if (data?.status === 'waiting') {
              const retryIn = typeof data.retry_in === 'number' ? data.retry_in : Number(data.retry_in)
              const delay = Number.isNaN(retryIn) ? 2000 : retryIn
              await waitWithAbort(controller.signal, delay)
              if (controller.signal.aborted)
                return
              await poll()
              return
            }

            const errorMessage = getStringValue(data?.message) || `${debugLabel} debug failed`
            Toast.notify({ type: 'error', message: errorMessage })
            clearAbortController()
            setWorkflowFailedState(errorMessage, false)
            clearListeningState()
            return
          }

          clearListeningState()
          handleStream(
            response,
            baseSseOptions.onData ?? noop,
            baseSseOptions.onCompleted,
            baseSseOptions.onThought,
            baseSseOptions.onMessageEnd,
            baseSseOptions.onMessageReplace,
            baseSseOptions.onFile,
            baseSseOptions.onWorkflowStarted,
            baseSseOptions.onWorkflowFinished,
            baseSseOptions.onNodeStarted,
            baseSseOptions.onNodeFinished,
            baseSseOptions.onIterationStart,
            baseSseOptions.onIterationNext,
            baseSseOptions.onIterationFinish,
            baseSseOptions.onLoopStart,
            baseSseOptions.onLoopNext,
            baseSseOptions.onLoopFinish,
            baseSseOptions.onNodeRetry,
            baseSseOptions.onParallelBranchStarted,
            baseSseOptions.onParallelBranchFinished,
            baseSseOptions.onTextChunk,
            baseSseOptions.onTTSChunk,
            baseSseOptions.onTTSEnd,
            baseSseOptions.onTextReplace,
            baseSseOptions.onAgentLog,
            baseSseOptions.onHumanInputRequired,
            baseSseOptions.onHumanInputFormFilled,
            baseSseOptions.onHumanInputFormTimeout,
            baseSseOptions.onWorkflowPaused,
            baseSseOptions.onDataSourceNodeProcessing,
            baseSseOptions.onDataSourceNodeCompleted,
            baseSseOptions.onDataSourceNodeError,
          )
        }
        catch (error) {
          if (controller.signal.aborted)
            return
          if (error instanceof Response) {
            const data = await error.clone().json() as Record<string, unknown>
            const respError = getStringValue(data?.error) || `${debugLabel} debug failed`
            Toast.notify({ type: 'error', message: respError })
            clearAbortController()
            setWorkflowFailedState(respError, false)
          }
          clearListeningState()
        }
      }

      await poll()
    }

    if (runMode === TriggerType.Schedule) {
      await runTriggerDebug(TriggerType.Schedule)
      return
    }

    if (runMode === TriggerType.Webhook) {
      await runTriggerDebug(TriggerType.Webhook)
      return
    }

    if (runMode === TriggerType.Plugin) {
      await runTriggerDebug(TriggerType.Plugin)
      return
    }

    if (runMode === TriggerType.All) {
      await runTriggerDebug(TriggerType.All)
      return
    }

    let finalCallbacks: IOtherOptions
    const finalSharedCallbacks = createSseCallbacks({
      runHistoryUrl,
      clientWidth,
      clientHeight,
      forwardCallbacks: {
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
        onWorkflowPaused,
        onHumanInputRequired,
        onHumanInputFormFilled,
        onHumanInputFormTimeout,
      },
      continueFromPause: (workflowRunId) => {
        sseGet(
          `/workflow/${workflowRunId}/events`,
          {},
          finalCallbacks,
        )
      },
      onTTSChunk: (messageId: string, audio: string) => {
        if (!audio || audio === '')
          return
        player?.playAudioWithAudio(audio, true)
        AudioPlayerManager.getInstance().resetMsgId(messageId)
      },
      onTTSEnd: (messageId: string, audio: string) => {
        player?.playAudioWithAudio(audio, false)
      },
    })

    finalCallbacks = {
      ...baseSseOptions,
      getAbortController: (controller: AbortController) => {
        abortControllerRef.current = controller
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
      onError: (params) => {
        handleWorkflowFailed()
        invalidateRunHistory(runHistoryUrl)

        if (onError)
          onError(params)
      },
      ...finalSharedCallbacks,
      ...restCallback,
    }

    ssePost(
      url,
      {
        body: requestBody,
      },
      finalCallbacks,
    )
  }, [
    workflowStore,
    pathname,
    handleWorkflowFailed,
    flowId,
    handleWorkflowStarted,
    handleWorkflowFinished,
    fetchInspectVars,
    invalidAllLastRun,
    invalidateRunHistory,
    clearAbortController,
    clearListeningState,
    setupRunSession,
    setWorkflowRunningState,
    setWorkflowFailedState,
    createSseCallbacks,
  ])

  const handleRerun = useCallback(async ({
    sourceRunId,
    targetNodeId,
    overrides,
  }: {
    sourceRunId: string
    targetNodeId: string
    overrides: Array<{ selector: string[], value: unknown }>
  }) => {
    const appDetail = useAppStore.getState().appDetail
    if (!appDetail?.id)
      return

    if (appDetail.mode !== AppModeEnum.WORKFLOW) {
      Toast.notify({
        type: 'error',
        message: getRerunErrorMessage('unsupported_app_mode'),
      })
      return
    }

    await setupRunSession({ abortCurrentRun: true })

    const {
      historyWorkflowData,
      setHistoryWorkflowData,
      setShowDebugAndPreviewPanel,
      setShowInputsPanel,
      setIsListening,
      setListeningTriggerType,
      setListeningTriggerNodeId,
      setListeningTriggerNodeIds,
      setListeningTriggerIsAll,
      setVariableInspectMode,
      clearRerunContext,
    } = workflowStore.getState()

    if (historyWorkflowData) {
      handleLoadBackupDraft()
      setHistoryWorkflowData(undefined)
    }

    setShowDebugAndPreviewPanel(true)
    setShowInputsPanel(false)
    setIsListening(false)
    setListeningTriggerType(null)
    setListeningTriggerNodeId(null)
    setListeningTriggerNodeIds([])
    setListeningTriggerIsAll(false)
    setVariableInspectMode('cache')
    clearRerunContext()
    setWorkflowRunningState()

    const runHistoryUrl = `/apps/${appDetail.id}/workflow-runs`
    const workflowContainer = document.getElementById('workflow-container')
    const clientWidth = workflowContainer?.clientWidth || 0
    const clientHeight = workflowContainer?.clientHeight || 0

    let rerunSseOptions: IOtherOptions
    const rerunSharedCallbacks = createSseCallbacks({
      runHistoryUrl,
      clientWidth,
      clientHeight,
      continueFromPause: (workflowRunId) => {
        sseGet(`/workflow/${workflowRunId}/events`, {}, rerunSseOptions)
      },
    })

    rerunSseOptions = {
      onWorkflowStarted: (params) => {
        handleWorkflowStarted(params)
        invalidateRunHistory(runHistoryUrl)
      },
      onWorkflowFinished: (params) => {
        handleWorkflowFinished(params)
        invalidateRunHistory(runHistoryUrl)
        fetchInspectVars({})
        invalidAllLastRun()
      },
      ...rerunSharedCallbacks,
      onError: (message, code) => {
        const userFacingMessage = getRerunErrorMessage(code, message)
        Toast.notify({
          type: 'error',
          message: userFacingMessage,
        })
        handleWorkflowFailed()
        invalidateRunHistory(runHistoryUrl)
        clearAbortController()
        clearListeningState()
      },
      onCompleted: () => {
        clearAbortController()
        clearListeningState()
      },
    }

    try {
      const controller = new AbortController()
      abortControllerRef.current = controller

      const response = await post<Response>(
        `/apps/${appDetail.id}/workflow-runs/${sourceRunId}/rerun`,
        {
          body: {
            target_node_id: targetNodeId,
            overrides,
            streaming: true,
          },
          signal: controller.signal,
        },
        {
          needAllResponseContent: true,
          silent: true,
        },
      )

      if (controller.signal.aborted)
        return

      if (!response) {
        const fallbackMessage = getRerunErrorMessage(undefined)
        Toast.notify({
          type: 'error',
          message: fallbackMessage,
        })
        setWorkflowFailedState(fallbackMessage)
        clearAbortController()
        clearListeningState()
        return
      }

      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes(ContentType.json)) {
        const data = await response.json() as Record<string, unknown>
        const errorCode = getStringValue(data?.code)
        const errorMessage = getStringValue(data?.message) || getStringValue(data?.error)
        const userFacingMessage = getRerunErrorMessage(errorCode, errorMessage)
        Toast.notify({
          type: 'error',
          message: userFacingMessage,
        })
        setWorkflowFailedState(userFacingMessage)
        clearAbortController()
        clearListeningState()
        return
      }

      handleStream(
        response,
        rerunSseOptions.onData ?? noop,
        rerunSseOptions.onCompleted,
        rerunSseOptions.onThought,
        rerunSseOptions.onMessageEnd,
        rerunSseOptions.onMessageReplace,
        rerunSseOptions.onFile,
        rerunSseOptions.onWorkflowStarted,
        rerunSseOptions.onWorkflowFinished,
        rerunSseOptions.onNodeStarted,
        rerunSseOptions.onNodeFinished,
        rerunSseOptions.onIterationStart,
        rerunSseOptions.onIterationNext,
        rerunSseOptions.onIterationFinish,
        rerunSseOptions.onLoopStart,
        rerunSseOptions.onLoopNext,
        rerunSseOptions.onLoopFinish,
        rerunSseOptions.onNodeRetry,
        rerunSseOptions.onParallelBranchStarted,
        rerunSseOptions.onParallelBranchFinished,
        rerunSseOptions.onTextChunk,
        rerunSseOptions.onTTSChunk,
        rerunSseOptions.onTTSEnd,
        rerunSseOptions.onTextReplace,
        rerunSseOptions.onAgentLog,
        rerunSseOptions.onHumanInputRequired,
        rerunSseOptions.onHumanInputFormFilled,
        rerunSseOptions.onHumanInputFormTimeout,
        rerunSseOptions.onWorkflowPaused,
        rerunSseOptions.onDataSourceNodeProcessing,
        rerunSseOptions.onDataSourceNodeCompleted,
        rerunSseOptions.onDataSourceNodeError,
      )
    }
    catch (error) {
      if (abortControllerRef.current?.signal.aborted)
        return

      if (error instanceof Response) {
        const data = await error.clone().json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
        const code = getStringValue(data?.code)
        const message = getStringValue(data?.message) || getStringValue(data?.error)
        const userFacingMessage = getRerunErrorMessage(code, message)
        Toast.notify({
          type: 'error',
          message: userFacingMessage,
        })
        setWorkflowFailedState(userFacingMessage)
      }
      else {
        const fallbackMessage = getRerunErrorMessage(undefined)
        Toast.notify({
          type: 'error',
          message: fallbackMessage,
        })
        setWorkflowFailedState(fallbackMessage)
      }

      clearAbortController()
      clearListeningState()
    }
  }, [
    workflowStore,
    handleLoadBackupDraft,
    handleWorkflowStarted,
    handleWorkflowFinished,
    handleWorkflowFailed,
    invalidateRunHistory,
    fetchInspectVars,
    invalidAllLastRun,
    getRerunErrorMessage,
    setupRunSession,
    setWorkflowRunningState,
    setWorkflowFailedState,
    clearAbortController,
    clearListeningState,
    createSseCallbacks,
  ])

  const handleStopRun = useCallback((taskId: string) => {
    const setStoppedState = () => {
      const {
        setWorkflowRunningData,
        setIsListening,
        setShowVariableInspectPanel,
        setListeningTriggerType,
        setListeningTriggerNodeId,
      } = workflowStore.getState()

      setWorkflowRunningData({
        result: {
          status: WorkflowRunningStatus.Stopped,
          inputs_truncated: false,
          process_data_truncated: false,
          outputs_truncated: false,
        },
        tracing: [],
        resultText: '',
      })
      setIsListening(false)
      setListeningTriggerType(null)
      setListeningTriggerNodeId(null)
      setShowVariableInspectPanel(true)
    }

    if (taskId) {
      const appId = useAppStore.getState().appDetail?.id
      stopWorkflowRun(`/apps/${appId}/workflow-runs/tasks/${taskId}/stop`)
      setStoppedState()
      return
    }

    // Try webhook debug controller from global variable first
    const debugWindow = getDebugControllerWindow()
    const webhookController = debugWindow.__webhookDebugAbortController
    if (webhookController)
      webhookController.abort()

    const pluginController = debugWindow.__pluginDebugAbortController
    if (pluginController)
      pluginController.abort()

    const scheduleController = debugWindow.__scheduleDebugAbortController
    if (scheduleController)
      scheduleController.abort()

    const allTriggerController = debugWindow.__allTriggersDebugAbortController
    if (allTriggerController)
      allTriggerController.abort()

    // Also try the ref
    if (abortControllerRef.current)
      abortControllerRef.current.abort()

    abortControllerRef.current = null
    setStoppedState()
  }, [workflowStore])

  const handleRestoreFromPublishedWorkflow = useCallback((publishedWorkflow: VersionHistory) => {
    const nodes = publishedWorkflow.graph.nodes.map(node => ({ ...node, selected: false, data: { ...node.data, selected: false } }))
    const edges = publishedWorkflow.graph.edges
    const viewport = publishedWorkflow.graph.viewport!
    handleUpdateWorkflowCanvas({
      nodes,
      edges,
      viewport,
    })
    const mappedFeatures = {
      opening: {
        enabled: !!publishedWorkflow.features.opening_statement || !!publishedWorkflow.features.suggested_questions.length,
        opening_statement: publishedWorkflow.features.opening_statement,
        suggested_questions: publishedWorkflow.features.suggested_questions,
      },
      suggested: publishedWorkflow.features.suggested_questions_after_answer,
      text2speech: publishedWorkflow.features.text_to_speech,
      speech2text: publishedWorkflow.features.speech_to_text,
      citation: publishedWorkflow.features.retriever_resource,
      moderation: publishedWorkflow.features.sensitive_word_avoidance,
      file: publishedWorkflow.features.file_upload,
    }

    featuresStore?.setState({ features: mappedFeatures })
    workflowStore.getState().setEnvironmentVariables(publishedWorkflow.environment_variables || [])
  }, [featuresStore, handleUpdateWorkflowCanvas, workflowStore])

  return {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRun,
    handleRerun,
    handleStopRun,
    handleRestoreFromPublishedWorkflow,
  }
}
