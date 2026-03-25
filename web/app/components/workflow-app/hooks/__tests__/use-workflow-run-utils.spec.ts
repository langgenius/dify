import { TriggerType } from '@/app/components/workflow/header/test-run-menu'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import {
  applyRunningStateForMode,
  applyStoppedState,
  buildListeningTriggerNodeIds,
  buildRunHistoryUrl,
  buildTTSConfig,
  buildWorkflowRunRequestBody,
  clearListeningState,
  clearWindowDebugControllers,
  createFailedWorkflowState,
  createRunningWorkflowState,
  createStoppedWorkflowState,
  mapPublishedWorkflowFeatures,
  normalizePublishedWorkflowNodes,
  resolveWorkflowRunUrl,
  runTriggerDebug,
  validateWorkflowRunRequest,
} from '../use-workflow-run-utils'

const {
  mockPost,
  mockHandleStream,
  mockToastError,
} = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockHandleStream: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  post: mockPost,
  handleStream: mockHandleStream,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

const createListeningActions = () => ({
  setWorkflowRunningData: vi.fn(),
  setIsListening: vi.fn(),
  setShowVariableInspectPanel: vi.fn(),
  setListeningTriggerType: vi.fn(),
  setListeningTriggerNodeIds: vi.fn(),
  setListeningTriggerIsAll: vi.fn(),
  setListeningTriggerNodeId: vi.fn(),
})

describe('useWorkflowRun utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should resolve run history urls and run endpoints for workflow modes', () => {
    expect(buildRunHistoryUrl({ id: 'app-1', mode: AppModeEnum.WORKFLOW })).toBe('/apps/app-1/workflow-runs')
    expect(buildRunHistoryUrl({ id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT })).toBe('/apps/app-1/advanced-chat/workflow-runs')

    expect(resolveWorkflowRunUrl({ id: 'app-1', mode: AppModeEnum.WORKFLOW }, TriggerType.UserInput, true)).toBe('/apps/app-1/workflows/draft/run')
    expect(resolveWorkflowRunUrl({ id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT }, TriggerType.UserInput, false)).toBe('/apps/app-1/advanced-chat/workflows/draft/run')
    expect(resolveWorkflowRunUrl({ id: 'app-1', mode: AppModeEnum.WORKFLOW }, TriggerType.Schedule, true)).toBe('/apps/app-1/workflows/draft/trigger/run')
    expect(resolveWorkflowRunUrl({ id: 'app-1', mode: AppModeEnum.WORKFLOW }, TriggerType.All, true)).toBe('/apps/app-1/workflows/draft/trigger/run-all')
  })

  it('should build request bodies and validation errors for trigger runs', () => {
    expect(buildWorkflowRunRequestBody(TriggerType.Schedule, {}, { scheduleNodeId: 'schedule-1' })).toEqual({ node_id: 'schedule-1' })
    expect(buildWorkflowRunRequestBody(TriggerType.Webhook, {}, { webhookNodeId: 'webhook-1' })).toEqual({ node_id: 'webhook-1' })
    expect(buildWorkflowRunRequestBody(TriggerType.Plugin, {}, { pluginNodeId: 'plugin-1' })).toEqual({ node_id: 'plugin-1' })
    expect(buildWorkflowRunRequestBody(TriggerType.All, {}, { allNodeIds: ['trigger-1', 'trigger-2'] })).toEqual({ node_ids: ['trigger-1', 'trigger-2'] })
    expect(buildWorkflowRunRequestBody(TriggerType.UserInput, { inputs: { query: 'hello' } })).toEqual({ inputs: { query: 'hello' } })

    expect(validateWorkflowRunRequest(TriggerType.Schedule)).toBe('handleRun: schedule trigger run requires node id')
    expect(validateWorkflowRunRequest(TriggerType.Webhook)).toBe('handleRun: webhook trigger run requires node id')
    expect(validateWorkflowRunRequest(TriggerType.Plugin)).toBe('handleRun: plugin trigger run requires node id')
    expect(validateWorkflowRunRequest(TriggerType.All)).toBe('')
    expect(validateWorkflowRunRequest(TriggerType.All, { allNodeIds: [] })).toBe('')
  })

  it('should return empty trigger urls when app id is missing and keep user-input urls empty outside workflow debug', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(resolveWorkflowRunUrl(undefined, TriggerType.Plugin, true)).toBe('')
    expect(resolveWorkflowRunUrl(undefined, TriggerType.All, true)).toBe('')
    expect(resolveWorkflowRunUrl({ id: 'app-1', mode: AppModeEnum.WORKFLOW }, TriggerType.UserInput, false)).toBe('')

    expect(consoleErrorSpy).toHaveBeenCalledWith('handleRun: missing app id for trigger plugin run')
    expect(consoleErrorSpy).toHaveBeenCalledWith('handleRun: missing app id for trigger run all')

    consoleErrorSpy.mockRestore()
  })

  it('should configure listening state for trigger and non-trigger modes', () => {
    const triggerActions = createListeningActions()

    applyRunningStateForMode(triggerActions, TriggerType.All, { allNodeIds: ['trigger-1', 'trigger-2'] })

    expect(triggerActions.setIsListening).toHaveBeenCalledWith(true)
    expect(triggerActions.setShowVariableInspectPanel).toHaveBeenCalledWith(true)
    expect(triggerActions.setListeningTriggerIsAll).toHaveBeenCalledWith(true)
    expect(triggerActions.setListeningTriggerNodeIds).toHaveBeenCalledWith(['trigger-1', 'trigger-2'])
    expect(triggerActions.setWorkflowRunningData).toHaveBeenCalledWith(createRunningWorkflowState())

    const normalActions = createListeningActions()
    applyRunningStateForMode(normalActions, TriggerType.UserInput)

    expect(normalActions.setIsListening).toHaveBeenCalledWith(false)
    expect(normalActions.setListeningTriggerType).toHaveBeenCalledWith(null)
    expect(normalActions.setListeningTriggerNodeId).toHaveBeenCalledWith(null)
    expect(normalActions.setListeningTriggerNodeIds).toHaveBeenCalledWith([])
    expect(normalActions.setListeningTriggerIsAll).toHaveBeenCalledWith(false)
    expect(normalActions.setWorkflowRunningData).toHaveBeenCalledWith(createRunningWorkflowState())
  })

  it('should clear listening state, stop state, and remove debug controllers', () => {
    const listeningActions = createListeningActions()
    clearListeningState(listeningActions)

    expect(listeningActions.setIsListening).toHaveBeenCalledWith(false)
    expect(listeningActions.setListeningTriggerType).toHaveBeenCalledWith(null)
    expect(listeningActions.setListeningTriggerNodeId).toHaveBeenCalledWith(null)
    expect(listeningActions.setListeningTriggerNodeIds).toHaveBeenCalledWith([])
    expect(listeningActions.setListeningTriggerIsAll).toHaveBeenCalledWith(false)

    const stoppedActions = createListeningActions()
    applyStoppedState(stoppedActions)

    expect(stoppedActions.setWorkflowRunningData).toHaveBeenCalledWith(createStoppedWorkflowState())
    expect(stoppedActions.setShowVariableInspectPanel).toHaveBeenCalledWith(true)

    const controllerTarget = {
      __webhookDebugAbortController: { abort: vi.fn() },
      __pluginDebugAbortController: { abort: vi.fn() },
      __scheduleDebugAbortController: { abort: vi.fn() },
      __allTriggersDebugAbortController: { abort: vi.fn() },
    }
    clearWindowDebugControllers(controllerTarget)
    expect(controllerTarget).toEqual({})
  })

  it('should derive listening node ids, tts config, and published workflow mappings', () => {
    expect(buildListeningTriggerNodeIds(TriggerType.Webhook, { webhookNodeId: 'webhook-1' })).toEqual(['webhook-1'])
    expect(buildListeningTriggerNodeIds(TriggerType.Schedule, { scheduleNodeId: 'schedule-1' })).toEqual(['schedule-1'])
    expect(buildListeningTriggerNodeIds(TriggerType.Plugin, { pluginNodeId: 'plugin-1' })).toEqual(['plugin-1'])
    expect(buildListeningTriggerNodeIds(TriggerType.All, { allNodeIds: ['trigger-1', 'trigger-2'] })).toEqual(['trigger-1', 'trigger-2'])

    expect(buildTTSConfig({ token: 'public-token' }, '/apps/app-1')).toEqual({
      ttsUrl: '/text-to-audio',
      ttsIsPublic: true,
    })
    expect(buildTTSConfig({ appId: 'app-1' }, '/explore/installed/app-1')).toEqual({
      ttsUrl: '/installed-apps/app-1/text-to-audio',
      ttsIsPublic: false,
    })
    expect(buildTTSConfig({ appId: 'app-1' }, '/apps/app-1/workflow')).toEqual({
      ttsUrl: '/apps/app-1/text-to-audio',
      ttsIsPublic: false,
    })

    const publishedWorkflow = {
      graph: {
        nodes: [{ id: 'node-1', selected: true, data: { selected: true, title: 'Start' } }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      features: {
        opening_statement: 'hello',
        suggested_questions: ['Q1'],
        suggested_questions_after_answer: { enabled: true },
        text_to_speech: { enabled: true },
        speech_to_text: { enabled: true },
        retriever_resource: { enabled: true },
        sensitive_word_avoidance: { enabled: true },
        file_upload: { enabled: true },
      },
    } as never

    expect(normalizePublishedWorkflowNodes(publishedWorkflow)).toEqual([
      { id: 'node-1', selected: false, data: { selected: false, title: 'Start' } },
    ])
    expect(mapPublishedWorkflowFeatures(publishedWorkflow)).toMatchObject({
      opening: {
        enabled: true,
        opening_statement: 'hello',
        suggested_questions: ['Q1'],
      },
      suggested: { enabled: true },
      text2speech: { enabled: true },
      speech2text: { enabled: true },
      citation: { enabled: true },
      moderation: { enabled: true },
      file: { enabled: true },
    })
  })

  it('should handle trigger debug null and invalid json responses as request failures', async () => {
    const clearAbortController = vi.fn()
    const clearListeningStateSpy = vi.fn()
    const setAbortController = vi.fn()
    const setWorkflowRunningData = vi.fn()
    const controllerTarget: Record<string, unknown> = {}
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockPost.mockResolvedValueOnce(null)

    await runTriggerDebug({
      debugType: TriggerType.Webhook,
      url: '/apps/app-1/workflows/draft/trigger/run',
      requestBody: { node_id: 'webhook-1' },
      baseSseOptions: {},
      controllerTarget,
      setAbortController,
      clearAbortController,
      clearListeningState: clearListeningStateSpy,
      setWorkflowRunningData,
    })

    expect(mockToastError).toHaveBeenCalledWith('Webhook debug request failed')
    expect(clearAbortController).toHaveBeenCalledTimes(1)
    expect(clearListeningStateSpy).not.toHaveBeenCalled()

    mockPost.mockResolvedValueOnce(new Response('{invalid-json}', {
      headers: { 'content-type': 'application/json' },
    }))

    await runTriggerDebug({
      debugType: TriggerType.Schedule,
      url: '/apps/app-1/workflows/draft/trigger/run',
      requestBody: { node_id: 'schedule-1' },
      baseSseOptions: {},
      controllerTarget,
      setAbortController,
      clearAbortController,
      clearListeningState: clearListeningStateSpy,
      setWorkflowRunningData,
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'handleRun: schedule debug response parse error',
      expect.any(Error),
    )
    expect(mockToastError).toHaveBeenCalledWith('Schedule debug request failed')
    expect(clearAbortController).toHaveBeenCalledTimes(2)
    expect(clearListeningStateSpy).toHaveBeenCalledTimes(1)
    expect(setWorkflowRunningData).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('should handle trigger debug json failures and stream responses', async () => {
    const clearAbortController = vi.fn()
    const clearListeningStateSpy = vi.fn()
    const setAbortController = vi.fn()
    const setWorkflowRunningData = vi.fn()
    const controllerTarget: Record<string, unknown> = {}
    const baseSseOptions = {
      onData: vi.fn(),
      onCompleted: vi.fn(),
    }

    mockPost.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Webhook failed' }), {
      headers: { 'content-type': 'application/json' },
    }))

    await runTriggerDebug({
      debugType: TriggerType.Webhook,
      url: '/apps/app-1/workflows/draft/trigger/run',
      requestBody: { node_id: 'webhook-1' },
      baseSseOptions,
      controllerTarget,
      setAbortController,
      clearAbortController,
      clearListeningState: clearListeningStateSpy,
      setWorkflowRunningData,
    })

    expect(setAbortController).toHaveBeenCalledTimes(1)
    expect(mockToastError).toHaveBeenCalledWith('Webhook failed')
    expect(clearAbortController).toHaveBeenCalled()
    expect(clearListeningStateSpy).toHaveBeenCalled()
    expect(setWorkflowRunningData).toHaveBeenCalledWith(createFailedWorkflowState('Webhook failed'))

    mockPost.mockResolvedValueOnce(new Response('data: ok', {
      headers: { 'content-type': 'text/event-stream' },
    }))

    await runTriggerDebug({
      debugType: TriggerType.Plugin,
      url: '/apps/app-1/workflows/draft/trigger/run',
      requestBody: { node_id: 'plugin-1' },
      baseSseOptions,
      controllerTarget,
      setAbortController,
      clearAbortController,
      clearListeningState: clearListeningStateSpy,
      setWorkflowRunningData,
    })

    expect(clearListeningStateSpy).toHaveBeenCalledTimes(2)
    expect(mockHandleStream).toHaveBeenCalledTimes(1)
  })

  it('should retry waiting trigger debug responses until a stream is returned', async () => {
    vi.useFakeTimers()
    const clearAbortController = vi.fn()
    const clearListeningStateSpy = vi.fn()
    const setAbortController = vi.fn()
    const setWorkflowRunningData = vi.fn()
    const controllerTarget: Record<string, unknown> = {}
    const baseSseOptions = {
      onData: vi.fn(),
      onCompleted: vi.fn(),
    }

    mockPost
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'waiting', retry_in: 1 }), {
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('data: ok', {
        headers: { 'content-type': 'text/event-stream' },
      }))

    const runPromise = runTriggerDebug({
      debugType: TriggerType.All,
      url: '/apps/app-1/workflows/draft/trigger/run-all',
      requestBody: { node_ids: ['trigger-1'] },
      baseSseOptions,
      controllerTarget,
      setAbortController,
      clearAbortController,
      clearListeningState: clearListeningStateSpy,
      setWorkflowRunningData,
    })

    await vi.advanceTimersByTimeAsync(1)
    await runPromise

    expect(mockPost).toHaveBeenCalledTimes(2)
    expect(clearListeningStateSpy).toHaveBeenCalledTimes(1)
    expect(mockHandleStream).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('should stop trigger debug processing when the controller aborts before handling the response', async () => {
    const clearAbortController = vi.fn()
    const clearListeningStateSpy = vi.fn()
    const setWorkflowRunningData = vi.fn()
    const controllerTarget: Record<string, unknown> = {}

    mockPost.mockResolvedValueOnce(new Response('data: ok', {
      headers: { 'content-type': 'text/event-stream' },
    }))

    await runTriggerDebug({
      debugType: TriggerType.Plugin,
      url: '/apps/app-1/workflows/draft/trigger/run',
      requestBody: { node_id: 'plugin-1' },
      baseSseOptions: {},
      controllerTarget,
      setAbortController: (controller) => {
        controller?.abort()
      },
      clearAbortController,
      clearListeningState: clearListeningStateSpy,
      setWorkflowRunningData,
    })

    expect(mockHandleStream).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
    expect(clearAbortController).not.toHaveBeenCalled()
    expect(clearListeningStateSpy).not.toHaveBeenCalled()
    expect(setWorkflowRunningData).not.toHaveBeenCalled()
  })

  it('should handle Response and non-Response trigger debug exceptions correctly', async () => {
    const clearAbortController = vi.fn()
    const clearListeningStateSpy = vi.fn()
    const setAbortController = vi.fn()
    const setWorkflowRunningData = vi.fn()
    const controllerTarget: Record<string, unknown> = {}

    mockPost.mockRejectedValueOnce(new Response(JSON.stringify({ error: 'Plugin failed' }), {
      headers: { 'content-type': 'application/json' },
    }))

    await runTriggerDebug({
      debugType: TriggerType.Plugin,
      url: '/apps/app-1/workflows/draft/trigger/run',
      requestBody: { node_id: 'plugin-1' },
      baseSseOptions: {},
      controllerTarget,
      setAbortController,
      clearAbortController,
      clearListeningState: clearListeningStateSpy,
      setWorkflowRunningData,
    })

    expect(mockToastError).toHaveBeenCalledWith('Plugin failed')
    expect(clearAbortController).toHaveBeenCalledTimes(1)
    expect(setWorkflowRunningData).toHaveBeenCalledWith(createFailedWorkflowState('Plugin failed'))
    expect(clearListeningStateSpy).toHaveBeenCalledTimes(1)

    mockPost.mockRejectedValueOnce(new Error('network failed'))

    await runTriggerDebug({
      debugType: TriggerType.Plugin,
      url: '/apps/app-1/workflows/draft/trigger/run',
      requestBody: { node_id: 'plugin-1' },
      baseSseOptions: {},
      controllerTarget,
      setAbortController,
      clearAbortController,
      clearListeningState: clearListeningStateSpy,
      setWorkflowRunningData,
    })

    expect(clearAbortController).toHaveBeenCalledTimes(1)
    expect(setWorkflowRunningData).toHaveBeenCalledTimes(1)
    expect(clearListeningStateSpy).toHaveBeenCalledTimes(2)
  })

  it('should expose the canonical workflow state factories', () => {
    expect(createRunningWorkflowState().result.status).toBe(WorkflowRunningStatus.Running)
    expect(createStoppedWorkflowState().result.status).toBe(WorkflowRunningStatus.Stopped)
    expect(createFailedWorkflowState('failed').result.status).toBe(WorkflowRunningStatus.Failed)
  })
})
