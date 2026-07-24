import type { VersionHistory } from '@/types/workflow'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'

import { usePipelineRun } from '../use-pipeline-run'

const mockStoreGetState = vi.fn()
const mockGetViewport = vi.fn()
vi.mock('reactflow', () => ({
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
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({
    fetchInspectVars: vi.fn(),
  }),
}))

const mockHandleUpdateWorkflowCanvas = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-workflow-interactions', () => ({
  useWorkflowUpdate: () => ({
    handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas,
  }),
}))

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
    handleWorkflowTextChunk: vi.fn(),
    handleWorkflowTextReplace: vi.fn(),
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
  useInvalidAllLastRun: () => mockInvalidAllLastRun,
  useInvalidateWorkflowRunHistory: () => mockInvalidateRunHistory,
}))

vi.mock('@/types/common', () => ({
  FlowType: {
    ragPipeline: 'rag-pipeline',
  },
}))

describe('usePipelineRun', () => {
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
      { id: 'node-1', data: { type: 'start', selected: true, _runningStatus: WorkflowRunningStatus.Running } },
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
    vi.clearAllMocks()
  })

  describe('hook initialization', () => {
    it('should return handleBackupDraft function', () => {
      const { result } = renderHook(() => usePipelineRun())

      expect(result.current.handleBackupDraft).toBeDefined()
      expect(typeof result.current.handleBackupDraft).toBe('function')
    })

    it('should return handleLoadBackupDraft function', () => {
      const { result } = renderHook(() => usePipelineRun())

      expect(result.current.handleLoadBackupDraft).toBeDefined()
      expect(typeof result.current.handleLoadBackupDraft).toBe('function')
    })

    it('should return handleRun function', () => {
      const { result } = renderHook(() => usePipelineRun())

      expect(result.current.handleRun).toBeDefined()
      expect(typeof result.current.handleRun).toBe('function')
    })

    it('should return handleStopRun function', () => {
      const { result } = renderHook(() => usePipelineRun())

      expect(result.current.handleStopRun).toBeDefined()
      expect(typeof result.current.handleStopRun).toBe('function')
    })

    it('should return handleRestoreFromPublishedWorkflow function', () => {
      const { result } = renderHook(() => usePipelineRun())

      expect(result.current.handleRestoreFromPublishedWorkflow).toBeDefined()
      expect(typeof result.current.handleRestoreFromPublishedWorkflow).toBe('function')
    })
  })

  describe('handleBackupDraft', () => {
    it('should backup draft when no backup exists', () => {
      const { result } = renderHook(() => usePipelineRun())

      act(() => {
        result.current.handleBackupDraft()
      })

      expect(mockSetBackupDraft).toHaveBeenCalled()
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

      const { result } = renderHook(() => usePipelineRun())

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

      const { result } = renderHook(() => usePipelineRun())

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

      const { result } = renderHook(() => usePipelineRun())

      act(() => {
        result.current.handleLoadBackupDraft()
      })

      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    })
  })

  describe('handleStopRun', () => {
    it('should call stop workflow run service', () => {
      const { result } = renderHook(() => usePipelineRun())

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
      const publishedWorkflow = {
        graph: {
          nodes: [{ id: 'pub-node', data: { type: 'start' } }],
          edges: [{ id: 'pub-edge' }],
          viewport: { x: 50, y: 50, zoom: 1 },
        },
        environment_variables: [{ key: 'PUB_ENV', value: 'pub' }],
        rag_pipeline_variables: [{ variable: 'input', type: 'text-input' }],
      }

      const { result } = renderHook(() => usePipelineRun())

      act(() => {
        result.current.handleRestoreFromPublishedWorkflow(publishedWorkflow as unknown as VersionHistory)
      })

      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
        nodes: [{ id: 'pub-node', data: { type: 'start', selected: false }, selected: false }],
        edges: publishedWorkflow.graph.edges,
        viewport: publishedWorkflow.graph.viewport,
      })
    })

    it('should set environment variables from published workflow', () => {
      const publishedWorkflow = {
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        environment_variables: [{ key: 'ENV', value: 'value' }],
        rag_pipeline_variables: [],
      }

      const { result } = renderHook(() => usePipelineRun())

      act(() => {
        result.current.handleRestoreFromPublishedWorkflow(publishedWorkflow as unknown as VersionHistory)
      })

      expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([{ key: 'ENV', value: 'value' }])
    })

    it('should set rag pipeline variables from published workflow', () => {
      const publishedWorkflow = {
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        environment_variables: [],
        rag_pipeline_variables: [{ variable: 'query', type: 'text-input' }],
      }

      const { result } = renderHook(() => usePipelineRun())

      act(() => {
        result.current.handleRestoreFromPublishedWorkflow(publishedWorkflow as unknown as VersionHistory)
      })

      expect(mockSetRagPipelineVariables).toHaveBeenCalledWith([{ variable: 'query', type: 'text-input' }])
    })

    it('should handle empty environment and rag pipeline variables', () => {
      const publishedWorkflow = {
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        environment_variables: undefined,
        rag_pipeline_variables: undefined,
      }

      const { result } = renderHook(() => usePipelineRun())

      act(() => {
        result.current.handleRestoreFromPublishedWorkflow(publishedWorkflow as unknown as VersionHistory)
      })

      expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([])
      expect(mockSetRagPipelineVariables).toHaveBeenCalledWith([])
    })
  })

  describe('handleRun', () => {
    it('should sync workflow draft before running', async () => {
      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} })
      })

      expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    })

    it('should reset node selection and running status', async () => {
      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} })
      })

      expect(mockSetNodes).toHaveBeenCalled()
    })

    it('should clear history workflow data', async () => {
      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} })
      })

      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ historyWorkflowData: undefined })
    })

    it('should set initial running data', async () => {
      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} })
      })

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

    it('should call ssePost with correct URL', async () => {
      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: { query: 'test' } })
      })

      expect(mockSsePost).toHaveBeenCalledWith(
        '/rag/pipelines/test-pipeline-id/workflows/draft/run',
        expect.any(Object),
        expect.any(Object),
      )
    })

    it('should call onWorkflowStarted callback when provided', async () => {
      const onWorkflowStarted = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onWorkflowStarted })
      })

      await act(async () => {
        capturedCallbacks.onWorkflowStarted?.({ task_id: 'task-1' })
      })

      expect(onWorkflowStarted).toHaveBeenCalledWith({ task_id: 'task-1' })
      expect(mockInvalidateRunHistory).toHaveBeenCalled()
    })

    it('should call onWorkflowFinished callback when provided', async () => {
      const onWorkflowFinished = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onWorkflowFinished })
      })

      await act(async () => {
        capturedCallbacks.onWorkflowFinished?.({ status: 'succeeded' })
      })

      expect(onWorkflowFinished).toHaveBeenCalledWith({ status: 'succeeded' })
      expect(mockInvalidateRunHistory).toHaveBeenCalled()
    })

    it('should call onError callback when provided', async () => {
      const onError = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onError })
      })

      await act(async () => {
        capturedCallbacks.onError?.({ message: 'error' })
      })

      expect(onError).toHaveBeenCalledWith({ message: 'error' })
      expect(mockInvalidateRunHistory).toHaveBeenCalled()
    })

    it('should call onNodeStarted callback when provided', async () => {
      const onNodeStarted = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onNodeStarted })
      })

      await act(async () => {
        capturedCallbacks.onNodeStarted?.({ node_id: 'node-1' })
      })

      expect(onNodeStarted).toHaveBeenCalledWith({ node_id: 'node-1' })
    })

    it('should call onNodeFinished callback when provided', async () => {
      const onNodeFinished = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onNodeFinished })
      })

      await act(async () => {
        capturedCallbacks.onNodeFinished?.({ node_id: 'node-1' })
      })

      expect(onNodeFinished).toHaveBeenCalledWith({ node_id: 'node-1' })
    })

    it('should call onIterationStart callback when provided', async () => {
      const onIterationStart = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onIterationStart })
      })

      await act(async () => {
        capturedCallbacks.onIterationStart?.({ iteration_id: 'iter-1' })
      })

      expect(onIterationStart).toHaveBeenCalledWith({ iteration_id: 'iter-1' })
    })

    it('should call onIterationNext callback when provided', async () => {
      const onIterationNext = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onIterationNext })
      })

      await act(async () => {
        capturedCallbacks.onIterationNext?.({ index: 1 })
      })

      expect(onIterationNext).toHaveBeenCalledWith({ index: 1 })
    })

    it('should call onIterationFinish callback when provided', async () => {
      const onIterationFinish = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onIterationFinish })
      })

      await act(async () => {
        capturedCallbacks.onIterationFinish?.({ iteration_id: 'iter-1' })
      })

      expect(onIterationFinish).toHaveBeenCalledWith({ iteration_id: 'iter-1' })
    })

    it('should call onLoopStart callback when provided', async () => {
      const onLoopStart = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onLoopStart })
      })

      await act(async () => {
        capturedCallbacks.onLoopStart?.({ loop_id: 'loop-1' })
      })

      expect(onLoopStart).toHaveBeenCalledWith({ loop_id: 'loop-1' })
    })

    it('should call onLoopNext callback when provided', async () => {
      const onLoopNext = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onLoopNext })
      })

      await act(async () => {
        capturedCallbacks.onLoopNext?.({ index: 2 })
      })

      expect(onLoopNext).toHaveBeenCalledWith({ index: 2 })
    })

    it('should call onLoopFinish callback when provided', async () => {
      const onLoopFinish = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onLoopFinish })
      })

      await act(async () => {
        capturedCallbacks.onLoopFinish?.({ loop_id: 'loop-1' })
      })

      expect(onLoopFinish).toHaveBeenCalledWith({ loop_id: 'loop-1' })
    })

    it('should call onNodeRetry callback when provided', async () => {
      const onNodeRetry = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onNodeRetry })
      })

      await act(async () => {
        capturedCallbacks.onNodeRetry?.({ node_id: 'node-1', retry: 1 })
      })

      expect(onNodeRetry).toHaveBeenCalledWith({ node_id: 'node-1', retry: 1 })
    })

    it('should call onAgentLog callback when provided', async () => {
      const onAgentLog = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onAgentLog })
      })

      await act(async () => {
        capturedCallbacks.onAgentLog?.({ message: 'agent log' })
      })

      expect(onAgentLog).toHaveBeenCalledWith({ message: 'agent log' })
    })

    it('should handle onTextChunk callback', async () => {
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} })
      })

      await act(async () => {
        capturedCallbacks.onTextChunk?.({ text: 'chunk' })
      })

      expect(capturedCallbacks.onTextChunk).toBeDefined()
    })

    it('should handle onTextReplace callback', async () => {
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} })
      })

      await act(async () => {
        capturedCallbacks.onTextReplace?.({ text: 'replaced' })
      })

      expect(capturedCallbacks.onTextReplace).toBeDefined()
    })

    it('should pass rest callback to ssePost', async () => {
      const customCallback = vi.fn()
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} }, { onData: customCallback } as unknown as Parameters<typeof result.current.handleRun>[1])
      })

      expect(capturedCallbacks.onData).toBeDefined()
    })

    it('should handle callbacks without optional handlers', async () => {
      let capturedCallbacks: Record<string, (params: unknown) => void> = {}

      mockSsePost.mockImplementation((_url, _body, callbacks) => {
        capturedCallbacks = callbacks
      })

      const { result } = renderHook(() => usePipelineRun())

      await act(async () => {
        await result.current.handleRun({ inputs: {} })
      })

      await act(async () => {
        capturedCallbacks.onWorkflowStarted?.({ task_id: 'task-1' })
        capturedCallbacks.onWorkflowFinished?.({ status: 'succeeded' })
        capturedCallbacks.onError?.({ message: 'error' })
        capturedCallbacks.onNodeStarted?.({ node_id: 'node-1' })
        capturedCallbacks.onNodeFinished?.({ node_id: 'node-1' })
        capturedCallbacks.onIterationStart?.({ iteration_id: 'iter-1' })
        capturedCallbacks.onIterationNext?.({ index: 1 })
        capturedCallbacks.onIterationFinish?.({ iteration_id: 'iter-1' })
        capturedCallbacks.onLoopStart?.({ loop_id: 'loop-1' })
        capturedCallbacks.onLoopNext?.({ index: 2 })
        capturedCallbacks.onLoopFinish?.({ loop_id: 'loop-1' })
        capturedCallbacks.onNodeRetry?.({ node_id: 'node-1', retry: 1 })
        capturedCallbacks.onAgentLog?.({ message: 'agent log' })
        capturedCallbacks.onTextChunk?.({ text: 'chunk' })
        capturedCallbacks.onTextReplace?.({ text: 'replaced' })
      })

      expect(mockSsePost).toHaveBeenCalled()
    })
  })
})
