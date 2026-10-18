import { act } from '@testing-library/react'
import {
  baseRunningData,
  renderWorkflowHook as renderHook,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useSnippetRun } from '../use-snippet-run'

const mocks = vi.hoisted(() => {
  return {
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

vi.mock('reactflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('reactflow')>()),
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

vi.mock('@/app/components/workflow/hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({
    handleUpdateWorkflowCanvas: mocks.mockHandleUpdateWorkflowCanvas,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-run-event/use-workflow-run-event', () => ({
  useWorkflowRunEvent: () => mocks.runEventHandlers,
}))

vi.mock('@/service/base', () => ({
  ssePost: mocks.mockSsePost,
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidateAllLastRun: () => mocks.mockInvalidateAllLastRun,
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

describe('useSnippetRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stops a snippet workflow with the provided task id', () => {
    const { result, store } = renderHook(() => useSnippetRun(), {
      resource: { kind: 'snippet', snippetId: 'snippet-1' },
      initialStoreState: { workflowRunningData: baseRunningData({ task_id: 'task-from-store' }) },
    })

    act(() => {
      result.current.handleStopRun('task-1')
    })

    expect(mocks.mockStopWorkflowRun).toHaveBeenCalledWith(
      '/snippets/snippet-1/workflow-runs/tasks/task-1/stop',
    )
    expect(store.getState().workflowRunningData?.result.status).toBe(WorkflowRunningStatus.Stopped)
  })

  it('does not fall back to the workflow running task id when stop is called without one', () => {
    const { result, store } = renderHook(() => useSnippetRun(), {
      resource: { kind: 'snippet', snippetId: 'snippet-1' },
      initialStoreState: { workflowRunningData: baseRunningData({ task_id: 'task-from-store' }) },
    })

    act(() => {
      result.current.handleStopRun('')
    })

    expect(mocks.mockStopWorkflowRun).not.toHaveBeenCalled()
    expect(store.getState().workflowRunningData?.result.status).toBe(WorkflowRunningStatus.Stopped)
  })
})
