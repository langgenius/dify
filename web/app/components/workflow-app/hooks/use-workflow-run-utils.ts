import type {
  AdvancedChatWorkflowRunPayload,
  AppMode,
  DraftWorkflowRunPayload,
  DraftWorkflowTriggerRunAllPayload,
  DraftWorkflowTriggerRunPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { TriggerNodeType } from '@/app/components/workflow/types'
import type { StreamCallbacks, StreamRequest } from '@/service/event-stream'
import { noop } from 'es-toolkit/function'
import { isInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import { TriggerType } from '@/app/components/workflow/header/test-run-menu'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { toFeaturesData, toGraphNodes } from '@/app/components/workflow/utils/published-workflow'
import { toast } from '@/app/notifications'
import { consoleClient } from '@/service/console'
import { streamEvents } from '@/service/event-stream'

export type HandleRunOptions = {
  mode?: TriggerType
  scheduleNodeId?: string
  webhookNodeId?: string
  pluginNodeId?: string
  allNodeIds?: string[]
}

type DebuggableTriggerType = Exclude<TriggerType, typeof TriggerType.UserInput>

type AppDetailLike = {
  id?: string
  mode?: AppMode
}

type TTSParamsLike = {
  token?: string
  appId?: string
}

type ListeningStateActions = {
  setWorkflowRunningData: (
    data:
      | ReturnType<typeof createRunningWorkflowState>
      | ReturnType<typeof createFailedWorkflowState>
      | ReturnType<typeof createStoppedWorkflowState>,
  ) => void
  setIsListening: (value: boolean) => void
  setShowVariableInspectPanel: (value: boolean) => void
  setListeningTriggerType: (value: TriggerNodeType | null) => void
  setListeningTriggerNodeIds: (value: string[]) => void
  setListeningTriggerIsAll: (value: boolean) => void
  setListeningTriggerNodeId: (value: string | null) => void
}

type TriggerDebugRunnerOptions = {
  debugType: DebuggableTriggerType
  request: StreamRequest
  baseSseOptions: StreamCallbacks
  controllerTarget: Record<string, unknown>
  setAbortController: (controller: AbortController | null) => void
  clearAbortController: () => void
  clearListeningState: () => void
  setWorkflowRunningData: ListeningStateActions['setWorkflowRunningData']
}

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

const createRunningWorkflowState = () => {
  return {
    result: {
      status: WorkflowRunningStatus.Running,
      inputs_truncated: false,
      process_data_truncated: false,
      outputs_truncated: false,
    },
    tracing: [],
    resultText: '',
    reasoningContent: {},
    reasoningFinished: false,
  }
}

const createStoppedWorkflowState = () => {
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

const createFailedWorkflowState = (error: string) => {
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

/**
 * Picks the run endpoint for the trigger mode and app; the body comes from
 * `buildWorkflowRunRequestBody`.
 */
export const resolveWorkflowRunRequest = (
  appDetail: AppDetailLike | undefined,
  runMode: TriggerType,
  isInWorkflowDebug: boolean,
  requestBody: unknown,
): StreamRequest | undefined => {
  if (
    runMode === TriggerType.Plugin ||
    runMode === TriggerType.Webhook ||
    runMode === TriggerType.Schedule
  ) {
    if (!appDetail?.id) {
      console.error('handleRun: missing app id for trigger plugin run')
      return undefined
    }

    const params = { app_id: appDetail.id }
    // `validateWorkflowRunRequest` checks the trigger node id before the request is sent.
    const body = requestBody as DraftWorkflowTriggerRunPayload
    return (options) =>
      consoleClient.apps.byAppId.workflows.draft.trigger.run.post({ params, body }, options)
  }

  if (runMode === TriggerType.All) {
    if (!appDetail?.id) {
      console.error('handleRun: missing app id for trigger run all')
      return undefined
    }

    const params = { app_id: appDetail.id }
    const body = requestBody as DraftWorkflowTriggerRunAllPayload
    return (options) =>
      consoleClient.apps.byAppId.workflows.draft.trigger.runAll.post({ params, body }, options)
  }

  if (appDetail?.mode === 'advanced-chat') {
    const params = { app_id: appDetail.id! }
    // The run params come from the editor's start form and the chat input.
    const body = requestBody as AdvancedChatWorkflowRunPayload
    return (options) =>
      consoleClient.apps.byAppId.advancedChat.workflows.draft.run.post({ params, body }, options)
  }

  if (isInWorkflowDebug && appDetail?.id) {
    const params = { app_id: appDetail.id }
    // The run params come from the editor's start form.
    const body = requestBody as DraftWorkflowRunPayload
    return (options) =>
      consoleClient.apps.byAppId.workflows.draft.run.post({ params, body }, options)
  }

  return undefined
}

export const buildWorkflowRunRequestBody = (
  runMode: TriggerType,
  resolvedParams: Record<string, unknown>,
  options?: HandleRunOptions,
) => {
  if (runMode === TriggerType.Schedule) return { node_id: options?.scheduleNodeId }

  if (runMode === TriggerType.Webhook) return { node_id: options?.webhookNodeId }

  if (runMode === TriggerType.Plugin) return { node_id: options?.pluginNodeId }

  if (runMode === TriggerType.All) return { node_ids: options?.allNodeIds }

  return resolvedParams
}

export const validateWorkflowRunRequest = (runMode: TriggerType, options?: HandleRunOptions) => {
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

export const isDebuggableTriggerType = (runMode: TriggerType): runMode is DebuggableTriggerType => {
  return (
    runMode === TriggerType.Schedule ||
    runMode === TriggerType.Webhook ||
    runMode === TriggerType.Plugin ||
    runMode === TriggerType.All
  )
}

const buildListeningTriggerNodeIds = (
  runMode: DebuggableTriggerType,
  options?: HandleRunOptions,
) => {
  if (runMode === TriggerType.All) return options?.allNodeIds ?? []

  if (runMode === TriggerType.Webhook && options?.webhookNodeId) return [options.webhookNodeId]

  if (runMode === TriggerType.Schedule && options?.scheduleNodeId) return [options.scheduleNodeId]

  if (runMode === TriggerType.Plugin && options?.pluginNodeId) return [options.pluginNodeId]

  return []
}

export const applyRunningStateForMode = (
  actions: ListeningStateActions,
  runMode: TriggerType,
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

export const clearListeningState = (
  actions: Pick<
    ListeningStateActions,
    | 'setIsListening'
    | 'setListeningTriggerType'
    | 'setListeningTriggerNodeId'
    | 'setListeningTriggerNodeIds'
    | 'setListeningTriggerIsAll'
  >,
) => {
  actions.setIsListening(false)
  actions.setListeningTriggerType(null)
  actions.setListeningTriggerNodeId(null)
  actions.setListeningTriggerNodeIds([])
  actions.setListeningTriggerIsAll(false)
}

export const applyStoppedState = (
  actions: Pick<
    ListeningStateActions,
    | 'setWorkflowRunningData'
    | 'setIsListening'
    | 'setShowVariableInspectPanel'
    | 'setListeningTriggerType'
    | 'setListeningTriggerNodeId'
  >,
) => {
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
  } else if (resolvedParams.appId) {
    if (isInstalledAppPath(pathname))
      ttsUrl = `/installed-apps/${resolvedParams.appId}/text-to-audio`
    else ttsUrl = `/apps/${resolvedParams.appId}/text-to-audio`
  }

  return {
    ttsUrl,
    ttsIsPublic,
  }
}

// Published versions store features and graph as free-form JSON; narrow them for the editor.
export const mapPublishedWorkflowFeatures = (publishedWorkflow: {
  features: Record<string, unknown>
}): FeaturesData => toFeaturesData(publishedWorkflow.features)

export const normalizePublishedWorkflowNodes = (publishedWorkflow: {
  graph: Record<string, unknown>
}) => {
  return toGraphNodes(publishedWorkflow.graph).map((node) => ({
    ...node,
    selected: false,
    data: {
      ...node.data,
      selected: false,
    },
  }))
}

const waitWithAbort = (signal: AbortSignal, delay: number) =>
  new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, delay)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

/**
 * The trigger stream used to hand its events straight to the stream parser, so stream errors
 * reached `onData` only, without the run's error handler or a notification.
 */
const toTriggerStreamCallbacks = ({
  onError: _onError,
  onNotifyError: _onNotifyError,
  getAbortController: _getAbortController,
  onReasoning: _onReasoning,
  onUnhandledEvent: _onUnhandledEvent,
  isPublicAPI: _isPublicAPI,
  ...callbacks
}: StreamCallbacks): StreamCallbacks => ({
  ...callbacks,
  onNotifyError: noop,
  onError: (_message, _code, moreInfo) => {
    if (moreInfo) callbacks.onData?.('', false, moreInfo)
  },
})

const isEventStream = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === 'object' && value !== null && Symbol.asyncIterator in value

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const runTriggerDebug = async ({
  debugType,
  request,
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
      // The endpoint answers with JSON while it waits for a trigger event, then with the run's
      // event stream.
      const response = await request({
        signal: controller.signal,
        context: { stream: true },
      })

      if (controller.signal.aborted) return

      if (!isEventStream(response)) {
        const data = isRecord(response) ? response : null

        if (data?.status === 'waiting') {
          const delay = Number(data.retry_in) || 2000
          await waitWithAbort(controller.signal, delay)
          if (controller.signal.aborted) return
          await poll()
          return
        }

        const errorMessage =
          typeof data?.message === 'string' ? data.message : `${debugLabel} debug failed`
        toast.error(errorMessage)
        clearAbortController()
        setWorkflowRunningData(createFailedWorkflowState(errorMessage))
        clearListeningState()
        return
      }

      clearListeningState()
      // The request was sent with `controller`, which still aborts the stream.
      streamEvents(() => Promise.resolve(response), toTriggerStreamCallbacks(baseSseOptions))
    } catch (error) {
      if (controller.signal.aborted) return

      if (error instanceof Error) {
        const errorMessage = error.message
        toast.error(errorMessage)
        clearAbortController()
        setWorkflowRunningData(createFailedWorkflowState(errorMessage))
      }

      clearListeningState()
    }
  }

  await poll()
}
