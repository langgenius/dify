import { act, renderHook } from '@testing-library/react'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useSnippetRun } from '../use-snippet-run'

type WorkflowStoreState = {
  workflowRunningData?: {
    task_id?: string
    result: {
      status: string
      inputs_truncated: boolean
      process_data_truncated: boolean
      outputs_truncated: boolean
    }
    tracing: unknown[]
    resultText: string
  }
  setWorkflowRunningData: (data: WorkflowStoreState['workflowRunningData']) => void
  backupDraft?: unknown
  setBackupDraft: (data: unknown) => void
  setEnvironmentVariables: (data: unknown[]) => void
}

const mocks = vi.hoisted(() => {
  const workflowStoreState: WorkflowStoreState = {
    setWorkflowRunningData: vi.fn((data) => {
      workflowStoreState.workflowRunningData = data
    }),
    setBackupDraft: vi.fn(),
    setEnvironmentVariables: vi.fn(),
  }

  return {
    workflowStoreState,
    workflowStoreSetState: vi.fn((partial: Record<string, unknown>) => {
      Object.assign(workflowStoreState, partial)
    }),
    reactFlowStoreState: {
      getNodes: vi.fn(() => []),
      setNodes: vi.fn(),
      edges: [],
    },
    mockGetViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
    mockDoSyncWorkflowDraft: vi.fn(),
    mockHandleUpdateWorkflowCanvas: vi.fn(),
    mockFetchInspectVars: vi.fn(),
    mockInvalidateAllLastRun: vi.fn(),
    mockInvalidateRunHistory: vi.fn(),
    mockSsePost: vi.fn(),
    mockStopWorkflowRun: vi.fn(),
    runEventHandlers: {
      handleWorkflowStarted: vi.fn(),
      handleWorkflowFinished: vi.fn(),
      handleWorkflowFailed: vi.fn(),
      handleWorkflowNodeStarted: vi.fn(),
      handleWorkflowNodeFinished: vi.fn(),
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

vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({
    fetchInspectVars: mocks.mockFetchInspectVars,
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

vi.mock('@/service/base', () => ({
  ssePost: mocks.mockSsePost,
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidAllLastRun: () => mocks.mockInvalidateAllLastRun,
  useInvalidateWorkflowRunHistory: () => mocks.mockInvalidateRunHistory,
}))

vi.mock('@/service/workflow', () => ({
  stopWorkflowRun: mocks.mockStopWorkflowRun,
}))

vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: mocks.mockDoSyncWorkflowDraft,
  }),
}))

const createRunningData = (taskId?: string): WorkflowStoreState['workflowRunningData'] => ({
  task_id: taskId,
  result: {
    status: WorkflowRunningStatus.Running,
    inputs_truncated: false,
    process_data_truncated: false,
    outputs_truncated: false,
  },
  tracing: [],
  resultText: '',
})

describe('useSnippetRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workflowStoreState.workflowRunningData = undefined
    mocks.workflowStoreState.backupDraft = undefined
  })

  it('stops a snippet workflow with the provided task id', () => {
    mocks.workflowStoreState.workflowRunningData = createRunningData()
    const { result } = renderHook(() => useSnippetRun('snippet-1'))

    act(() => {
      result.current.handleStopRun('task-1')
    })

    expect(mocks.mockStopWorkflowRun).toHaveBeenCalledWith('/snippets/snippet-1/workflow-runs/tasks/task-1/stop')
    expect(mocks.workflowStoreState.workflowRunningData?.result.status).toBe(WorkflowRunningStatus.Stopped)
  })

  it('does not fall back to the workflow running task id when stop is called without one', () => {
    mocks.workflowStoreState.workflowRunningData = createRunningData('task-from-store')
    const { result } = renderHook(() => useSnippetRun('snippet-1'))

    act(() => {
      result.current.handleStopRun('')
    })

    expect(mocks.mockStopWorkflowRun).not.toHaveBeenCalled()
    expect(mocks.workflowStoreState.workflowRunningData?.result.status).toBe(WorkflowRunningStatus.Stopped)
  })

  it('does not call the stop endpoint when task id is unavailable', () => {
    mocks.workflowStoreState.workflowRunningData = createRunningData()
    const { result } = renderHook(() => useSnippetRun('snippet-1'))

    act(() => {
      result.current.handleStopRun('')
    })

    expect(mocks.mockStopWorkflowRun).not.toHaveBeenCalled()
    expect(mocks.workflowStoreState.workflowRunningData?.result.status).toBe(WorkflowRunningStatus.Stopped)
  })
})
