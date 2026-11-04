import type { Node } from '@/app/components/workflow/types'
import type { consoleClient } from '@/service/console'
import { act, waitFor } from '@testing-library/react'
import { useNodes } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  baseRunningData,
  renderWorkflowCanvasHook,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import {
  createNodeStartedResponse,
  createStartedResponse,
} from '@/app/components/workflow/hooks/use-workflow-run-event/__tests__/test-helpers'
import {
  BlockEnum,
  NodeRunningStatus,
  WorkflowRunningStatus,
} from '@/app/components/workflow/types'
import { createHttpError } from '@/service/http-error'
import { createDeferred } from '@/test/deferred'
import { createRagPipelineSliceSlice } from '../../store'
import { useNodesSyncDraftByCanEdit } from '../use-nodes-sync-draft'
import { usePipelineRefreshDraft } from '../use-pipeline-refresh-draft'
import { usePipelineRunByCanEdit } from '../use-pipeline-run'

type PipelineRunCallbacks = NonNullable<
  Parameters<ReturnType<typeof usePipelineRunByCanEdit>['handleRun']>[1]
>

const saveDraft = vi.hoisted(() =>
  vi.fn<typeof consoleClient.rag.pipelines.byPipelineId.workflows.draft.post>(),
)
const streamRun = vi.hoisted(() =>
  vi.fn<(url: string, options: unknown, callbacks: PipelineRunCallbacks) => Promise<void>>(),
)
const fetchDraft = vi.hoisted(() => vi.fn())

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { rag } = await import('@dify/contracts/api/console/rag/orpc.gen')
  const { validateDefinedErrors } = await import('@/service/console/defined-errors')
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  const validate = validateDefinedErrors({ rag })
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'rag.pipelines.byPipelineId.workflows.draft.post': (input: Parameters<typeof saveDraft>[0]) =>
        validate({
          context: {},
          input,
          path: ['rag', 'pipelines', 'byPipelineId', 'workflows', 'draft', 'post'],
          next: () => saveDraft(input),
        }),
    }),
  }
})

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost: streamRun,
}))

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchWorkflowDraft: (url: string) => fetchDraft(url),
}))

vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: async () => {} }),
}))

type SavedDraft = Awaited<
  ReturnType<typeof consoleClient.rag.pipelines.byPipelineId.workflows.draft.post>
>
const saved = (hash: string): SavedDraft => ({ result: 'success', hash, updated_at: 200 })
const previousRun = baseRunningData({
  result: { id: 'previous-run', status: WorkflowRunningStatus.Succeeded },
})
const nodes = [
  createNode({
    id: 'n1',
    width: 200,
    height: 80,
    data: { type: BlockEnum.DataSource, _runningStatus: NodeRunningStatus.Succeeded },
  }),
  createNode({ id: 'kb', data: { type: BlockEnum.KnowledgeBase } }),
]

const renderPipelineRun = (pipelineId = 'pipeline-1') =>
  renderWorkflowCanvasHook(
    () => ({
      save: useNodesSyncDraftByCanEdit(true),
      run: usePipelineRunByCanEdit(true),
      refresh: usePipelineRefreshDraft(),
      nodes: useNodes<Node['data']>(),
    }),
    {
      resource: { kind: 'knowledge-pipeline', pipelineId },
      injectWorkflowStoreSliceFn: createRagPipelineSliceSlice,
      nodes,
      edges: [createEdge({ source: 'n1', target: 'kb' })],
      transform: [10, 20, 1.2],
      initialStoreState: { syncWorkflowDraftHash: 'baseline', workflowRunningData: previousRun },
    },
  )

beforeEach(() => {
  saveDraft.mockReset().mockResolvedValue(saved('saved-hash'))
  streamRun.mockReset().mockResolvedValue(undefined)
  fetchDraft.mockReset().mockResolvedValue({
    graph: { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    hash: 'server-hash',
    environment_variables: [],
    rag_pipeline_variables: [],
  })
  const container = document.createElement('div')
  container.id = 'workflow-container'
  Object.defineProperties(container, {
    clientWidth: { value: 1000 },
    clientHeight: { value: 800 },
  })
  document.body.appendChild(container)
})

afterEach(() => {
  document.getElementById('workflow-container')?.remove()
})

it('serializes autosave and the run save across hook instances, then applies native run events', async () => {
  const autosave = createDeferred<SavedDraft>()
  const runSave = createDeferred<SavedDraft>()
  saveDraft.mockReturnValueOnce(autosave.promise).mockReturnValueOnce(runSave.promise)
  const { result, store, setCanvas } = renderPipelineRun()
  let saving!: ReturnType<typeof result.current.save.doSyncWorkflowDraft>
  act(() => {
    saving = result.current.save.doSyncWorkflowDraft()
  })
  await waitFor(() => expect(saveDraft).toHaveBeenCalledOnce())

  let running!: ReturnType<typeof result.current.run.handleRun>
  await act(async () => {
    setCanvas({
      nodes: nodes.map((node) => ({ ...node, data: { ...node.data, title: 'Latest edit' } })),
    })
    running = result.current.run.handleRun({ inputs: { query: 'test' } })
  })
  expect(saveDraft).toHaveBeenCalledOnce()
  expect(streamRun).not.toHaveBeenCalled()

  await act(async () => {
    autosave.resolve(saved('hash-1'))
    await saving
  })
  await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2))
  expect(saveDraft.mock.calls[1]![0]).toMatchObject({
    params: { pipeline_id: 'pipeline-1' },
    body: {
      hash: 'hash-1',
      graph: {
        nodes: [
          expect.objectContaining({ data: expect.objectContaining({ title: 'Latest edit' }) }),
          expect.anything(),
        ],
        viewport: { x: 10, y: 20, zoom: 1.2 },
      },
    },
  })
  expect(streamRun).not.toHaveBeenCalled()

  await act(async () => {
    runSave.resolve(saved('hash-2'))
    expect(await running).toBe(true)
  })
  expect(streamRun).toHaveBeenCalledExactlyOnceWith(
    '/rag/pipelines/pipeline-1/workflows/draft/run',
    { body: { inputs: { query: 'test' } } },
    expect.anything(),
  )
  expect(store.getState().syncWorkflowDraftHash).toBe('hash-2')
  const stream = streamRun.mock.calls[0]![2]!
  act(() => {
    stream.onWorkflowStarted?.(createStartedResponse())
    stream.onNodeStarted?.(createNodeStartedResponse())
  })
  expect(result.current.nodes.find((node) => node.id === 'n1')?.data._runningStatus).toBe(
    NodeRunningStatus.Running,
  )
  expect(store.getState().workflowRunningData?.tracing).toEqual([
    expect.objectContaining({ node_id: 'n1', status: NodeRunningStatus.Running }),
  ])
})

it('keeps the previous run when saving fails and permits a successful retry', async () => {
  saveDraft.mockRejectedValueOnce(new Error('Save failed'))
  const { result, store } = renderPipelineRun()

  await act(async () => {
    expect(await result.current.run.handleRun({ inputs: {} })).toBe(false)
  })

  expect(streamRun).not.toHaveBeenCalled()
  expect(store.getState().workflowRunningData).toEqual(previousRun)
  expect(result.current.nodes.find((node) => node.id === 'n1')?.data._runningStatus).toBe(
    NodeRunningStatus.Succeeded,
  )

  await act(async () => {
    await result.current.run.handleRun({ inputs: {} })
  })
  expect(streamRun).toHaveBeenCalledOnce()
})

it('discards a queued run snapshot when an autosave conflict refreshes the baseline', async () => {
  const autosave = createDeferred<SavedDraft>()
  saveDraft.mockReturnValueOnce(autosave.promise)
  const { result, store } = renderPipelineRun()
  let saving!: ReturnType<typeof result.current.save.doSyncWorkflowDraft>
  act(() => {
    saving = result.current.save.doSyncWorkflowDraft()
  })
  await waitFor(() => expect(saveDraft).toHaveBeenCalledOnce())
  let running!: ReturnType<typeof result.current.run.handleRun>
  act(() => {
    running = result.current.run.handleRun({ inputs: {} })
  })

  await act(async () => {
    autosave.reject(
      createHttpError(new Response(null, { status: 409 }), {
        code: 'draft_workflow_not_sync',
        message: 'Workflow not synced.',
        status: 409,
      }),
    )
    await saving
    await running
  })

  expect(fetchDraft).toHaveBeenCalledOnce()
  expect(saveDraft).toHaveBeenCalledOnce()
  expect(streamRun).not.toHaveBeenCalled()
  await waitFor(() => expect(store.getState().syncWorkflowDraftHash).toBe('server-hash'))
})

it('waits for an in-flight save before refreshing the draft baseline', async () => {
  const autosave = createDeferred<SavedDraft>()
  saveDraft.mockReturnValueOnce(autosave.promise)
  const { result, store } = renderPipelineRun()
  let saving!: ReturnType<typeof result.current.save.doSyncWorkflowDraft>
  act(() => {
    saving = result.current.save.doSyncWorkflowDraft()
  })
  await waitFor(() => expect(saveDraft).toHaveBeenCalledOnce())
  let refreshing!: ReturnType<typeof result.current.refresh.handleRefreshWorkflowDraft>
  await act(async () => {
    refreshing = result.current.refresh.handleRefreshWorkflowDraft()
  })
  expect(fetchDraft).not.toHaveBeenCalled()

  await act(async () => {
    autosave.resolve(saved('hash-after-save'))
    await saving
    await refreshing
  })
  expect(fetchDraft).toHaveBeenCalledOnce()
  expect(store.getState().syncWorkflowDraftHash).toBe('server-hash')
})

it("keeps independent pipeline editors out of each other's save queues", async () => {
  const firstSave = createDeferred<SavedDraft>()
  saveDraft.mockReturnValueOnce(firstSave.promise)
  const first = renderPipelineRun('pipeline-1')
  const second = renderPipelineRun('pipeline-2')
  let saving!: ReturnType<typeof first.result.current.save.doSyncWorkflowDraft>
  act(() => {
    saving = first.result.current.save.doSyncWorkflowDraft()
  })
  await waitFor(() => expect(saveDraft).toHaveBeenCalledOnce())

  await act(async () => {
    await second.result.current.run.handleRun({ inputs: {} })
  })
  expect(streamRun.mock.calls[0]![0]).toBe('/rag/pipelines/pipeline-2/workflows/draft/run')

  await act(async () => {
    firstSave.resolve(saved('first-hash'))
    await saving
  })
})
