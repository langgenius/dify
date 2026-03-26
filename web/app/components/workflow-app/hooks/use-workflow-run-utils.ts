import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { TriggerNodeType } from '@/app/components/workflow/types'
import type { IOtherOptions } from '@/service/base'
import type { VersionHistory } from '@/types/workflow'
import { noop } from 'es-toolkit/function'
import { toast } from '@/app/components/base/ui/toast'
import { TriggerType } from '@/app/components/workflow/header/test-run-menu'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { handleStream, post } from '@/service/base'
import { ContentType } from '@/service/fetch'
import { AppModeEnum } from '@/types/app'

export type HandleRunMode = TriggerType
export type HandleRunOptions = {
  mode?: HandleRunMode
  scheduleNodeId?: string
  webhookNodeId?: string
  pluginNodeId?: string
  allNodeIds?: string[]
}

export type DebuggableTriggerType = Exclude<TriggerType, TriggerType.UserInput>

type AppDetailLike = {
  id?: string
  mode?: AppModeEnum
}

type TTSParamsLike = {
  token?: string
  appId?: string
}

type ListeningStateActions = {
  setWorkflowRunningData: (data: ReturnType<typeof createRunningWorkflowState> | ReturnType<typeof createFailedWorkflowState> | ReturnType<typeof createStoppedWorkflowState>) => void
  setIsListening: (value: boolean) => void
  setShowVariableInspectPanel: (value: boolean) => void
  setListeningTriggerType: (value: TriggerNodeType | null) => void
  setListeningTriggerNodeIds: (value: string[]) => void
  setListeningTriggerIsAll: (value: boolean) => void
  setListeningTriggerNodeId: (value: string | null) => void
}

type TriggerDebugRunnerOptions = {
  debugType: DebuggableTriggerType
  url: string
  requestBody: unknown
  baseSseOptions: IOtherOptions
  controllerTarget: Record<string, unknown>
  setAbortController: (controller: AbortController | null) => void
  clearAbortController: () => void
  clearListeningState: () => void
  setWorkflowRunningData: ListeningStateActions['setWorkflowRunningData']
}

export const controllerKeyMap: Record<DebuggableTriggerType, string> = {
  [TriggerType.Webhook]: '__webhookDebugAbortController',
  [TriggerType.Plugin]: '__pluginDebugAbortController',
  [TriggerType.All]: '__allTriggersDebugAbortController',
  [TriggerType.Schedule]: '__scheduleDebugAbortController',
}

export const debugLabelMap: Record<DebuggableTriggerType, string> = {
  [TriggerType.Webhook]: 'Webhook',
  [TriggerType.Plugin]: 'Plugin',
  [TriggerType.All]: 'All',
  [TriggerType.Schedule]: 'Schedule',
}

export const createRunningWorkflowState = () => {
  return {
    result: {
      status: WorkflowRunningStatus.Running,
      inputs_truncated: false,
      process_data_truncated: false,
      outputs_truncated: false,
    },
    tracing: [],
    resultText: '',
  }
}

export const createStoppedWorkflowState = () => {
  return {
    result: {
      status: WorkflowRunningStatus.Stopped,
      inputs_truncated: false,
      process_data_truncated: false,
      outputs_truncated: false,
    },
    tracing: [],
    resultText: '',
  }
}

export const createFailedWorkflowState = (error: string) => {
  return {
    result: {
      status: WorkflowRunningStatus.Failed,
      error,
      inputs_truncated: false,
      process_data_truncated: false,
      outputs_truncated: false,
    },
    tracing: [],
  }
}

export const buildRunHistoryUrl = (appDetail?: AppDetailLike) => {
  return appDetail?.mode === AppModeEnum.ADVANCED_CHAT
    ? `/apps/${appDetail.id}/advanced-chat/workflow-runs`
    : `/apps/${appDetail?.id}/workflow-runs`
}

export const resolveWorkflowRunUrl = (
  appDetail: AppDetailLike | undefined,
  runMode: HandleRunMode,
  isInWorkflowDebug: boolean,
) => {
  if (runMode === TriggerType.Plugin || runMode === TriggerType.Webhook || runMode === TriggerType.Schedule) {
    if (!appDetail?.id) {
      console.error('handleRun: missing app id for trigger plugin run')
      return ''
    }

    return `/apps/${appDetail.id}/workflows/draft/trigger/run`
  }

  if (runMode === TriggerType.All) {
    if (!appDetail?.id) {
      console.error('handleRun: missing app id for trigger run all')
      return ''
    }

    return `/apps/${appDetail.id}/workflows/draft/trigger/run-all`
  }

  if (appDetail?.mode === AppModeEnum.ADVANCED_CHAT)
    return `/apps/${appDetail.id}/advanced-chat/workflows/draft/run`

  if (isInWorkflowDebug && appDetail?.id)
    return `/apps/${appDetail.id}/workflows/draft/run`

  return ''
}

export const buildWorkflowRunRequestBody = (
  runMode: HandleRunMode,
  resolvedParams: Record<string, unknown>,
  options?: HandleRunOptions,
) => {
  if (runMode === TriggerType.Schedule)
    return { node_id: options?.scheduleNodeId }

  if (runMode === TriggerType.Webhook)
    return { node_id: options?.webhookNodeId }

  if (runMode === TriggerType.Plugin)
    return { node_id: options?.pluginNodeId }

  if (runMode === TriggerType.All)
    return { node_ids: options?.allNodeIds }

  return resolvedParams
}

export const validateWorkflowRunRequest = (
  runMode: HandleRunMode,
  options?: HandleRunOptions,
) => {
  if (runMode === TriggerType.Schedule && !options?.scheduleNodeId)
    return 'handleRun: schedule trigger run requires node id'

  if (runMode === TriggerType.Webhook && !options?.webhookNodeId)
    return 'handleRun: webhook trigger run requires node id'

  if (runMode === TriggerType.Plugin && !options?.pluginNodeId)
    return 'handleRun: plugin trigger run requires node id'

  if (runMode === TriggerType.All && !options?.allNodeIds && options?.allNodeIds?.length === 0)
    return 'handleRun: all trigger run requires node ids'

  return ''
}

export const isDebuggableTriggerType = (
  runMode: HandleRunMode,
): runMode is DebuggableTriggerType => {
  return (
    runMode === TriggerType.Schedule
    || runMode === TriggerType.Webhook
    || runMode === TriggerType.Plugin
    || runMode === TriggerType.All
  )
}

export const buildListeningTriggerNodeIds = (
  runMode: DebuggableTriggerType,
  options?: HandleRunOptions,
) => {
  if (runMode === TriggerType.All)
    return options?.allNodeIds ?? []

  if (runMode === TriggerType.Webhook && options?.webhookNodeId)
    return [options.webhookNodeId]

  if (runMode === TriggerType.Schedule && options?.scheduleNodeId)
    return [options.scheduleNodeId]

  if (runMode === TriggerType.Plugin && options?.pluginNodeId)
    return [options.pluginNodeId]

  return []
}

export const applyRunningStateForMode = (
  actions: ListeningStateActions,
  runMode: HandleRunMode,
  options?: HandleRunOptions,
) => {
  if (isDebuggableTriggerType(runMode)) {
    actions.setIsListening(true)
    actions.setShowVariableInspectPanel(true)
    actions.setListeningTriggerIsAll(runMode === TriggerType.All)
    actions.setListeningTriggerNodeIds(buildListeningTriggerNodeIds(runMode, options))
    actions.setWorkflowRunningData(createRunningWorkflowState())
    return
  }

  actions.setIsListening(false)
  actions.setListeningTriggerType(null)
  actions.setListeningTriggerNodeId(null)
  actions.setListeningTriggerNodeIds([])
  actions.setListeningTriggerIsAll(false)
  actions.setWorkflowRunningData(createRunningWorkflowState())
}

export const clearListeningState = (actions: Pick<ListeningStateActions, 'setIsListening' | 'setListeningTriggerType' | 'setListeningTriggerNodeId' | 'setListeningTriggerNodeIds' | 'setListeningTriggerIsAll'>) => {
  actions.setIsListening(false)
  actions.setListeningTriggerType(null)
  actions.setListeningTriggerNodeId(null)
  actions.setListeningTriggerNodeIds([])
  actions.setListeningTriggerIsAll(false)
}

export const applyStoppedState = (actions: Pick<ListeningStateActions, 'setWorkflowRunningData' | 'setIsListening' | 'setShowVariableInspectPanel' | 'setListeningTriggerType' | 'setListeningTriggerNodeId'>) => {
  actions.setWorkflowRunningData(createStoppedWorkflowState())
  actions.setIsListening(false)
  actions.setListeningTriggerType(null)
  actions.setListeningTriggerNodeId(null)
  actions.setShowVariableInspectPanel(true)
}

export const clearWindowDebugControllers = (controllerTarget: Record<string, unknown>) => {
  delete controllerTarget.__webhookDebugAbortController
  delete controllerTarget.__pluginDebugAbortController
  delete controllerTarget.__scheduleDebugAbortController
  delete controllerTarget.__allTriggersDebugAbortController
}

export const buildTTSConfig = (resolvedParams: TTSParamsLike, pathname: string) => {
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

  return {
    ttsUrl,
    ttsIsPublic,
  }
}

export const mapPublishedWorkflowFeatures = (publishedWorkflow: VersionHistory): FeaturesData => {
  return {
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
}

export const normalizePublishedWorkflowNodes = (publishedWorkflow: VersionHistory) => {
  return publishedWorkflow.graph.nodes.map(node => ({
    ...node,
    selected: false,
    data: {
      ...node.data,
      selected: false,
    },
  }))
}

export const waitWithAbort = (signal: AbortSignal, delay: number) => new Promise<void>((resolve) => {
  const timer = window.setTimeout(resolve, delay)
  signal.addEventListener('abort', () => {
    clearTimeout(timer)
    resolve()
  }, { once: true })
})

export const runTriggerDebug = async ({
  debugType,
  url,
  requestBody,
  baseSseOptions,
  controllerTarget,
  setAbortController,
  clearAbortController,
  clearListeningState,
  setWorkflowRunningData,
}: TriggerDebugRunnerOptions) => {
  const controller = new AbortController()
  setAbortController(controller)

  const controllerKey = controllerKeyMap[debugType]
  controllerTarget[controllerKey] = controller

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
        toast.error(message)
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
          toast.error(`${debugLabel} debug request failed`)
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

        const errorMessage = typeof data?.message === 'string' ? data.message : `${debugLabel} debug failed`
        toast.error(errorMessage)
        clearAbortController()
        setWorkflowRunningData(createFailedWorkflowState(errorMessage))
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
        const errorMessage = typeof data?.error === 'string' ? data.error : ''
        toast.error(errorMessage)
        clearAbortController()
        setWorkflowRunningData(createFailedWorkflowState(errorMessage))
      }

      clearListeningState()
    }
  }

  await poll()
}
