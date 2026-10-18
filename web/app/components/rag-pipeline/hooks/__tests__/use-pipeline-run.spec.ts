import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import { createDeferred } from '@/test/deferred'
import { usePipelineRunByCanEdit } from '../use-pipeline-run'

const mockStoreGetState = vi.fn()
const mockGetViewport = vi.fn()
vi.mock('reactflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('reactflow')>()),
  useStoreApi: () => ({
    getState: mockStoreGetState,
  }),
  useReactFlow: () => ({
    getViewport: mockGetViewport,
  }),
}))

const mockUseStore = vi.fn()
const mockWorkflowStoreGetState = vi.fn()
const mockWorkflowStoreSetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => mockUseStore(selector),
  useWorkflowStore: () => ({
    getState: mockWorkflowStoreGetState,
    setState: mockWorkflowStoreSetState,
  }),
}))

const mockDoSyncWorkflowDraft = vi.fn()
vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraftByCanEdit: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({
    fetchInspectVars: vi.fn(),
  }),
}))

const mockHandleUpdateWorkflowCanvas = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({
    handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas,
  }),
}))

const mockTextChunk = vi.fn()
const mockTextReplace = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-workflow-run-event/use-workflow-run-event', () => ({
  useWorkflowRunEvent: () => ({
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
    handleWorkflowTextChunk: mockTextChunk,
    handleWorkflowTextReplace: mockTextReplace,
  }),
}))

const mockSsePost = vi.fn()
vi.mock('@/service/base', () => ({
  ssePost: (url: string, ...args: unknown[]) => mockSsePost(url, ...args),
}))

const mockStopWorkflowRun = vi.fn()
vi.mock('@/service/workflow', () => ({
  stopWorkflowRun: (url: string) => mockStopWorkflowRun(url),
}))

const mockInvalidAllLastRun = vi.fn()
const mockInvalidateRunHistory = vi.fn()
vi.mock('@/service/use-workflow', () => ({
  useInvalidateAllLastRun: () => mockInvalidAllLastRun,
  useInvalidateWorkflowRunHistory: () => mockInvalidateRunHistory,
}))

const createPublishedWorkflow = (
  overrides: Partial<FetchWorkflowDraftResponse> = {},
): FetchWorkflowDraftResponse => ({
  id: 'published',
  hash: 'hash',
  version: '1',
  created_at: 1,
  updated_at: 1,
  created_by: { id: 'user', name: 'User', email: 'user@example.test' },
  updated_by: { id: 'user', name: 'User', email: 'user@example.test' },
  tool_published: false,
  marked_name: '',
  marked_comment: '',
  graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  ...overrides,
})

describe('usePipelineRunByCanEdit', () => {
  const mockSetNodes = vi.fn()
  const mockGetNodes = vi.fn()
  const mockSetBackupDraft = vi.fn()
  const mockSetEnvironmentVariables = vi.fn()
  const mockSetRagPipelineVariables = vi.fn()
  const mockSetWorkflowRunningData = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    const mockWorkflowContainer = document.createElement('div')
    mockWorkflowContainer.id = 'workflow-container'
    Object.defineProperty(mockWorkflowContainer, 'clientWidth', { value: 1000 })
    Object.defineProperty(mockWorkflowContainer, 'clientHeight', { value: 800 })
    document.body.appendChild(mockWorkflowContainer)

    mockStoreGetState.mockReturnValue({
      getNodes: mockGetNodes,
      setNodes: mockSetNodes,
      edges: [],
    })

    mockGetNodes.mockReturnValue([
      {
        id: 'node-1',
        data: { type: 'start', selected: true, _runningStatus: WorkflowRunningStatus.Running },
      },
    ])

    mockGetViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 })

    mockWorkflowStoreGetState.mockReturnValue({
      pipelineId: 'test-pipeline-id',
      backupDraft: undefined,
      environmentVariables: [],
      setBackupDraft: mockSetBackupDraft,
      setEnvironmentVariables: mockSetEnvironmentVariables,
      setRagPipelineVariables: mockSetRagPipelineVariables,
      setWorkflowRunningData: mockSetWorkflowRunningData,
    })

    mockUseStore.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
      return selector({ pipelineId: 'test-pipeline-id' })
    })

    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
  })

  afterEach(() => {
    const container = document.getElementById('workflow-container')
    if (container) {
      document.body.removeChild(container)
    }
  })

  describe('handleBackupDraft', () => {
    it('should backup draft when no backup exists', () => {
      const { result } = renderHook(() => usePipelineRunByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      act(() => {
        result.current.handleBackupDraft()
      })

      expect(mockSetBackupDraft).toHaveBeenCalledExactlyOnceWith({
        nodes: mockGetNodes(),
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        environmentVariables: [],
      })
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    })

    it('should not backup draft when backup already exists', () => {
      mockWorkflowStoreGetState.mockReturnValue({
        pipelineId: 'test-pipeline-id',
        backupDraft: { nodes: [], edges: [], viewport: {}, environmentVariables: [] },
        environmentVariables: [],
        setBackupDraft: mockSetBackupDraft,
        setEnvironmentVariables: mockSetEnvironmentVariables,
        setRagPipelineVariables: mockSetRagPipelineVariables,
        setWorkflowRunningData: mockSetWorkflowRunningData,
      })

      const { result } = renderHook(() => usePipelineRunByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      act(() => {
        result.current.handleBackupDraft()
      })

      expect(mockSetBackupDraft).not.toHaveBeenCalled()
    })
  })

  describe('handleLoadBackupDraft', () => {
    it('should load backup draft when exists', () => {
      const backupDraft = {
        nodes: [{ id: 'backup-node' }],
        edges: [{ id: 'backup-edge' }],
        viewport: { x: 100, y: 100, zoom: 1.5 },
        environmentVariables: [{ key: 'ENV', value: 'test' }],
      }

      mockWorkflowStoreGetState.mockReturnValue({
        pipelineId: 'test-pipeline-id',
        backupDraft,
        environmentVariables: [],
        setBackupDraft: mockSetBackupDraft,
        setEnvironmentVariables: mockSetEnvironmentVariables,
        setRagPipelineVariables: mockSetRagPipelineVariables,
        setWorkflowRunningData: mockSetWorkflowRunningData,
      })

      const { result } = renderHook(() => usePipelineRunByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      act(() => {
        result.current.handleLoadBackupDraft()
      })

      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
        nodes: backupDraft.nodes,
        edges: backupDraft.edges,
        viewport: backupDraft.viewport,
      })
      expect(mockSetEnvironmentVariables).toHaveBeenCalledWith(backupDraft.environmentVariables)
      expect(mockSetBackupDraft).toHaveBeenCalledWith(undefined)
    })

    it('should not load when no backup exists', () => {
      mockWorkflowStoreGetState.mockReturnValue({
        pipelineId: 'test-pipeline-id',
        backupDraft: undefined,
        environmentVariables: [],
        setBackupDraft: mockSetBackupDraft,
        setEnvironmentVariables: mockSetEnvironmentVariables,
        setRagPipelineVariables: mockSetRagPipelineVariables,
        setWorkflowRunningData: mockSetWorkflowRunningData,
      })

      const { result } = renderHook(() => usePipelineRunByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      act(() => {
        result.current.handleLoadBackupDraft()
      })

      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    })
  })

  describe('handleStopRun', () => {
    it('should call stop workflow run service', () => {
      const { result } = renderHook(() => usePipelineRunByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      act(() => {
        result.current.handleStopRun('task-123')
      })

      expect(mockStopWorkflowRun).toHaveBeenCalledWith(
        '/rag/pipelines/test-pipeline-id/workflow-runs/tasks/task-123/stop',
      )
    })
  })

  describe('handleRestoreFromPublishedWorkflow', () => {
    it('should restore workflow from published version', () => {
      const publishedWorkflow = createPublishedWorkflow({
        graph: {
          nodes: [createNode({ id: 'pub-node' })],
          edges: [createEdge({ id: 'pub-edge', source: 'pub-node', target: 'target' })],
          viewport: { x: 50, y: 50, zoom: 1 },
        },
        environment_variables: [
          { id: 'env', name: 'PUB_ENV', value: 'pub', value_type: 'string', description: '' },
        ],
        rag_pipeline_variables: [
          {
            variable: 'input',
            type: PipelineInputVarType.textInput,
            label: 'Input',
            belong_to_node_id: 'pub-node',
            required: true,
          },
        ],
      })

      const { result } = renderHook(() => usePipelineRunByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      act(() => {
        result.current.handleRestoreFromPublishedWorkflow(publishedWorkflow)
      })

      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
        nodes: [
          expect.objectContaining({
            id: 'pub-node',
            data: expect.objectContaining({ selected: false }),
            selected: false,
          }),
        ],
        edges: publishedWorkflow.graph.edges,
        viewport: publishedWorkflow.graph.viewport,
      })
      expect(mockSetEnvironmentVariables).toHaveBeenCalledWith(
        publishedWorkflow.environment_variables,
      )
      expect(mockSetRagPipelineVariables).toHaveBeenCalledWith(
        publishedWorkflow.rag_pipeline_variables,
      )
    })

    it('should handle empty environment and rag pipeline variables', () => {
      const publishedWorkflow = createPublishedWorkflow({
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        environment_variables: undefined,
        rag_pipeline_variables: undefined,
      })

      const { result } = renderHook(() => usePipelineRunByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      act(() => {
        result.current.handleRestoreFromPublishedWorkflow(publishedWorkflow)
      })

      expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([])
      expect(mockSetRagPipelineVariables).toHaveBeenCalledWith([])
    })
  })

  describe('handleRun', () => {
    it('waits for draft sync, clears stale selection and starts the requested run', async () => {
      const pending = createDeferred<void>()
      mockDoSyncWorkflowDraft.mockReturnValue(pending.promise)
      const { result } = renderHook(() => usePipelineRunByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      let running: Promise<void>
      act(() => {
        running = result.current.handleRun({ inputs: { query: 'test' } })
      })
      expect(mockSetNodes).toHaveBeenCalledExactlyOnceWith([
        { id: 'node-1', data: { type: 'start', selected: false, _runningStatus: undefined } },
      ])
      expect(mockSsePost).not.toHaveBeenCalled()
      await act(async () => {
        pending.resolve()
        await running
      })
      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ historyWorkflowData: undefined })
      expect(mockSsePost).toHaveBeenCalledExactlyOnceWith(
        '/rag/pipelines/test-pipeline-id/workflows/draft/run',
        { body: { inputs: { query: 'test' } } },
        expect.any(Object),
      )

      expect(mockSetWorkflowRunningData).toHaveBeenCalledWith({
        result: {
          inputs_truncated: false,
          process_data_truncated: false,
          outputs_truncated: false,
          status: WorkflowRunningStatus.Running,
        },
        tracing: [],
        resultText: '',
      })
    })

    it.each([
      { name: 'onWorkflowStarted', payload: { task_id: 'task-1' }, invalidatesHistory: true },
      { name: 'onWorkflowFinished', payload: { status: 'succeeded' }, invalidatesHistory: true },
      { name: 'onError', payload: { message: 'error' }, invalidatesHistory: true },
      { name: 'onNodeStarted', payload: { node_id: 'node-1' }, invalidatesHistory: false },
      { name: 'onNodeFinished', payload: { node_id: 'node-1' }, invalidatesHistory: false },
      { name: 'onIterationStart', payload: { iteration_id: 'iter-1' }, invalidatesHistory: false },
      { name: 'onIterationNext', payload: { index: 1 }, invalidatesHistory: false },
      { name: 'onIterationFinish', payload: { iteration_id: 'iter-1' }, invalidatesHistory: false },
      { name: 'onLoopStart', payload: { loop_id: 'loop-1' }, invalidatesHistory: false },
      { name: 'onLoopNext', payload: { index: 2 }, invalidatesHistory: false },
      { name: 'onLoopFinish', payload: { loop_id: 'loop-1' }, invalidatesHistory: false },
      { name: 'onNodeRetry', payload: { node_id: 'node-1', retry: 1 }, invalidatesHistory: false },
      { name: 'onAgentLog', payload: { message: 'agent log' }, invalidatesHistory: false },
    ] as const)(
      'forwards $name to the run owner',
      async ({ name, payload, invalidatesHistory }) => {
        const callback = vi.fn()
        let capturedCallbacks: Record<string, (params: unknown) => void> = {}
        mockSsePost.mockImplementation((_url, _body, callbacks) => {
          capturedCallbacks = callbacks
        })
        const { result } = renderHook(() => usePipelineRunByCanEdit(true), {
          resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
        })
        await act(async () => {
          await result.current.handleRun({ inputs: {} }, { [name]: callback })
        })
        act(() => {
          capturedCallbacks[name]?.(payload)
        })
        expect(callback).toHaveBeenCalledExactlyOnceWith(payload)
        if (invalidatesHistory) expect(mockInvalidateRunHistory).toHaveBeenCalled()
      },
    )

    it('should handle onTextChunk callback', async () => {
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRunByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await act(async () => {
        await result.current.handleRun({ inputs: {} })
      })

      await act(async () => {
        capturedCallbacks.onTextChunk?.({ text: 'chunk' })
      })

      expect(mockTextChunk).toHaveBeenCalledExactlyOnceWith({ text: 'chunk' })
    })

    it('should handle onTextReplace callback', async () => {
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRunByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await act(async () => {
        await result.current.handleRun({ inputs: {} })
      })

      await act(async () => {
        capturedCallbacks.onTextReplace?.({ text: 'replaced' })
      })

      expect(mockTextReplace).toHaveBeenCalledExactlyOnceWith({ text: 'replaced' })
    })

    it('should pass rest callback to ssePost', async () => {
      const customCallback = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRunByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await act(async () => {
        await result.current.handleRun(
          { inputs: {} },
          {
            onData: customCallback,
          },
        )
      })

      expect(capturedCallbacks.onData).toBe(customCallback)
    })
  })
})
