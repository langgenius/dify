import { act, renderHook } from '@testing-library/react'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useWorkflowRun } from '../use-workflow-run'

type DebugAbortControllerRef = {
  abort: () => void
}

type DebugControllerWindow = Window & {
  __webhookDebugAbortController?: DebugAbortControllerRef
  __pluginDebugAbortController?: DebugAbortControllerRef
  __scheduleDebugAbortController?: DebugAbortControllerRef
  __allTriggersDebugAbortController?: DebugAbortControllerRef
}

type WorkflowStoreState = {
  backupDraft?: unknown
  environmentVariables?: unknown
  setBackupDraft?: (value: unknown) => void
  setEnvironmentVariables?: (value: unknown) => void
  setWorkflowRunningData?: (value: unknown) => void
  setIsListening?: (value: boolean) => void
  setShowVariableInspectPanel?: (value: boolean) => void
  setListeningTriggerType?: (value: unknown) => void
  setListeningTriggerNodeIds?: (value: string[]) => void
  setListeningTriggerIsAll?: (value: boolean) => void
  setListeningTriggerNodeId?: (value: string | null) => void
}

const mocks = vi.hoisted(() => {
  const appStoreState = {
    appDetail: {
      id: 'app-1',
      mode: 'workflow',
      name: 'Workflow App',
    },
  }
  const reactFlowStoreState = {
    edges: [{ id: 'edge-1' }],
    getNodes: vi.fn(),
    setNodes: vi.fn(),
  }
  const workflowStoreState: WorkflowStoreState = {}
  const workflowStoreSetState = vi.fn((partial: Record<string, unknown>) => {
    Object.assign(workflowStoreState, partial)
  })
  const featuresStoreState = {
    features: {
      file: {
        enabled: true,
      },
    },
  }
  const featuresStoreSetState = vi.fn((partial: Record<string, unknown>) => {
    Object.assign(featuresStoreState, partial)
  })

  return {
    appStoreState,
    reactFlowStoreState,
    workflowStoreState,
    workflowStoreSetState,
    featuresStoreState,
    featuresStoreSetState,
    mockGetViewport: vi.fn(),
    mockDoSyncWorkflowDraft: vi.fn(),
    mockHandleUpdateWorkflowCanvas: vi.fn(),
    mockFetchInspectVars: vi.fn(),
    mockInvalidateAllLastRun: vi.fn(),
    mockInvalidateRunHistory: vi.fn(),
    mockSsePost: vi.fn(),
    mockSseGet: vi.fn(),
    mockHandleStream: vi.fn(),
    mockPost: vi.fn(),
    mockStopWorkflowRun: vi.fn(),
    mockTrackEvent: vi.fn(),
    mockResetMsgId: vi.fn(),
    runEventHandlers: {
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
    },
  }
})

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => mocks.reactFlowStoreState,
  }),
  useReactFlow: () => ({
    getViewport: mocks.mockGetViewport,
  }),
}))

vi.mock('@/app/components/app/store', () => {
  const useStore = Object.assign(vi.fn(), {
    getState: () => mocks.appStoreState,
  })

  return {
    useStore,
  }
})

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: mocks.mockTrackEvent,
}))

vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: () => ({
      getAudioPlayer: vi.fn(),
      resetMsgId: mocks.mockResetMsgId,
    }),
  },
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({
    getState: () => mocks.featuresStoreState,
    setState: mocks.featuresStoreSetState,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-interactions', () => ({
  useWorkflowUpdate: () => ({
    handleUpdateWorkflowCanvas: mocks.mockHandleUpdateWorkflowCanvas,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-run-event/use-workflow-run-event', () => ({
  useWorkflowRunEvent: () => mocks.runEventHandlers,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => mocks.workflowStoreState,
    setState: mocks.workflowStoreSetState,
  }),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/apps/app-1/workflow',
}))

vi.mock('@/service/base', () => ({
  ssePost: mocks.mockSsePost,
  sseGet: mocks.mockSseGet,
  post: mocks.mockPost,
  handleStream: mocks.mockHandleStream,
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidAllLastRun: () => mocks.mockInvalidateAllLastRun,
  useInvalidateWorkflowRunHistory: () => mocks.mockInvalidateRunHistory,
  useInvalidateConversationVarValues: () => vi.fn(),
  useInvalidateSysVarValues: () => vi.fn(),
}))

vi.mock('@/service/workflow', () => ({
  stopWorkflowRun: mocks.mockStopWorkflowRun,
}))

vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({
    fetchInspectVars: mocks.mockFetchInspectVars,
  }),
}))

vi.mock('../use-configs-map', () => ({
  useConfigsMap: () => ({
    flowId: 'flow-1',
    flowType: 'workflow',
  }),
}))

vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: mocks.mockDoSyncWorkflowDraft,
  }),
}))

const createWorkflowStoreState = () => ({
  backupDraft: undefined,
  environmentVariables: [{ id: 'env-current', value: 'secret' }],
  setBackupDraft: vi.fn((value: unknown) => {
    mocks.workflowStoreState.backupDraft = value
  }),
  setEnvironmentVariables: vi.fn((value: unknown) => {
    mocks.workflowStoreState.environmentVariables = value
  }),
  setWorkflowRunningData: vi.fn(),
  setIsListening: vi.fn(),
  setShowVariableInspectPanel: vi.fn(),
  setListeningTriggerType: vi.fn(),
  setListeningTriggerNodeIds: vi.fn(),
  setListeningTriggerIsAll: vi.fn(),
  setListeningTriggerNodeId: vi.fn(),
})

describe('useWorkflowRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = '<div id="workflow-container"></div>'
    const workflowContainer = document.getElementById('workflow-container')!
    Object.defineProperty(workflowContainer, 'clientWidth', { value: 960, configurable: true })
    Object.defineProperty(workflowContainer, 'clientHeight', { value: 540, configurable: true })

    mocks.reactFlowStoreState.getNodes.mockReturnValue([
      { id: 'node-1', data: { selected: true, _runningStatus: 'running' } },
    ])
    mocks.mockGetViewport.mockReturnValue({ x: 1, y: 2, zoom: 1.5 })
    mocks.mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    mocks.workflowStoreState.backupDraft = undefined
    Object.assign(mocks.workflowStoreState, createWorkflowStoreState())
    mocks.workflowStoreSetState.mockImplementation((partial: Record<string, unknown>) => {
      Object.assign(mocks.workflowStoreState, partial)
    })
    mocks.featuresStoreState.features = {
      file: {
        enabled: true,
      },
    }
  })

  it('should backup the current draft once and skip subsequent backups until it is cleared', () => {
    const { result } = renderHook(() => useWorkflowRun())

    act(() => {
      result.current.handleBackupDraft()
      result.current.handleBackupDraft()
    })

    expect(mocks.workflowStoreState.setBackupDraft).toHaveBeenCalledTimes(1)
    expect(mocks.workflowStoreState.setBackupDraft).toHaveBeenCalledWith({
      nodes: [{ id: 'node-1', data: { selected: true, _runningStatus: 'running' } }],
      edges: [{ id: 'edge-1' }],
      viewport: { x: 1, y: 2, zoom: 1.5 },
      features: { file: { enabled: true } },
      environmentVariables: [{ id: 'env-current', value: 'secret' }],
    })
    expect(mocks.mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('should load a backup draft into canvas, environment variables, and features state', () => {
    mocks.workflowStoreState.backupDraft = {
      nodes: [{ id: 'backup-node' }],
      edges: [{ id: 'backup-edge' }],
      viewport: { x: 0, y: 0, zoom: 2 },
      features: { opening: { enabled: true } },
      environmentVariables: [{ id: 'env-backup', value: 'value' }],
    }

    const { result } = renderHook(() => useWorkflowRun())

    act(() => {
      result.current.handleLoadBackupDraft()
    })

    expect(mocks.mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
      nodes: [{ id: 'backup-node' }],
      edges: [{ id: 'backup-edge' }],
      viewport: { x: 0, y: 0, zoom: 2 },
    })
    expect(mocks.workflowStoreState.setEnvironmentVariables).toHaveBeenCalledWith([{ id: 'env-backup', value: 'value' }])
    expect(mocks.featuresStoreSetState).toHaveBeenCalledWith({
      features: { opening: { enabled: true } },
    })
    expect(mocks.workflowStoreState.setBackupDraft).toHaveBeenCalledWith(undefined)
  })

  it('should prepare the graph and dispatch a workflow run through ssePost for user-input mode', async () => {
    const { result } = renderHook(() => useWorkflowRun())

    await act(async () => {
      await result.current.handleRun({ inputs: { query: 'hello' } })
    })

    expect(mocks.reactFlowStoreState.setNodes).toHaveBeenCalledWith([
      { id: 'node-1', data: { selected: false, _runningStatus: undefined } },
    ])
    expect(mocks.mockDoSyncWorkflowDraft).toHaveBeenCalled()
    expect(mocks.workflowStoreSetState).toHaveBeenCalledWith({ historyWorkflowData: undefined })
    expect(mocks.workflowStoreState.setIsListening).toHaveBeenCalledWith(false)
    expect(mocks.workflowStoreState.setListeningTriggerType).toHaveBeenCalledWith(null)
    expect(mocks.workflowStoreState.setListeningTriggerNodeId).toHaveBeenCalledWith(null)
    expect(mocks.workflowStoreState.setListeningTriggerNodeIds).toHaveBeenCalledWith([])
    expect(mocks.workflowStoreState.setListeningTriggerIsAll).toHaveBeenCalledWith(false)
    expect(mocks.workflowStoreState.setWorkflowRunningData).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        status: WorkflowRunningStatus.Running,
      }),
    }))
    expect(mocks.mockSsePost).toHaveBeenCalledWith(
      '/apps/app-1/workflows/draft/run',
      { body: { inputs: { query: 'hello' } } },
      expect.objectContaining({
        getAbortController: expect.any(Function),
      }),
    )
  })

  it('should stop workflow runs by task id or by aborting active debug controllers', () => {
    const { result } = renderHook(() => useWorkflowRun())

    act(() => {
      result.current.handleStopRun('task-1')
    })

    expect(mocks.mockStopWorkflowRun).toHaveBeenCalledWith('/apps/app-1/workflow-runs/tasks/task-1/stop')
    expect(mocks.workflowStoreState.setWorkflowRunningData).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({
        status: WorkflowRunningStatus.Stopped,
      }),
    }))

    const webhookAbort = vi.fn()
    const pluginAbort = vi.fn()
    const scheduleAbort = vi.fn()
    const allTriggersAbort = vi.fn()
    const windowWithDebugControllers = window as DebugControllerWindow
    windowWithDebugControllers.__webhookDebugAbortController = { abort: webhookAbort }
    windowWithDebugControllers.__pluginDebugAbortController = { abort: pluginAbort }
    windowWithDebugControllers.__scheduleDebugAbortController = { abort: scheduleAbort }
    windowWithDebugControllers.__allTriggersDebugAbortController = { abort: allTriggersAbort }

    act(() => {
      result.current.handleStopRun('')
    })

    expect(webhookAbort).toHaveBeenCalled()
    expect(pluginAbort).toHaveBeenCalled()
    expect(scheduleAbort).toHaveBeenCalled()
    expect(allTriggersAbort).toHaveBeenCalled()
  })

  it('should restore published workflow graph, features, and environment variables', () => {
    const { result } = renderHook(() => useWorkflowRun())

    act(() => {
      result.current.handleRestoreFromPublishedWorkflow({
        graph: {
          nodes: [{ id: 'published-node', selected: true, data: { selected: true, label: 'Published' } }],
          edges: [{ id: 'published-edge' }],
          viewport: { x: 10, y: 20, zoom: 0.8 },
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
        environment_variables: [{ id: 'env-published', value: 'value' }],
      } as never)
    })

    expect(mocks.mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
      nodes: [{ id: 'published-node', selected: false, data: { selected: false, label: 'Published' } }],
      edges: [{ id: 'published-edge' }],
      viewport: { x: 10, y: 20, zoom: 0.8 },
    })
    expect(mocks.featuresStoreSetState).toHaveBeenCalledWith({
      features: expect.objectContaining({
        opening: expect.objectContaining({
          enabled: true,
          opening_statement: 'hello',
        }),
        file: { enabled: true },
      }),
    })
    expect(mocks.workflowStoreState.setEnvironmentVariables).toHaveBeenCalledWith([{ id: 'env-published', value: 'value' }])
  })
})
