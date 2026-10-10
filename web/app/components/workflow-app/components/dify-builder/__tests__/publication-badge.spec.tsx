import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { SessionRunEvents } from '../session/types'
import { act, waitFor } from '@testing-library/react'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { appWorkflowQueryOptions } from '@/service/workflow-queries'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { DifyBuilderProvider } from '../provider'

const mocks = vi.hoisted(() => ({
  fetchPublished: vi.fn(),
  sessionEvents: null as SessionRunEvents | null,
}))

vi.mock('@/service/workflow-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/workflow-queries')>()
  return {
    ...actual,
    appWorkflowQueryOptions: (appId: string) => ({
      ...actual.appWorkflowQueryOptions(appId),
      queryFn: () => mocks.fetchPublished(appId),
    }),
  }
})

vi.mock('../provider/use-run-events', () => ({
  useDifyBuilderRunEvents: () => ({ onCanvasEvent: vi.fn(), reset: vi.fn() }),
}))

vi.mock('../session/use-session-controller', () => ({
  useDifyBuilderSessionController: (_sync: unknown, events: SessionRunEvents) => {
    mocks.sessionEvents = events
    return { onCanvasRefreshed: vi.fn(), restore: vi.fn() }
  },
}))

vi.mock('../provider/canvas-sync', () => ({
  DifyBuilderCanvasLockSync: () => null,
  DifyBuilderCanvasRefreshSync: () => null,
}))
vi.mock('../provider/creation-start', () => ({ DifyBuilderCreationStart: () => null }))
vi.mock('../provider/session-persistence', () => ({ DifyBuilderSessionPersistence: () => null }))

const publishedWorkflow: WorkflowResponse = {
  conversation_variables: [],
  created_at: 1_710_000_100,
  environment_variables: [],
  features: {},
  graph: {
    nodes: [
      { id: 'start', data: { type: BlockEnum.Start } },
      { id: 'answer', data: { type: BlockEnum.Answer } },
    ],
    edges: [{ id: 'edge-1', source: 'start', target: 'answer' }],
  },
  hash: 'published-hash',
  id: 'workflow-1',
  marked_comment: '',
  marked_name: '',
  rag_pipeline_variables: [],
  tool_published: false,
  updated_at: 1_710_000_100,
  version: '2026-10-09.1',
}

const canvasEvent = (event: 'publish_workflow' | 'mark_review_ready') => ({
  at_version: 2,
  event,
  operation_id: 'operation-1',
  revision: 1,
  session_id: 'session-1',
})

const setup = (appId = 'app-1') => {
  const queryClient = createConsoleQueryClient()
  const workflowStore = createWorkflowStore({})
  const publishedQuery = appWorkflowQueryOptions(appId)
  queryClient.setQueryData<WorkflowResponse | null>(publishedQuery.queryKey, null)
  renderWithConsoleQuery(
    <WorkflowContext value={workflowStore}>
      <DifyBuilderProvider
        appId={appId}
        canEdit
        getCanvasSnapshot={() => ({ nodes: [], edgeCount: 0 })}
        onFocusCanvas={() => undefined}
        onRefreshCanvas={async () => true}
        onSyncDraft={async () => undefined}
      >
        <div>Builder</div>
      </DifyBuilderProvider>
    </WorkflowContext>,
    { queryClient, features: { dify_builder_enabled: true } },
  )
  return { queryClient, workflowStore, publishedQuery }
}

describe('Builder publication badge', () => {
  beforeEach(() => {
    mocks.fetchPublished.mockReset()
    mocks.sessionEvents = null
  })

  it('replaces a fresh cached null and updates native publication metadata after publish', async () => {
    mocks.fetchPublished.mockResolvedValue(publishedWorkflow)
    const { queryClient, workflowStore, publishedQuery } = setup()

    await act(async () => mocks.sessionEvents!.onCanvasEvent(canvasEvent('publish_workflow')))

    await waitFor(() => expect(workflowStore.getState().publishedAt).toBe(1_710_000_100_000))
    expect(queryClient.getQueryData(publishedQuery.queryKey)).toEqual(publishedWorkflow)
    expect(workflowStore.getState().lastPublishedHasUserInput).toBe(true)
    expect(mocks.fetchPublished).toHaveBeenCalledExactlyOnceWith('app-1')
  })

  it('fetches the published version after an older in-flight request returns null', async () => {
    let resolveOldFetch!: (workflow: null) => void
    mocks.fetchPublished
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldFetch = resolve
          }),
      )
      .mockResolvedValueOnce(publishedWorkflow)
    const { queryClient, workflowStore, publishedQuery } = setup()
    const oldQuery = queryClient.query({ ...publishedQuery, staleTime: 0 }).catch(() => null)
    await waitFor(() => expect(mocks.fetchPublished).toHaveBeenCalledOnce())

    await act(async () => mocks.sessionEvents!.onCanvasEvent(canvasEvent('publish_workflow')))
    await act(async () => resolveOldFetch(null))
    await oldQuery

    await waitFor(() => expect(mocks.fetchPublished).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(workflowStore.getState().publishedAt).toBe(1_710_000_100_000))
    expect(queryClient.getQueryData(publishedQuery.queryKey)).toEqual(publishedWorkflow)
    expect(workflowStore.getState().lastPublishedHasUserInput).toBe(true)
    expect(mocks.fetchPublished).toHaveBeenNthCalledWith(2, 'app-1')
  })

  it('leaves the published query and badge alone for unrelated canvas events', async () => {
    const { queryClient, workflowStore, publishedQuery } = setup()

    await act(async () => mocks.sessionEvents!.onCanvasEvent(canvasEvent('mark_review_ready')))

    expect(mocks.fetchPublished).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(publishedQuery.queryKey)).toBeNull()
    expect(workflowStore.getState().publishedAt).toBe(0)
  })

  it('preserves a valid published badge when the refresh request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.fetchPublished.mockRejectedValue(new Error('network unavailable'))
    const { workflowStore } = setup()
    workflowStore.getState().setPublishedAt(1_700_000_000)

    await act(async () => mocks.sessionEvents!.onCanvasEvent(canvasEvent('publish_workflow')))

    await waitFor(() => expect(warn).toHaveBeenCalledOnce())
    expect(workflowStore.getState().publishedAt).toBe(1_700_000_000_000)
    warn.mockRestore()
  })

  it('ignores a late publication response after the Builder session resets', async () => {
    let resolvePublished!: (workflow: WorkflowResponse) => void
    mocks.fetchPublished.mockReturnValue(
      new Promise((resolve) => {
        resolvePublished = resolve
      }),
    )
    const { workflowStore } = setup()

    await act(async () => mocks.sessionEvents!.onCanvasEvent(canvasEvent('publish_workflow')))
    await waitFor(() => expect(mocks.fetchPublished).toHaveBeenCalledOnce())
    await act(async () => mocks.sessionEvents!.reset())
    await act(async () => resolvePublished(publishedWorkflow))

    expect(workflowStore.getState().publishedAt).toBe(0)
  })
})
