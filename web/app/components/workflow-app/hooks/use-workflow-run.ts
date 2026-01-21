import type AudioPlayer from '@/app/components/base/audio-btn/audio'
import type { Node } from '@/app/components/workflow/types'
import type { IOtherOptions } from '@/service/base'
import type { VersionHistory } from '@/types/workflow'
import { noop } from 'es-toolkit/function'
import { produce } from 'immer'
import { usePathname } from 'next/navigation'
import { useCallback, useRef } from 'react'
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
import { handleStream, post, ssePost } from '@/service/base'
import { ContentType } from '@/service/fetch'
import { useInvalidAllLastRun } from '@/service/use-workflow'
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

type DebuggableTriggerType = Exclude<TriggerType, TriggerType.UserInput>

const controllerKeyMap: Record<DebuggableTriggerType, string> = {
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

export const useWorkflowRun = () => {
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

  const { fetchInspectVars } = useSetWorkflowVarsWithValue({
    ...configsMap,
  })

  const abortControllerRef = useRef<AbortController | null>(null)

  const {
    handleWorkflowStarted,
    handleWorkflowFinished,
    handleWorkflowFailed,
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

  const handleRun = useCallback(async (
    params: any,
    callback?: IOtherOptions,
    options?: HandleRunOptions,
  ) => {
    const runMode: HandleRunMode = options?.mode ?? TriggerType.UserInput
    const resolvedParams = params ?? {}
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
    await doSyncWorkflowDraft()

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
      onCompleted,
      ...restCallback
    } = callback || {}
    workflowStore.setState({ historyWorkflowData: undefined })
    const appDetail = useAppStore.getState().appDetail
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
      setWorkflowRunningData,
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
      setWorkflowRunningData({
        result: {
          status: WorkflowRunningStatus.Running,
          inputs_truncated: false,
          process_data_truncated: false,
          outputs_truncated: false,
        },
        tracing: [],
        resultText: '',
      })
    }
    else {
      setIsListening(false)
      setListeningTriggerType(null)
      setListeningTriggerNodeId(null)
      setListeningTriggerNodeIds([])
      setListeningTriggerIsAll(false)
      setWorkflowRunningData({
        result: {
          status: WorkflowRunningStatus.Running,
          inputs_truncated: false,
          process_data_truncated: false,
          outputs_truncated: false,
        },
        tracing: [],
        resultText: '',
      })
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

    const clearAbortController = () => {
      abortControllerRef.current = null
      delete (window as any).__webhookDebugAbortController
      delete (window as any).__pluginDebugAbortController
      delete (window as any).__scheduleDebugAbortController
      delete (window as any).__allTriggersDebugAbortController
    }

    const clearListeningState = () => {
      const state = workflowStore.getState()
      state.setIsListening(false)
      state.setListeningTriggerType(null)
      state.setListeningTriggerNodeId(null)
      state.setListeningTriggerNodeIds([])
      state.setListeningTriggerIsAll(false)
    }

    const wrappedOnError = (params: any) => {
      clearAbortController()
      handleWorkflowFailed()
      clearListeningState()

      if (onError)
        onError(params)
      trackEvent('workflow_run_failed', { workflow_id: flowId, reason: params.error, node_type: params.node_type })
    }

    const wrappedOnCompleted: IOtherOptions['onCompleted'] = async (hasError?: boolean, errorMessage?: string) => {
      clearAbortController()
      clearListeningState()
      if (onCompleted)
        onCompleted(hasError, errorMessage)
    }

    const baseSseOptions: IOtherOptions = {
      ...restCallback,
      onWorkflowStarted: (params) => {
        const state = workflowStore.getState()
        if (state.workflowRunningData) {
          state.setWorkflowRunningData(produce(state.workflowRunningData, (draft) => {
            draft.resultText = ''
          }))
        }
        handleWorkflowStarted(params)

        if (onWorkflowStarted)
          onWorkflowStarted(params)
      },
      onWorkflowFinished: (params) => {
        clearListeningState()
        handleWorkflowFinished(params)

        if (onWorkflowFinished)
          onWorkflowFinished(params)
        if (isInWorkflowDebug) {
          fetchInspectVars({})
          invalidAllLastRun()
        }
      },
      onNodeStarted: (params) => {
        handleWorkflowNodeStarted(
          params,
          {
            clientWidth,
            clientHeight,
          },
        )

        if (onNodeStarted)
          onNodeStarted(params)
      },
      onNodeFinished: (params) => {
        handleWorkflowNodeFinished(params)

        if (onNodeFinished)
          onNodeFinished(params)
      },
      onIterationStart: (params) => {
        handleWorkflowNodeIterationStarted(
          params,
          {
            clientWidth,
            clientHeight,
          },
        )

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
        handleWorkflowNodeLoopStarted(
          params,
          {
            clientWidth,
            clientHeight,
          },
        )

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
      onTTSEnd: (messageId: string, audio: string) => {
        const audioPlayer = getOrCreatePlayer()
        if (audioPlayer)
          audioPlayer.playAudioWithAudio(audio, false)
      },
      onError: wrappedOnError,
      onCompleted: wrappedOnCompleted,
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

        ; (window as any)[controllerKey] = controller

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
            let data: any = null
            try {
              data = await response.json()
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
              const delay = Number(data.retry_in) || 2000
              await waitWithAbort(controller.signal, delay)
              if (controller.signal.aborted)
                return
              await poll()
              return
            }

            const errorMessage = data?.message || `${debugLabel} debug failed`
            Toast.notify({ type: 'error', message: errorMessage })
            clearAbortController()
            setWorkflowRunningData({
              result: {
                status: WorkflowRunningStatus.Failed,
                error: errorMessage,
                inputs_truncated: false,
                process_data_truncated: false,
                outputs_truncated: false,
              },
              tracing: [],
            })
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
            baseSseOptions.onDataSourceNodeProcessing,
            baseSseOptions.onDataSourceNodeCompleted,
            baseSseOptions.onDataSourceNodeError,
          )
        }
        catch (error) {
          if (controller.signal.aborted)
            return
          if (error instanceof Response) {
            const data = await error.clone().json() as Record<string, any>
            const { error: respError } = data || {}
            Toast.notify({ type: 'error', message: respError })
            clearAbortController()
            setWorkflowRunningData({
              result: {
                status: WorkflowRunningStatus.Failed,
                error: respError,
                inputs_truncated: false,
                process_data_truncated: false,
                outputs_truncated: false,
              },
              tracing: [],
            })
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

    ssePost(
      url,
      {
        body: requestBody,
      },
      {
        ...baseSseOptions,
        getAbortController: (controller: AbortController) => {
          abortControllerRef.current = controller
        },
      },
    )
  }, [store, doSyncWorkflowDraft, workflowStore, pathname, handleWorkflowStarted, handleWorkflowFinished, fetchInspectVars, invalidAllLastRun, handleWorkflowFailed, handleWorkflowNodeStarted, handleWorkflowNodeFinished, handleWorkflowNodeIterationStarted, handleWorkflowNodeIterationNext, handleWorkflowNodeIterationFinished, handleWorkflowNodeLoopStarted, handleWorkflowNodeLoopNext, handleWorkflowNodeLoopFinished, handleWorkflowNodeRetry, handleWorkflowAgentLog, handleWorkflowTextChunk, handleWorkflowTextReplace])

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
    const webhookController = (window as any).__webhookDebugAbortController
    if (webhookController)
      webhookController.abort()

    const pluginController = (window as any).__pluginDebugAbortController
    if (pluginController)
      pluginController.abort()

    const scheduleController = (window as any).__scheduleDebugAbortController
    if (scheduleController)
      scheduleController.abort()

    const allTriggerController = (window as any).__allTriggersDebugAbortController
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
    handleStopRun,
    handleRestoreFromPublishedWorkflow,
  }
}
