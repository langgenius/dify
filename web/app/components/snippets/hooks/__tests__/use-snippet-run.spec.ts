import type { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { useNodes } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  baseRunningData,
  renderWorkflowCanvasHook,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { lastRunQueryOptions, workflowRunHistoryQueryOptions } from '@/service/workflow-queries'
import { createDeferred } from '@/test/deferred'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { createTestQueryClient } from '@/test/query-client'
import { useSnippetRun } from '../use-snippet-run'

// Draft persistence, canvas replacement and run-event reducers all have their own suites.
const mockDoSyncWorkflowDraft = vi.fn()
vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ doSyncWorkflowDraft: mockDoSyncWorkflowDraft }),
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

const mockStopWorkflowRun = vi
  .fn()
  .mockImplementation(async () => Response.json({ result: 'success' }))

vi.mock('@/service/base', () => ({
  request: (...args: unknown[]) => mockStopWorkflowRun(...args),
}))

const mockStreamEvents = vi.hoisted(() =>
  vi.fn<typeof import('@/service/event-stream').streamEvents>(),
)
vi.mock('@/service/event-stream', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/event-stream')>()),
  streamEvents: mockStreamEvents,
}))

const mockRunSnippetDraft = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'snippets.bySnippetId.workflows.draft.run.post': mockRunSnippetDraft,
    }),
  }
})

const streamRequestOptions = {
  signal: new AbortController().signal,
  context: { stream: true },
} as const

type SnippetRun = ReturnType<typeof useSnippetRun>
type RunOptions = NonNullable<Parameters<SnippetRun['handleRun']>[1]>
type RunPayload = Parameters<SnippetRun['handleRun']>[0]

const RUN_PAYLOAD = { inputs: { query: 'test' } } as RunPayload

const resource = { kind: 'snippet', snippetId: 'snippet-1' } as const
const runHistoryKey = workflowRunHistoryQueryOptions(resource).queryKey
const lastRunKey = lastRunQueryOptions(resource, 'llm').queryKey
const otherSnippetLastRunKey = lastRunQueryOptions(
  { kind: 'snippet', snippetId: 'snippet-2' },
  'llm',
).queryKey

let queryClient: QueryClient

const seedRunQueries = () => {
  queryClient.setQueryData(runHistoryKey, { data: [], has_more: false, limit: 20 })
  queryClient.setQueryData(lastRunKey, { id: 'execution-1', node_id: 'llm' })
  queryClient.setQueryData(otherSnippetLastRunKey, { id: 'execution-2', node_id: 'llm' })
}

const isInvalidated = (queryKey: readonly unknown[]) =>
  queryClient.getQueryState(queryKey)?.isInvalidated

const renderSnippetRun = (initialStoreState: Record<string, unknown> = {}) =>
  renderWorkflowCanvasHook(() => ({ run: useSnippetRun(), nodes: useNodes() }), {
    resource,
    queryClient,
    nodes: [
      createNode({
        id: 'start',
        selected: true,
        data: {
          type: BlockEnum.Start,
          selected: true,
          _runningStatus: WorkflowRunningStatus.Succeeded,
        },
      }),
      createNode({ id: 'llm', data: { type: BlockEnum.LLM } }),
    ],
    edges: [createEdge({ id: 'start-llm', source: 'start', target: 'llm' })],
    initialStoreState,
  })

const startRun = async (run: SnippetRun, callback?: RunOptions) => {
  await act(async () => {
    await run.handleRun(RUN_PAYLOAD, callback)
  })
  return mockStreamEvents.mock.calls.at(-1)![1] as Required<RunOptions>
}

describe('useSnippetRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = createTestQueryClient()
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
    it('snapshots the current canvas once without environment variables', () => {
      const { result, store } = renderSnippetRun()

      act(() => result.current.run.handleBackupDraft())
      const firstBackup = store.getState().backupDraft
      act(() => result.current.run.handleBackupDraft())

      expect(firstBackup).toMatchObject({
        nodes: [expect.objectContaining({ id: 'start' }), expect.objectContaining({ id: 'llm' })],
        edges: [expect.objectContaining({ id: 'start-llm' })],
        environmentVariables: [],
      })
      expect(store.getState().backupDraft).toBe(firstBackup)
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledOnce()
    })

    it('restores the backup canvas and discards the backup', () => {
      const backupDraft = {
        nodes: [createNode({ id: 'backup-node' })],
        edges: [],
        viewport: { x: 100, y: 100, zoom: 1.5 },
        environmentVariables: [],
      }
      const { result, store } = renderSnippetRun({ backupDraft })

      act(() => result.current.run.handleLoadBackupDraft())

      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledExactlyOnceWith({
        nodes: backupDraft.nodes,
        edges: [],
        viewport: backupDraft.viewport,
      })
      expect(store.getState().backupDraft).toBeUndefined()
    })

    it('leaves the canvas alone when there is no backup to restore', () => {
      const { result } = renderSnippetRun()

      act(() => result.current.run.handleLoadBackupDraft())

      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    })
  })

  it('loads a published snippet graph unselected', () => {
    const { result } = renderSnippetRun()

    act(() =>
      result.current.run.handleRestoreFromPublishedWorkflow(
        createWorkflowResponseFixture({
          graph: {
            nodes: [createNode({ id: 'pub-node', selected: true, data: { selected: true } })],
            edges: [],
            viewport: { x: 50, y: 50, zoom: 1 },
          },
        }),
      ),
    )

    expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledExactlyOnceWith({
      nodes: [
        expect.objectContaining({
          id: 'pub-node',
          selected: false,
          data: expect.objectContaining({ selected: false }),
        }),
      ],
      edges: [],
      viewport: { x: 50, y: 50, zoom: 1 },
    })
  })

  describe('running', () => {
    it('resets canvas run state, saves the draft, then streams the snippet run', async () => {
      const pending = createDeferred<void>()
      mockDoSyncWorkflowDraft.mockReturnValue(pending.promise)
      const { result, store } = renderSnippetRun({ historyWorkflowData: { id: 'old-run' } })

      let running!: Promise<void>
      act(() => {
        running = result.current.run.handleRun(RUN_PAYLOAD)
      })

      expect(result.current.nodes.find((node) => node.id === 'start')?.data).toMatchObject({
        selected: false,
        _runningStatus: undefined,
      })
      expect(mockStreamEvents).not.toHaveBeenCalled()

      await act(async () => {
        pending.resolve()
        await running
      })

      expect(store.getState()).toMatchObject({
        historyWorkflowData: undefined,
        workflowRunningData: { result: { status: WorkflowRunningStatus.Running }, tracing: [] },
      })
      expect(mockStreamEvents).toHaveBeenCalledExactlyOnceWith(
        expect.any(Function),
        expect.any(Object),
      )
      await mockStreamEvents.mock.calls[0]![0](streamRequestOptions)
      expect(mockRunSnippetDraft).toHaveBeenCalledExactlyOnceWith(
        { params: { snippet_id: 'snippet-1' }, body: RUN_PAYLOAD },
        streamRequestOptions,
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
        const { result } = renderSnippetRun()
        const stream = await startRun(result.current.run, { [event]: callerCallback })
        const payload = { event }

        act(() => (stream[event] as (params: unknown) => void)(payload))

        expect(runEvents[handler]).toHaveBeenCalledOnce()
        expect(runEvents[handler].mock.calls[0]![0]).toBe(event === 'onError' ? undefined : payload)
        expect(callerCallback).toHaveBeenCalledExactlyOnceWith(payload)
      },
    )

    it.each([
      ['onTextChunk', 'handleWorkflowTextChunk'],
      ['onTextReplace', 'handleWorkflowTextReplace'],
    ] as const)('applies %s to the run output', async (event, handler) => {
      const { result } = renderSnippetRun()
      const stream = await startRun(result.current.run)

      act(() => (stream[event] as (params: unknown) => void)({ text: 'chunk' }))

      expect(runEvents[handler]).toHaveBeenCalledExactlyOnceWith({ text: 'chunk' })
    })

    it('positions started nodes against the workflow container size', async () => {
      const { result } = renderSnippetRun()
      const stream = await startRun(result.current.run)

      act(() => stream.onNodeStarted({ node_id: 'llm' } as never))

      expect(runEvents.handleWorkflowNodeStarted).toHaveBeenCalledWith(
        { node_id: 'llm' },
        { clientWidth: 1000, clientHeight: 800 },
      )
    })

    it('refreshes run history on lifecycle events and inspect data when the run finishes', async () => {
      const { result } = renderSnippetRun()
      const stream = await startRun(result.current.run)

      seedRunQueries()
      act(() => stream.onWorkflowStarted({} as never))
      expect(isInvalidated(runHistoryKey)).toBe(true)
      expect(isInvalidated(lastRunKey)).toBe(false)
      expect(mockFetchInspectVars).not.toHaveBeenCalled()

      seedRunQueries()
      act(() => stream.onWorkflowFinished({} as never))
      expect(isInvalidated(runHistoryKey)).toBe(true)
      expect(isInvalidated(lastRunKey)).toBe(true)
      expect(isInvalidated(otherSnippetLastRunKey)).toBe(false)
      expect(mockFetchInspectVars).toHaveBeenCalledExactlyOnceWith({})

      seedRunQueries()
      act(() => stream.onError({} as never))
      expect(isInvalidated(runHistoryKey)).toBe(true)
      expect(isInvalidated(lastRunKey)).toBe(false)
    })
  })

  describe('stopping', () => {
    it('stops the server task, aborts the open stream and marks the run stopped', async () => {
      const { result, store } = renderSnippetRun()
      const stream = await startRun(result.current.run)
      const controller = new AbortController()
      stream.getAbortController(controller)

      act(() => result.current.run.handleStopRun('task-1'))

      await waitFor(() =>
        expect(mockStopWorkflowRun).toHaveBeenCalledWith(
          expect.stringContaining('/snippets/snippet-1/workflow-runs/tasks/task-1/stop'),
          expect.anything(),
          expect.anything(),
        ),
      )
      expect(controller.signal.aborted).toBe(true)
      expect(store.getState().workflowRunningData?.result.status).toBe(
        WorkflowRunningStatus.Stopped,
      )
    })

    it('does not fall back to the stored task id when stop is called without one', () => {
      const { result, store } = renderSnippetRun({
        workflowRunningData: baseRunningData({ task_id: 'task-from-store' }),
      })

      act(() => result.current.run.handleStopRun(''))

      expect(mockStopWorkflowRun).not.toHaveBeenCalled()
      expect(store.getState().workflowRunningData?.result.status).toBe(
        WorkflowRunningStatus.Stopped,
      )
    })

    it('aborts the previous stream when a new run starts', async () => {
      const { result } = renderSnippetRun()
      const firstStream = await startRun(result.current.run)
      const firstController = new AbortController()
      firstStream.getAbortController(firstController)

      await startRun(result.current.run)

      expect(firstController.signal.aborted).toBe(true)
    })
  })
})
