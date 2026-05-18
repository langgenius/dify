import type { HandleRunOptions } from './use-workflow-run-utils'
import type AudioPlayer from '@/app/components/base/audio-btn/audio'
import type { Node } from '@/app/components/workflow/types'
import type { IOtherOptions } from '@/service/base'
import type { VersionHistory } from '@/types/workflow'
import { noop } from 'es-toolkit/function'
import { produce } from 'immer'
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
import { TriggerType } from '@/app/components/workflow/header/test-run-menu'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-interactions'
import { useWorkflowRunEvent } from '@/app/components/workflow/hooks/use-workflow-run-event/use-workflow-run-event'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { usePathname } from '@/next/navigation'
import { ssePost } from '@/service/base'
import { useInvalidAllLastRun, useInvalidateWorkflowRunHistory } from '@/service/use-workflow'
import { stopWorkflowRun } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { useSetWorkflowVarsWithValue } from '../../workflow/hooks/use-fetch-workflow-inspect-vars'
import { useConfigsMap } from './use-configs-map'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import {
  createBaseWorkflowRunCallbacks,
  createFinalWorkflowRunCallbacks,
} from './use-workflow-run-callbacks'
import {
  applyRunningStateForMode,
  applyStoppedState,
  buildRunHistoryUrl,
  buildTTSConfig,
  buildWorkflowRunRequestBody,
  clearListeningState,
  clearWindowDebugControllers,

  isDebuggableTriggerType,
  mapPublishedWorkflowFeatures,
  normalizePublishedWorkflowNodes,
  resolveWorkflowRunUrl,
  runTriggerDebug,
  validateWorkflowRunRequest,
} from './use-workflow-run-utils'

type WorkflowRunParams = Record<string, unknown> & {
  token?: string
  appId?: string
}

type DebugAbortController = {
  abort: () => void
}

type WorkflowDebugWindow = Window & {
  __webhookDebugAbortController?: DebugAbortController
  __pluginDebugAbortController?: DebugAbortController
  __scheduleDebugAbortController?: DebugAbortController
  __allTriggersDebugAbortController?: DebugAbortController
}

const stringifyWorkflowData = (workflowData: unknown) => {
  if (!workflowData)
    return undefined

  try {
    return JSON.stringify(workflowData)
  }
  catch {
    return undefined
  }
}

const getWorkflowStatus = (workflowData: unknown) => {
  if (typeof workflowData !== 'object' || workflowData === null)
    return undefined

  const result = (workflowData as Record<string, unknown>).result
  if (typeof result !== 'object' || result === null)
    return undefined

  const status = (result as Record<string, unknown>).status
  return typeof status === 'string' ? status : undefined
}

const getWorkflowTracingCount = (workflowData: unknown) => {
  if (typeof workflowData !== 'object' || workflowData === null)
    return undefined

  const tracing = (workflowData as Record<string, unknown>).tracing
  return Array.isArray(tracing) ? tracing.length : undefined
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
  const invalidateRunHistory = useInvalidateWorkflowRunHistory()

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

  const handleRun = useCallback(async (
    params: WorkflowRunParams | null | undefined,
    callback?: IOtherOptions,
    options?: HandleRunOptions,
  ) => {
    const runMode = options?.mode ?? TriggerType.UserInput
    const resolvedParams: WorkflowRunParams = params ?? {}
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
      onWorkflowPaused,
      onHumanInputRequired,
      onHumanInputFormFilled,
      onHumanInputFormTimeout,
      onCompleted,
      ...restCallback
    } = callback || {}
    workflowStore.setState({ historyWorkflowData: undefined })
    const appDetail = useAppStore.getState().appDetail
    const runHistoryUrl = buildRunHistoryUrl(appDetail)
    const workflowContainer = document.getElementById('workflow-container')

    const {
      clientWidth,
      clientHeight,
    } = workflowContainer!

    const isInWorkflowDebug = appDetail?.mode === AppModeEnum.WORKFLOW

    const url = resolveWorkflowRunUrl(appDetail, runMode, isInWorkflowDebug)
    const requestBody = buildWorkflowRunRequestBody(runMode, resolvedParams, options)

    if (!url)
      return

    const validationMessage = validateWorkflowRunRequest(runMode, options)
    if (validationMessage) {
      console.error(validationMessage)
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

    applyRunningStateForMode({
      setWorkflowRunningData,
      setIsListening,
      setShowVariableInspectPanel,
      setListeningTriggerType,
      setListeningTriggerNodeIds,
      setListeningTriggerIsAll,
      setListeningTriggerNodeId,
    }, runMode, options)

    const { ttsUrl, ttsIsPublic } = buildTTSConfig(resolvedParams, pathname)
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
      clearWindowDebugControllers(window as unknown as Record<string, unknown>)
    }

    const clearListeningStateInStore = () => {
      const state = workflowStore.getState()
      clearListeningState({
        setIsListening: state.setIsListening,
        setListeningTriggerType: state.setListeningTriggerType,
        setListeningTriggerNodeId: state.setListeningTriggerNodeId,
        setListeningTriggerNodeIds: state.setListeningTriggerNodeIds,
        setListeningTriggerIsAll: state.setListeningTriggerIsAll,
      })
    }

    const workflowRunEventHandlers = {
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
    }
    const userCallbacks = {
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
    }

    const getWorkflowRunningData = () => workflowStore.getState().workflowRunningData

    const trackWorkflowRunFailed = (eventParams: unknown, workflowData: unknown) => {
      const payload = typeof eventParams === 'object' && eventParams !== null
        ? eventParams as Record<string, unknown>
        : undefined
      const reason = typeof eventParams === 'string'
        ? eventParams
        : eventParams instanceof Error
          ? eventParams.message
          : typeof payload?.error === 'string'
            ? payload.error
            : undefined
      const nodeType = typeof payload?.node_type === 'string'
        ? payload.node_type
        : undefined

      trackEvent('workflow_run_failed', {
        workflow_id: flowId,
        reason,
        node_type: nodeType,
        data: {
          workflow_status: getWorkflowStatus(workflowData),
          workflow_tracing_count: getWorkflowTracingCount(workflowData),
          workflow_data: workflowData,
          workflow_data_json: stringifyWorkflowData(workflowData),
        },
      })
    }

    const baseSseOptions = createBaseWorkflowRunCallbacks({
      clientWidth,
      clientHeight,
      runHistoryUrl,
      isInWorkflowDebug,
      fetchInspectVars,
      invalidAllLastRun,
      invalidateRunHistory,
      clearAbortController,
      clearListeningState: clearListeningStateInStore,
      getWorkflowRunningData,
      trackWorkflowRunFailed,
      handlers: workflowRunEventHandlers,
      callbacks: userCallbacks,
      restCallback,
      getOrCreatePlayer,
    })

    if (isDebuggableTriggerType(runMode)) {
      await runTriggerDebug({
        debugType: runMode,
        url,
        requestBody,
        baseSseOptions,
        controllerTarget: window as unknown as Record<string, unknown>,
        setAbortController: (controller) => {
          abortControllerRef.current = controller
        },
        clearAbortController,
        clearListeningState: clearListeningStateInStore,
        setWorkflowRunningData,
      })
      return
    }

    const finalCallbacks = createFinalWorkflowRunCallbacks({
      clientWidth,
      clientHeight,
      runHistoryUrl,
      isInWorkflowDebug,
      fetchInspectVars,
      invalidAllLastRun,
      invalidateRunHistory,
      clearAbortController,
      clearListeningState: clearListeningStateInStore,
      getWorkflowRunningData,
      trackWorkflowRunFailed,
      handlers: workflowRunEventHandlers,
      callbacks: userCallbacks,
      restCallback,
      baseSseOptions,
      player,
      setAbortController: (controller) => {
        abortControllerRef.current = controller
      },
    })

    ssePost(
      url,
      {
        body: requestBody,
      },
      finalCallbacks,
    )
  }, [store, doSyncWorkflowDraft, workflowStore, pathname, handleWorkflowFailed, flowId, handleWorkflowStarted, handleWorkflowFinished, fetchInspectVars, invalidAllLastRun, invalidateRunHistory, handleWorkflowNodeStarted, handleWorkflowNodeFinished, handleWorkflowNodeIterationStarted, handleWorkflowNodeIterationNext, handleWorkflowNodeIterationFinished, handleWorkflowNodeLoopStarted, handleWorkflowNodeLoopNext, handleWorkflowNodeLoopFinished, handleWorkflowNodeRetry, handleWorkflowAgentLog, handleWorkflowTextChunk, handleWorkflowTextReplace, handleWorkflowPaused, handleWorkflowNodeHumanInputRequired, handleWorkflowNodeHumanInputFormFilled, handleWorkflowNodeHumanInputFormTimeout])

  const handleStopRun = useCallback((taskId: string) => {
    const setStoppedState = () => {
      const {
        setWorkflowRunningData,
        setIsListening,
        setShowVariableInspectPanel,
        setListeningTriggerType,
        setListeningTriggerNodeId,
      } = workflowStore.getState()

      applyStoppedState({
        setWorkflowRunningData,
        setIsListening,
        setShowVariableInspectPanel,
        setListeningTriggerType,
        setListeningTriggerNodeId,
      })
    }

    if (taskId) {
      const appId = useAppStore.getState().appDetail?.id
      stopWorkflowRun(`/apps/${appId}/workflow-runs/tasks/${taskId}/stop`)
      setStoppedState()
      return
    }

    // Try webhook debug controller from global variable first
    const debugWindow = window as WorkflowDebugWindow

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
    const nodes = normalizePublishedWorkflowNodes(publishedWorkflow)
    const edges = publishedWorkflow.graph.edges
    const viewport = publishedWorkflow.graph.viewport!
    handleUpdateWorkflowCanvas({
      nodes,
      edges,
      viewport,
    })
    featuresStore?.setState({ features: mapPublishedWorkflowFeatures(publishedWorkflow) })
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
