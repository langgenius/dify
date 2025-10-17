import { useCallback, useRef } from 'react'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import produce from 'immer'
import { v4 as uuidV4 } from 'uuid'
import { usePathname } from 'next/navigation'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-interactions'
import { useWorkflowRunEvent } from '@/app/components/workflow/hooks/use-workflow-run-event/use-workflow-run-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { IOtherOptions } from '@/service/base'
import Toast from '@/app/components/base/toast'
import { handleStream, ssePost } from '@/service/base'
import { stopWorkflowRun } from '@/service/workflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { AudioPlayerManager } from '@/app/components/base/audio-btn/audio.player.manager'
import type { VersionHistory } from '@/types/workflow'
import { noop } from 'lodash-es'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useInvalidAllLastRun } from '@/service/use-workflow'
import { useSetWorkflowVarsWithValue } from '../../workflow/hooks/use-fetch-workflow-inspect-vars'
import { useConfigsMap } from './use-configs-map'
import { API_PREFIX } from '@/config'
import { ContentType, getAccessToken, getBaseOptions } from '@/service/fetch'
import { TriggerType } from '@/app/components/workflow/header/test-run-menu'

type HandleRunMode = TriggerType
type HandleRunOptions = {
  mode?: HandleRunMode
  scheduleNodeId?: string
  webhookNodeId?: string
  pluginNodeId?: string
  allNodeIds?: string[]
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
    const newNodes = produce(getNodes(), (draft) => {
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

    const isInWorkflowDebug = appDetail?.mode === 'workflow'

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
    else if (appDetail?.mode === 'advanced-chat') {
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
      setListeningTriggerNodeId,
    } = workflowStore.getState()

    if (runMode === TriggerType.Webhook || runMode === TriggerType.Plugin || runMode === TriggerType.All) {
      setIsListening(true)
      setShowVariableInspectPanel(true)
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
    const player = AudioPlayerManager.getInstance().getAudioPlayer(ttsUrl, ttsIsPublic, uuidV4(), 'none', 'none', noop)

    const clearAbortController = () => {
      abortControllerRef.current = null
      delete (window as any).__webhookDebugAbortController
      delete (window as any).__pluginDebugAbortController
    }

    const clearListeningState = () => {
      const state = workflowStore.getState()
      state.setIsListening(false)
      state.setListeningTriggerType(null)
      state.setListeningTriggerNodeId(null)
    }

    const wrappedOnError = (params: any) => {
      clearAbortController()
      handleWorkflowFailed()
      clearListeningState()

      if (onError)
        onError(params)
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
        player.playAudioWithAudio(audio, true)
        AudioPlayerManager.getInstance().resetMsgId(messageId)
      },
      onTTSEnd: (messageId: string, audio: string) => {
        player.playAudioWithAudio(audio, false)
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

    const runTriggerDebug = async (debugType: TriggerType.Webhook | TriggerType.Plugin | TriggerType.All) => {
      const urlWithPrefix = (url.startsWith('http://') || url.startsWith('https://'))
        ? url
        : `${API_PREFIX}${url.startsWith('/') ? url : `/${url}`}`

      const controller = new AbortController()
      abortControllerRef.current = controller

      const controllerKey = debugType === TriggerType.Webhook
        ? '__webhookDebugAbortController'
        : '__pluginDebugAbortController'

      ;(window as any)[controllerKey] = controller

      const debugLabel = debugType === TriggerType.Webhook ? 'Webhook' : debugType === TriggerType.Plugin ? 'Plugin' : 'All'

      const poll = async (): Promise<void> => {
        try {
          const baseOptions = getBaseOptions()
          const headers = new Headers(baseOptions.headers as Headers)
          headers.set('Content-Type', ContentType.json)
          const accessToken = await getAccessToken()
          headers.set('Authorization', `Bearer ${accessToken}`)

          const response = await fetch(urlWithPrefix, {
            ...baseOptions,
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          })

          if (controller.signal.aborted)
            return

          if (!response.ok) {
            const message = `${debugLabel} debug request failed (${response.status})`
            Toast.notify({ type: 'error', message })
            clearAbortController()
            return
          }

          const contentType = response.headers.get('Content-Type')?.toLowerCase() || ''
          if (contentType.includes('application/json')) {
            const data = await response.json()
            if (controller.signal.aborted)
              return

            if (data.status === 'waiting') {
              const delay = Number(data.retry_in) || 2000
              await waitWithAbort(controller.signal, delay)
              if (controller.signal.aborted)
                return
              await poll()
              return
            }

            const errorMessage = data.message || `${debugLabel} debug failed`
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
          console.error(`handleRun: ${debugLabel.toLowerCase()} debug polling error`, error)
          Toast.notify({ type: 'error', message: `${debugLabel} debug request failed` })
          clearAbortController()
          setWorkflowRunningData({
            result: {
              status: WorkflowRunningStatus.Failed,
              error: `${debugLabel} debug request failed`,
              inputs_truncated: false,
              process_data_truncated: false,
              outputs_truncated: false,
            },
            tracing: [],
          })
          clearListeningState()
        }
      }

      await poll()
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
  }, [store, doSyncWorkflowDraft, workflowStore, pathname, handleWorkflowStarted, handleWorkflowFinished, fetchInspectVars, invalidAllLastRun, handleWorkflowFailed, handleWorkflowNodeStarted, handleWorkflowNodeFinished, handleWorkflowNodeIterationStarted, handleWorkflowNodeIterationNext, handleWorkflowNodeIterationFinished, handleWorkflowNodeLoopStarted, handleWorkflowNodeLoopNext, handleWorkflowNodeLoopFinished, handleWorkflowNodeRetry, handleWorkflowAgentLog, handleWorkflowTextChunk, handleWorkflowTextReplace],
  )

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
