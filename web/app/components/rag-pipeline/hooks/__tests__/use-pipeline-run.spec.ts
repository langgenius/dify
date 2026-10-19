import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { act } from '@testing-library/react'
import { useNodes } from 'reactflow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { createDeferred } from '@/test/deferred'
import { createRagPipelineSliceSlice } from '../../store'
import { usePipelineRunByCanEdit } from '../use-pipeline-run'

// Draft persistence, canvas replacement and run-event reducers all have their own suites.
const mockDoSyncWorkflowDraft = vi.fn()
vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraftByCanEdit: () => ({ doSyncWorkflowDraft: mockDoSyncWorkflowDraft }),
}))

const mockHandleUpdateWorkflowCanvas = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({ handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas }),
}))

const runEvents = vi.hoisted(() => ({
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
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-run-event/use-workflow-run-event', () => ({
  useWorkflowRunEvent: () => runEvents,
}))

const mockFetchInspectVars = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: mockFetchInspectVars }),
}))

const mockSsePost = vi.fn()
vi.mock('@/service/base', () => ({
  ssePost: (...args: unknown[]) => mockSsePost(...args),
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

type PipelineRun = ReturnType<typeof usePipelineRunByCanEdit>
type IOtherOptions = NonNullable<Parameters<PipelineRun['handleRun']>[1]>

const RUN_HISTORY_URL = '/rag/pipelines/test-pipeline-id/workflow-runs'

const envVar = (id: string, value: string): EnvironmentVariable => ({
  id,
  name: id.toUpperCase(),
  value,
  value_type: 'string',
  description: '',
})

const renderPipelineRun = (initialStoreState: Record<string, unknown> = {}) =>
  renderWorkflowCanvasHook(() => ({ run: usePipelineRunByCanEdit(true), nodes: useNodes() }), {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
    injectWorkflowStoreSliceFn: createRagPipelineSliceSlice as InjectWorkflowStoreSliceFn,
    nodes: [
      createNode({
        id: 'source',
        selected: true,
        data: {
          type: BlockEnum.DataSource,
          selected: true,
          _runningStatus: WorkflowRunningStatus.Succeeded,
        },
      }),
      createNode({ id: 'kb', data: { type: BlockEnum.KnowledgeBase } }),
    ],
    edges: [createEdge({ id: 'source-kb', source: 'source', target: 'kb' })],
    initialStoreState,
  })

const startRun = async (run: PipelineRun, callback?: IOtherOptions) => {
  await act(async () => {
    await run.handleRun({ inputs: { query: 'test' } }, callback)
  })
  return mockSsePost.mock.calls.at(-1)![2] as Required<IOtherOptions>
}

describe('usePipelineRunByCanEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    const container = document.createElement('div')
    container.id = 'workflow-container'
    Object.defineProperty(container, 'clientWidth', { value: 1000 })
    Object.defineProperty(container, 'clientHeight', { value: 800 })
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.getElementById('workflow-container')?.remove()
  })

  describe('draft backup', () => {
    it('snapshots the current canvas once and persists the draft', () => {
      const env = [envVar('env-1', 'value')]
      const { result, store } = renderPipelineRun({ environmentVariables: env })

      act(() => result.current.run.handleBackupDraft())
      const firstBackup = store.getState().backupDraft
      act(() => result.current.run.handleBackupDraft())

      expect(firstBackup).toMatchObject({
        nodes: [expect.objectContaining({ id: 'source' }), expect.objectContaining({ id: 'kb' })],
        edges: [expect.objectContaining({ id: 'source-kb' })],
        // useReactFlow().getViewport needs a mounted d3 zoom; the hook-only canvas reports the default.
        viewport: { x: 0, y: 0, zoom: 1 },
        environmentVariables: env,
      })
      expect(store.getState().backupDraft).toBe(firstBackup)
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledOnce()
    })

    it('restores the backup canvas and environment, then discards the backup', () => {
      const backupDraft = {
        nodes: [createNode({ id: 'backup-node' })],
        edges: [],
        viewport: { x: 100, y: 100, zoom: 1.5 },
        environmentVariables: [envVar('env-1', 'from-backup')],
      }
      const { result, store } = renderPipelineRun({ backupDraft })

      act(() => result.current.run.handleLoadBackupDraft())

      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledExactlyOnceWith({
        nodes: backupDraft.nodes,
        edges: backupDraft.edges,
        viewport: backupDraft.viewport,
      })
      expect(store.getState()).toMatchObject({
        environmentVariables: backupDraft.environmentVariables,
        backupDraft: undefined,
      })
    })

    it('leaves the canvas alone when there is no backup to restore', () => {
      const { result } = renderPipelineRun()

      act(() => result.current.run.handleLoadBackupDraft())

      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    })
  })

  describe('restore from published workflow', () => {
    it('loads the published graph unselected along with its variables', () => {
      const publishedWorkflow = {
        graph: {
          nodes: [createNode({ id: 'pub-node', selected: true, data: { selected: true } })],
          edges: [],
          viewport: { x: 50, y: 50, zoom: 1 },
        },
        environment_variables: [envVar('pub', 'published')],
        rag_pipeline_variables: [{ variable: 'input', type: 'text-input' }],
      } as unknown as FetchWorkflowDraftResponse
      const { result, store } = renderPipelineRun()

      act(() => result.current.run.handleRestoreFromPublishedWorkflow(publishedWorkflow))

      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledExactlyOnceWith({
        nodes: [
          expect.objectContaining({
            id: 'pub-node',
            selected: false,
            data: expect.objectContaining({ selected: false }),
          }),
        ],
        edges: [],
        viewport: publishedWorkflow.graph.viewport,
      })
      expect(store.getState()).toMatchObject({
        environmentVariables: publishedWorkflow.environment_variables,
        ragPipelineVariables: publishedWorkflow.rag_pipeline_variables,
      })
    })

    it('clears variables the published version does not define', () => {
      const { result, store } = renderPipelineRun({
        environmentVariables: [envVar('stale', 'x')],
        ragPipelineVariables: [{ variable: 'stale' }],
      })

      act(() =>
        result.current.run.handleRestoreFromPublishedWorkflow({
          graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        } as unknown as FetchWorkflowDraftResponse),
      )

      expect(store.getState()).toMatchObject({ environmentVariables: [], ragPipelineVariables: [] })
    })
  })

  describe('running', () => {
    it('resets canvas run state, saves the draft, then streams the run', async () => {
      const pending = createDeferred<void>()
      mockDoSyncWorkflowDraft.mockReturnValue(pending.promise)
      const { result, store } = renderPipelineRun({
        historyWorkflowData: { id: 'old-run' },
      })

      let running!: Promise<void>
      act(() => {
        running = result.current.run.handleRun({ inputs: { query: 'test' } })
      })

      expect(result.current.nodes.find((node) => node.id === 'source')?.data).toMatchObject({
        selected: false,
        _runningStatus: undefined,
      })
      expect(mockSsePost).not.toHaveBeenCalled()

      await act(async () => {
        pending.resolve()
        await running
      })

      expect(store.getState()).toMatchObject({
        historyWorkflowData: undefined,
        workflowRunningData: {
          result: { status: WorkflowRunningStatus.Running },
          tracing: [],
          resultText: '',
        },
      })
      expect(mockSsePost).toHaveBeenCalledExactlyOnceWith(
        '/rag/pipelines/test-pipeline-id/workflows/draft/run',
        { body: { inputs: { query: 'test' } } },
        expect.any(Object),
      )
    })

    it.each([
      ['onWorkflowStarted', 'handleWorkflowStarted'],
      ['onWorkflowFinished', 'handleWorkflowFinished'],
      ['onError', 'handleWorkflowFailed'],
      ['onNodeStarted', 'handleWorkflowNodeStarted'],
      ['onNodeFinished', 'handleWorkflowNodeFinished'],
      ['onIterationStart', 'handleWorkflowNodeIterationStarted'],
      ['onIterationNext', 'handleWorkflowNodeIterationNext'],
      ['onIterationFinish', 'handleWorkflowNodeIterationFinished'],
      ['onLoopStart', 'handleWorkflowNodeLoopStarted'],
      ['onLoopNext', 'handleWorkflowNodeLoopNext'],
      ['onLoopFinish', 'handleWorkflowNodeLoopFinished'],
      ['onNodeRetry', 'handleWorkflowNodeRetry'],
      ['onAgentLog', 'handleWorkflowAgentLog'],
    ] as const)(
      'applies %s to the canvas and forwards it to the caller',
      async (event, handler) => {
        const callerCallback = vi.fn()
        const { result } = renderPipelineRun()
        const stream = await startRun(result.current.run, { [event]: callerCallback })
        const payload = { event }

        act(() => (stream[event] as (params: unknown) => void)(payload))

        expect(runEvents[handler]).toHaveBeenCalledOnce()
        expect(runEvents[handler].mock.calls[0]![0]).toBe(event === 'onError' ? undefined : payload)
        expect(callerCallback).toHaveBeenCalledExactlyOnceWith(payload)
      },
    )

    it('positions started nodes against the workflow container size', async () => {
      const { result } = renderPipelineRun()
      const stream = await startRun(result.current.run)

      act(() => stream.onNodeStarted({ node_id: 'kb' } as never))

      expect(runEvents.handleWorkflowNodeStarted).toHaveBeenCalledWith(
        { node_id: 'kb' },
        { clientWidth: 1000, clientHeight: 800 },
      )
    })

    it.each([
      ['onTextChunk', 'handleWorkflowTextChunk'],
      ['onTextReplace', 'handleWorkflowTextReplace'],
    ] as const)('applies %s to the run output', async (event, handler) => {
      const { result } = renderPipelineRun()
      const stream = await startRun(result.current.run)

      act(() => (stream[event] as (params: unknown) => void)({ text: 'chunk' }))

      expect(runEvents[handler]).toHaveBeenCalledExactlyOnceWith({ text: 'chunk' })
    })

    it('refreshes run history on lifecycle events and inspect data when the run finishes', async () => {
      const { result } = renderPipelineRun()
      const stream = await startRun(result.current.run)

      act(() => stream.onWorkflowStarted({} as never))
      expect(mockInvalidateRunHistory).toHaveBeenLastCalledWith(RUN_HISTORY_URL)
      expect(mockFetchInspectVars).not.toHaveBeenCalled()

      act(() => stream.onWorkflowFinished({} as never))
      expect(mockFetchInspectVars).toHaveBeenCalledExactlyOnceWith({})
      expect(mockInvalidAllLastRun).toHaveBeenCalledOnce()

      act(() => stream.onError({} as never))
      expect(mockInvalidateRunHistory).toHaveBeenCalledTimes(3)
    })

    it('passes other stream callbacks through untouched', async () => {
      const onData = vi.fn()
      const { result } = renderPipelineRun()

      const stream = await startRun(result.current.run, { onData } as IOtherOptions)

      expect(stream.onData).toBe(onData)
    })
  })

  describe('stopping', () => {
    it('stops the server task and aborts the open stream', async () => {
      const { result } = renderPipelineRun()
      const stream = await startRun(result.current.run)
      const controller = new AbortController()
      stream.getAbortController(controller)

      act(() => result.current.run.handleStopRun('task-123'))

      expect(mockStopWorkflowRun).toHaveBeenCalledExactlyOnceWith(
        '/rag/pipelines/test-pipeline-id/workflow-runs/tasks/task-123/stop',
      )
      expect(controller.signal.aborted).toBe(true)
    })

    it('aborts the previous stream when a new run starts', async () => {
      const { result } = renderPipelineRun()
      const firstStream = await startRun(result.current.run)
      const firstController = new AbortController()
      firstStream.getAbortController(firstController)

      await startRun(result.current.run)

      expect(firstController.signal.aborted).toBe(true)
    })
  })
})
