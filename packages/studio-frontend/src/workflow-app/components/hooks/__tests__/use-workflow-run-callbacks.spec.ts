import type AudioPlayer from '@/app/components/base/audio-btn/audio'
import { createBaseWorkflowRunCallbacks, createFinalWorkflowRunCallbacks } from '../use-workflow-run-callbacks'

const {
  mockSseGet,
  mockResetMsgId,
} = vi.hoisted(() => ({
  mockSseGet: vi.fn(),
  mockResetMsgId: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  sseGet: mockSseGet,
}))

vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: () => ({
      resetMsgId: mockResetMsgId,
    }),
  },
}))

const createHandlers = () => ({
  handleWorkflowStarted: vi.fn(),
  handleWorkflowFinished: vi.fn(),
  handleWorkflowFailed: vi.fn(),
  handleWorkflowNodeStarted: vi.fn(),
  handleWorkflowNodeFinished: vi.fn(),
  handleWorkflowNodeHumanInputRequired: vi.fn(),
  handleWorkflowNodeHumanInputFormFilled: vi.fn(),
  handleWorkflowNodeHumanInputFormTimeout: vi.fn(),
  handleWorkflowNodeIterationStarted: vi.fn(),
  handleWorkflowNodeIterationNext: vi.fn(),
  handleWorkflowNodeIterationFinished: vi.fn(),
  handleWorkflowNodeLoopStarted: vi.fn(),
  handleWorkflowNodeLoopNext: vi.fn(),
  handleWorkflowNodeLoopFinished: vi.fn(),
  handleWorkflowNodeRetry: vi.fn(),
  handleWorkflowAgentLog: vi.fn(),
  handleWorkflowTextChunk: vi.fn(),
  handleWorkflowTextReplace: vi.fn(),
  handleWorkflowPaused: vi.fn(),
})

const createUserCallbacks = () => ({
  onWorkflowStarted: vi.fn(),
  onWorkflowFinished: vi.fn(),
  onNodeStarted: vi.fn(),
  onNodeFinished: vi.fn(),
  onIterationStart: vi.fn(),
  onIterationNext: vi.fn(),
  onIterationFinish: vi.fn(),
  onLoopStart: vi.fn(),
  onLoopNext: vi.fn(),
  onLoopFinish: vi.fn(),
  onNodeRetry: vi.fn(),
  onAgentLog: vi.fn(),
  onError: vi.fn(),
  onWorkflowPaused: vi.fn(),
  onHumanInputRequired: vi.fn(),
  onHumanInputFormFilled: vi.fn(),
  onHumanInputFormTimeout: vi.fn(),
  onCompleted: vi.fn(),
})

const createWorkflowData = () => ({
  result: { status: 'running' },
  tracing: [{ node_id: 'node-1', status: 'running' }],
  resultText: 'partial result',
})

describe('useWorkflowRun callbacks helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create base callbacks that wrap workflow events, errors, pause continuation, and lazy tts playback', () => {
    const handlers = createHandlers()
    const clearAbortController = vi.fn()
    const clearListeningState = vi.fn()
    const invalidateRunHistory = vi.fn()
    const fetchInspectVars = vi.fn()
    const invalidAllLastRun = vi.fn()
    const trackWorkflowRunFailed = vi.fn()
    const workflowData = createWorkflowData()
    const getWorkflowRunningData = vi.fn(() => workflowData)
    const userOnWorkflowFinished = vi.fn()
    const userOnError = vi.fn()
    const userOnWorkflowPaused = vi.fn()
    const player = {
      playAudioWithAudio: vi.fn(),
    } as unknown as AudioPlayer
    const getOrCreatePlayer = vi.fn<() => AudioPlayer | null>(() => player)

    const callbacks = createBaseWorkflowRunCallbacks({
      clientWidth: 320,
      clientHeight: 240,
      runHistoryUrl: '/apps/app-1/workflow-runs',
      isInWorkflowDebug: true,
      fetchInspectVars,
      invalidAllLastRun,
      invalidateRunHistory,
      clearAbortController,
      clearListeningState,
      getWorkflowRunningData,
      trackWorkflowRunFailed,
      handlers,
      callbacks: {
        onWorkflowFinished: userOnWorkflowFinished,
        onError: userOnError,
        onWorkflowPaused: userOnWorkflowPaused,
      },
      restCallback: {},
      getOrCreatePlayer,
    })

    callbacks.onWorkflowFinished?.({ workflow_run_id: 'run-1' } as never)
    expect(clearListeningState).toHaveBeenCalled()
    expect(handlers.handleWorkflowFinished).toHaveBeenCalled()
    expect(invalidateRunHistory).toHaveBeenCalledWith('/apps/app-1/workflow-runs')
    expect(userOnWorkflowFinished).toHaveBeenCalled()
    expect(fetchInspectVars).toHaveBeenCalledWith({})
    expect(invalidAllLastRun).toHaveBeenCalled()

    callbacks.onError?.({ error: 'failed', node_type: 'llm' } as never)
    expect(clearAbortController).toHaveBeenCalled()
    expect(handlers.handleWorkflowFailed).toHaveBeenCalled()
    expect(userOnError).toHaveBeenCalled()
    expect(getWorkflowRunningData).toHaveBeenCalled()
    expect(trackWorkflowRunFailed).toHaveBeenCalledWith({ error: 'failed', node_type: 'llm' }, workflowData)

    callbacks.onTTSChunk?.('message-1', 'audio-chunk')
    expect(getOrCreatePlayer).toHaveBeenCalled()
    expect(player.playAudioWithAudio).toHaveBeenCalledWith('audio-chunk', true)
    expect(mockResetMsgId).toHaveBeenCalledWith('message-1')

    callbacks.onWorkflowPaused?.({ workflow_run_id: 'run-2' } as never)
    expect(handlers.handleWorkflowPaused).toHaveBeenCalled()
    expect(userOnWorkflowPaused).toHaveBeenCalled()
    expect(mockSseGet).toHaveBeenCalledWith('/workflow/run-2/events', {}, callbacks)
  })

  it('should create final callbacks that preserve rest callback override order and eager abort-controller wiring', () => {
    const handlers = createHandlers()
    const restOnNodeStarted = vi.fn()
    const setAbortController = vi.fn()
    const player = {
      playAudioWithAudio: vi.fn(),
    } as unknown as AudioPlayer

    const baseSseOptions = createBaseWorkflowRunCallbacks({
      clientWidth: 320,
      clientHeight: 240,
      runHistoryUrl: '/apps/app-1/workflow-runs',
      isInWorkflowDebug: false,
      fetchInspectVars: vi.fn(),
      invalidAllLastRun: vi.fn(),
      invalidateRunHistory: vi.fn(),
      clearAbortController: vi.fn(),
      clearListeningState: vi.fn(),
      getWorkflowRunningData: vi.fn(() => createWorkflowData()),
      trackWorkflowRunFailed: vi.fn(),
      handlers,
      callbacks: {},
      restCallback: {},
      getOrCreatePlayer: vi.fn<() => AudioPlayer | null>(() => player),
    })

    const finalCallbacks = createFinalWorkflowRunCallbacks({
      clientWidth: 320,
      clientHeight: 240,
      runHistoryUrl: '/apps/app-1/workflow-runs',
      isInWorkflowDebug: false,
      fetchInspectVars: vi.fn(),
      invalidAllLastRun: vi.fn(),
      invalidateRunHistory: vi.fn(),
      clearAbortController: vi.fn(),
      clearListeningState: vi.fn(),
      getWorkflowRunningData: vi.fn(() => createWorkflowData()),
      trackWorkflowRunFailed: vi.fn(),
      handlers,
      callbacks: {},
      restCallback: {
        onNodeStarted: restOnNodeStarted,
      },
      baseSseOptions,
      player,
      setAbortController,
    })

    const controller = new AbortController()
    finalCallbacks.getAbortController?.(controller)
    expect(setAbortController).toHaveBeenCalledWith(controller)

    finalCallbacks.onNodeStarted?.({ node_id: 'node-1' } as never)
    expect(restOnNodeStarted).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeStarted).not.toHaveBeenCalled()

    finalCallbacks.onTTSChunk?.('message-2', 'audio-chunk')
    expect(player.playAudioWithAudio).toHaveBeenCalledWith('audio-chunk', true)
    expect(mockResetMsgId).toHaveBeenCalledWith('message-2')

    finalCallbacks.onTTSChunk?.('message-3', '')
    expect(player.playAudioWithAudio).toHaveBeenCalledTimes(1)
    expect(mockResetMsgId).toHaveBeenCalledTimes(1)
  })

  it('should route base workflow events through handlers, user callbacks, and pause continuation with the same callback object', async () => {
    const handlers = createHandlers()
    const userCallbacks = createUserCallbacks()
    const clearAbortController = vi.fn()
    const clearListeningState = vi.fn()
    const invalidateRunHistory = vi.fn()
    const fetchInspectVars = vi.fn()
    const invalidAllLastRun = vi.fn()
    const trackWorkflowRunFailed = vi.fn()
    const workflowData = createWorkflowData()
    const getWorkflowRunningData = vi.fn(() => workflowData)
    const player = {
      playAudioWithAudio: vi.fn(),
    } as unknown as AudioPlayer

    const callbacks = createBaseWorkflowRunCallbacks({
      clientWidth: 640,
      clientHeight: 360,
      runHistoryUrl: '/apps/app-1/workflow-runs',
      isInWorkflowDebug: true,
      fetchInspectVars,
      invalidAllLastRun,
      invalidateRunHistory,
      clearAbortController,
      clearListeningState,
      getWorkflowRunningData,
      trackWorkflowRunFailed,
      handlers,
      callbacks: userCallbacks,
      restCallback: {},
      getOrCreatePlayer: vi.fn<() => AudioPlayer | null>(() => player),
    })

    callbacks.onWorkflowStarted?.({ workflow_run_id: 'run-1' } as never)
    callbacks.onNodeStarted?.({ node_id: 'node-1' } as never)
    callbacks.onNodeFinished?.({ node_id: 'node-1' } as never)
    callbacks.onIterationStart?.({ node_id: 'node-1' } as never)
    callbacks.onIterationNext?.({ node_id: 'node-1' } as never)
    callbacks.onIterationFinish?.({ node_id: 'node-1' } as never)
    callbacks.onLoopStart?.({ node_id: 'node-1' } as never)
    callbacks.onLoopNext?.({ node_id: 'node-1' } as never)
    callbacks.onLoopFinish?.({ node_id: 'node-1' } as never)
    callbacks.onNodeRetry?.({ node_id: 'node-1' } as never)
    callbacks.onAgentLog?.({ node_id: 'node-1' } as never)
    callbacks.onTextChunk?.({ data: 'chunk' } as never)
    callbacks.onTextReplace?.({ text: 'replacement' } as never)
    callbacks.onHumanInputRequired?.({ node_id: 'node-1' } as never)
    callbacks.onHumanInputFormFilled?.({ node_id: 'node-1' } as never)
    callbacks.onHumanInputFormTimeout?.({ node_id: 'node-1' } as never)
    callbacks.onWorkflowFinished?.({ workflow_run_id: 'run-1' } as never)
    await callbacks.onCompleted?.(false, '')
    callbacks.onTTSChunk?.('message-1', 'audio-chunk')
    callbacks.onTTSEnd?.('message-1', 'audio-finished')
    callbacks.onWorkflowPaused?.({ workflow_run_id: 'run-2' } as never)
    callbacks.onError?.({ error: 'failed', node_type: 'llm' } as never, '500')

    expect(handlers.handleWorkflowStarted).toHaveBeenCalled()
    expect(userCallbacks.onWorkflowStarted).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeStarted).toHaveBeenCalledWith(
      { node_id: 'node-1' },
      { clientWidth: 640, clientHeight: 360 },
    )
    expect(userCallbacks.onNodeStarted).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeFinished).toHaveBeenCalled()
    expect(userCallbacks.onNodeFinished).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeIterationStarted).toHaveBeenCalledWith(
      { node_id: 'node-1' },
      { clientWidth: 640, clientHeight: 360 },
    )
    expect(userCallbacks.onIterationStart).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeIterationNext).toHaveBeenCalled()
    expect(userCallbacks.onIterationNext).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeIterationFinished).toHaveBeenCalled()
    expect(userCallbacks.onIterationFinish).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeLoopStarted).toHaveBeenCalledWith(
      { node_id: 'node-1' },
      { clientWidth: 640, clientHeight: 360 },
    )
    expect(userCallbacks.onLoopStart).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeLoopNext).toHaveBeenCalled()
    expect(userCallbacks.onLoopNext).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeLoopFinished).toHaveBeenCalled()
    expect(userCallbacks.onLoopFinish).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeRetry).toHaveBeenCalled()
    expect(userCallbacks.onNodeRetry).toHaveBeenCalled()
    expect(handlers.handleWorkflowAgentLog).toHaveBeenCalled()
    expect(userCallbacks.onAgentLog).toHaveBeenCalled()
    expect(handlers.handleWorkflowTextChunk).toHaveBeenCalled()
    expect(handlers.handleWorkflowTextReplace).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeHumanInputRequired).toHaveBeenCalled()
    expect(userCallbacks.onHumanInputRequired).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeHumanInputFormFilled).toHaveBeenCalled()
    expect(userCallbacks.onHumanInputFormFilled).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeHumanInputFormTimeout).toHaveBeenCalled()
    expect(userCallbacks.onHumanInputFormTimeout).toHaveBeenCalled()
    expect(clearListeningState).toHaveBeenCalled()
    expect(handlers.handleWorkflowFinished).toHaveBeenCalled()
    expect(userCallbacks.onWorkflowFinished).toHaveBeenCalled()
    expect(fetchInspectVars).toHaveBeenCalledWith({})
    expect(invalidAllLastRun).toHaveBeenCalled()
    expect(userCallbacks.onCompleted).toHaveBeenCalledWith(false, '')
    expect(player.playAudioWithAudio).toHaveBeenCalledWith('audio-chunk', true)
    expect(player.playAudioWithAudio).toHaveBeenCalledWith('audio-finished', false)
    expect(mockResetMsgId).toHaveBeenCalledWith('message-1')
    expect(handlers.handleWorkflowPaused).toHaveBeenCalled()
    expect(userCallbacks.onWorkflowPaused).toHaveBeenCalled()
    expect(mockSseGet).toHaveBeenCalledWith('/workflow/run-2/events', {}, callbacks)
    expect(clearAbortController).toHaveBeenCalled()
    expect(handlers.handleWorkflowFailed).toHaveBeenCalled()
    expect(userCallbacks.onError).toHaveBeenCalledWith({ error: 'failed', node_type: 'llm' }, '500')
    expect(getWorkflowRunningData).toHaveBeenCalled()
    expect(trackWorkflowRunFailed).toHaveBeenCalledWith({ error: 'failed', node_type: 'llm' }, workflowData)
    expect(invalidateRunHistory).toHaveBeenCalledWith('/apps/app-1/workflow-runs')
  })

  it('should skip base debug-only side effects and audio playback when debug mode is off or audio is empty', () => {
    const handlers = createHandlers()
    const fetchInspectVars = vi.fn()
    const invalidAllLastRun = vi.fn()
    const getOrCreatePlayer = vi.fn<() => AudioPlayer | null>(() => null)

    const callbacks = createBaseWorkflowRunCallbacks({
      clientWidth: 320,
      clientHeight: 240,
      runHistoryUrl: '/apps/app-1/workflow-runs',
      isInWorkflowDebug: false,
      fetchInspectVars,
      invalidAllLastRun,
      invalidateRunHistory: vi.fn(),
      clearAbortController: vi.fn(),
      clearListeningState: vi.fn(),
      getWorkflowRunningData: vi.fn(() => createWorkflowData()),
      trackWorkflowRunFailed: vi.fn(),
      handlers,
      callbacks: {},
      restCallback: {},
      getOrCreatePlayer,
    })

    callbacks.onWorkflowFinished?.({ workflow_run_id: 'run-1' } as never)
    callbacks.onTTSChunk?.('message-1', '')
    callbacks.onTTSEnd?.('message-1', 'audio-finished')

    expect(fetchInspectVars).not.toHaveBeenCalled()
    expect(invalidAllLastRun).not.toHaveBeenCalled()
    expect(getOrCreatePlayer).toHaveBeenCalledTimes(1)
    expect(mockResetMsgId).not.toHaveBeenCalled()
  })

  it('should route final workflow events through handlers and continue paused runs with final callbacks', async () => {
    const handlers = createHandlers()
    const userCallbacks = createUserCallbacks()
    const fetchInspectVars = vi.fn()
    const invalidAllLastRun = vi.fn()
    const invalidateRunHistory = vi.fn()
    const clearAbortController = vi.fn()
    const clearListeningState = vi.fn()
    const trackWorkflowRunFailed = vi.fn()
    const workflowData = createWorkflowData()
    const getWorkflowRunningData = vi.fn(() => workflowData)
    const setAbortController = vi.fn()
    const player = {
      playAudioWithAudio: vi.fn(),
    } as unknown as AudioPlayer

    const baseSseOptions = createBaseWorkflowRunCallbacks({
      clientWidth: 480,
      clientHeight: 320,
      runHistoryUrl: '/apps/app-1/workflow-runs',
      isInWorkflowDebug: false,
      fetchInspectVars: vi.fn(),
      invalidAllLastRun: vi.fn(),
      invalidateRunHistory: vi.fn(),
      clearAbortController: vi.fn(),
      clearListeningState: vi.fn(),
      getWorkflowRunningData: vi.fn(() => createWorkflowData()),
      trackWorkflowRunFailed: vi.fn(),
      handlers,
      callbacks: {},
      restCallback: {},
      getOrCreatePlayer: vi.fn<() => AudioPlayer | null>(() => player),
    })

    const finalCallbacks = createFinalWorkflowRunCallbacks({
      clientWidth: 480,
      clientHeight: 320,
      runHistoryUrl: '/apps/app-1/workflow-runs',
      isInWorkflowDebug: true,
      fetchInspectVars,
      invalidAllLastRun,
      invalidateRunHistory,
      clearAbortController,
      clearListeningState,
      getWorkflowRunningData,
      trackWorkflowRunFailed,
      handlers,
      callbacks: userCallbacks,
      restCallback: {},
      baseSseOptions,
      player,
      setAbortController,
    })

    finalCallbacks.getAbortController?.(new AbortController())
    finalCallbacks.onWorkflowFinished?.({ workflow_run_id: 'run-1' } as never)
    finalCallbacks.onNodeStarted?.({ node_id: 'node-1' } as never)
    finalCallbacks.onNodeFinished?.({ node_id: 'node-1' } as never)
    finalCallbacks.onIterationStart?.({ node_id: 'node-1' } as never)
    finalCallbacks.onIterationNext?.({ node_id: 'node-1' } as never)
    finalCallbacks.onIterationFinish?.({ node_id: 'node-1' } as never)
    finalCallbacks.onLoopStart?.({ node_id: 'node-1' } as never)
    finalCallbacks.onLoopNext?.({ node_id: 'node-1' } as never)
    finalCallbacks.onLoopFinish?.({ node_id: 'node-1' } as never)
    finalCallbacks.onNodeRetry?.({ node_id: 'node-1' } as never)
    finalCallbacks.onAgentLog?.({ node_id: 'node-1' } as never)
    finalCallbacks.onTextChunk?.({ data: 'chunk' } as never)
    finalCallbacks.onTextReplace?.({ text: 'replacement' } as never)
    finalCallbacks.onHumanInputRequired?.({ node_id: 'node-1' } as never)
    finalCallbacks.onHumanInputFormFilled?.({ node_id: 'node-1' } as never)
    finalCallbacks.onHumanInputFormTimeout?.({ node_id: 'node-1' } as never)
    finalCallbacks.onWorkflowPaused?.({ workflow_run_id: 'run-2' } as never)
    finalCallbacks.onTTSChunk?.('message-2', 'audio-chunk')
    finalCallbacks.onTTSEnd?.('message-2', 'audio-finished')
    await finalCallbacks.onCompleted?.(true, 'done')
    finalCallbacks.onError?.({ error: 'failed' } as never, '500')

    expect(setAbortController).toHaveBeenCalled()
    expect(handlers.handleWorkflowFinished).toHaveBeenCalled()
    expect(userCallbacks.onWorkflowFinished).toHaveBeenCalled()
    expect(fetchInspectVars).toHaveBeenCalledWith({})
    expect(invalidAllLastRun).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeStarted).toHaveBeenCalledWith(
      { node_id: 'node-1' },
      { clientWidth: 480, clientHeight: 320 },
    )
    expect(handlers.handleWorkflowNodeIterationStarted).toHaveBeenCalledWith(
      { node_id: 'node-1' },
      { clientWidth: 480, clientHeight: 320 },
    )
    expect(handlers.handleWorkflowNodeLoopStarted).toHaveBeenCalledWith(
      { node_id: 'node-1' },
      { clientWidth: 480, clientHeight: 320 },
    )
    expect(userCallbacks.onNodeStarted).toHaveBeenCalled()
    expect(userCallbacks.onNodeFinished).toHaveBeenCalled()
    expect(userCallbacks.onIterationStart).toHaveBeenCalled()
    expect(userCallbacks.onIterationNext).toHaveBeenCalled()
    expect(userCallbacks.onIterationFinish).toHaveBeenCalled()
    expect(userCallbacks.onLoopStart).toHaveBeenCalled()
    expect(userCallbacks.onLoopNext).toHaveBeenCalled()
    expect(userCallbacks.onLoopFinish).toHaveBeenCalled()
    expect(userCallbacks.onNodeRetry).toHaveBeenCalled()
    expect(userCallbacks.onAgentLog).toHaveBeenCalled()
    expect(handlers.handleWorkflowTextChunk).toHaveBeenCalled()
    expect(handlers.handleWorkflowTextReplace).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeHumanInputRequired).toHaveBeenCalled()
    expect(userCallbacks.onHumanInputRequired).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeHumanInputFormFilled).toHaveBeenCalled()
    expect(userCallbacks.onHumanInputFormFilled).toHaveBeenCalled()
    expect(handlers.handleWorkflowNodeHumanInputFormTimeout).toHaveBeenCalled()
    expect(userCallbacks.onHumanInputFormTimeout).toHaveBeenCalled()
    expect(handlers.handleWorkflowPaused).toHaveBeenCalled()
    expect(userCallbacks.onWorkflowPaused).toHaveBeenCalled()
    expect(mockSseGet).toHaveBeenCalledWith('/workflow/run-2/events', {}, finalCallbacks)
    expect(player.playAudioWithAudio).toHaveBeenCalledWith('audio-chunk', true)
    expect(player.playAudioWithAudio).toHaveBeenCalledWith('audio-finished', false)
    expect(clearAbortController).toHaveBeenCalled()
    expect(handlers.handleWorkflowFailed).toHaveBeenCalled()
    expect(clearListeningState).toHaveBeenCalled()
    expect(userCallbacks.onError).toHaveBeenCalledWith({ error: 'failed' }, '500')
    expect(getWorkflowRunningData).toHaveBeenCalled()
    expect(trackWorkflowRunFailed).toHaveBeenCalledWith({ error: 'failed' }, workflowData)
    expect(invalidateRunHistory).toHaveBeenCalledWith('/apps/app-1/workflow-runs')
  })
})
