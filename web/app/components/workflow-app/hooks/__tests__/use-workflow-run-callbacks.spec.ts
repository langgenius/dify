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
    expect(trackWorkflowRunFailed).toHaveBeenCalledWith({ error: 'failed', node_type: 'llm' })

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
  })
})
