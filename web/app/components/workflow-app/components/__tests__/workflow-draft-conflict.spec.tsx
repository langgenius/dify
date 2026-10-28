import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  resetReactFlowMockState,
  rfState,
} from '@/app/components/workflow/__tests__/reactflow-mock-state'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { useNodesReadOnlyByCanEdit } from '@/app/components/workflow/hooks/use-workflow'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryClient, seedSystemFeatures } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { useNodesSyncDraftByCanEdit } from '../../hooks/use-nodes-sync-draft'
import WorkflowDraftConflict from '../workflow-draft-conflict'

const mockSyncWorkflowDraft = vi.fn()
const mockFetchWorkflowDraft = vi.fn()
const mockCanvasEvent = vi.fn()

vi.mock('reactflow', async () =>
  (
    await import('@/app/components/workflow/__tests__/reactflow-mock-state')
  ).createReactFlowModuleMock(),
)

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({ getState: () => ({ features: {} }) }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({ eventEmitter: { emit: mockCanvasEvent } }),
}))

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchWorkflowDraft: (url: string) => mockFetchWorkflowDraft(url),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { apps } = await import('@dify/contracts/api/console/apps/orpc.gen')
  const { validateDefinedErrors } = await import('@/service/console/defined-errors')
  const validate = validateDefinedErrors({ apps })
  const post = (input: { params: { app_id: string }; body: unknown }) =>
    validate({
      context: {},
      input,
      path: ['apps', 'byAppId', 'workflows', 'draft', 'post'],
      next: () =>
        mockSyncWorkflowDraft({
          url: `/apps/${input.params.app_id}/workflows/draft`,
          params: input.body,
        }),
    })
  return { ...actual, consoleClient: { apps: { byAppId: { workflows: { draft: { post } } } } } }
})

const DraftEditor = () => {
  const { nodesReadOnly } = useNodesReadOnlyByCanEdit(true)
  const { doSyncWorkflowDraft } = useNodesSyncDraftByCanEdit(true)

  return (
    <>
      <WorkflowDraftConflict />
      <button type="button" disabled={nodesReadOnly} onClick={() => void doSyncWorkflowDraft()}>
        Save draft
      </button>
    </>
  )
}

const renderDraftEditor = () => {
  const queryClient = createConsoleQueryClient()
  seedSystemFeatures(queryClient, { enable_collaboration_mode: false })
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppDetailFixture({ id: 'app-1', mode: 'workflow' }),
  )
  return renderWorkflowComponent(<DraftEditor />, {
    queryClient,
    initialStoreState: {
      isWorkflowDataLoaded: true,
      syncWorkflowDraftHash: 'local-hash',
    },
  })
}

const latestGraph: WorkflowDataUpdater = {
  nodes: [createStartNode({ id: 'latest-start', data: { title: 'Latest draft' } })],
  edges: [],
  viewport: { x: 10, y: 20, zoom: 1 },
}
const latestDraft = {
  graph: latestGraph,
  hash: 'latest-hash',
  updated_at: 1234,
  features: {},
  environment_variables: [],
  conversation_variables: [],
}

describe('workflow draft conflict recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    rfState.nodes = [createStartNode({ id: 'local-start', data: { title: 'Unsaved local draft' } })]
    mockSyncWorkflowDraft
      .mockRejectedValueOnce(
        createHttpError(new Response(null, { status: 409 }), {
          code: 'draft_workflow_not_sync',
          message: 'Workflow not synced.',
          status: 409,
        }),
      )
      .mockResolvedValue({ hash: 'saved-hash', updated_at: 1235 })
    mockFetchWorkflowDraft.mockResolvedValue(latestDraft)
    // Keep the refresh hook, canvas updater and node hydration real. Only the
    // ReactFlow event receiver is replaced with an in-memory canvas boundary.
    mockCanvasEvent.mockImplementation(
      ({ payload: graph }: { payload: WorkflowDataUpdater & { onApplied: () => void } }) => {
        rfState.nodes = graph.nodes
        rfState.edges = graph.edges.map((edge) => ({
          ...edge,
          sourceHandle: edge.sourceHandle ?? undefined,
          data: edge.data ?? {},
        }))
        graph.onApplied()
      },
    )
  })

  it('keeps the local draft until reload succeeds, then saves the new graph with its hash', async () => {
    const user = userEvent.setup()
    const { store } = renderDraftEditor()
    const save = screen.getByRole('button', { name: 'Save draft' })
    await user.click(save)
    expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()

    const dialog = await screen.findByRole('alertdialog', { name: 'workflow.draftConflict.title' })
    expect(dialog).toHaveTextContent('workflow.draftConflict.description')
    expect(save).toBeDisabled()
    expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
    expect(rfState.nodes[0]?.id).toBe('local-start')

    let resolveReload!: (draft: typeof latestDraft) => void
    mockFetchWorkflowDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReload = resolve
      }),
    )
    const reload = screen.getByRole('button', { name: 'workflow.draftConflict.confirmReload' })
    await user.click(reload)
    expect(reload).toHaveAttribute('aria-disabled', 'true')
    await user.click(reload)
    expect(mockFetchWorkflowDraft).toHaveBeenCalledOnce()
    expect(save).toBeDisabled()
    expect(rfState.nodes[0]?.id).toBe('local-start')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    await act(async () => resolveReload(latestDraft))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(rfState.nodes[0]?.id).toBe('latest-start')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled()
    expect(store.getState().draftUpdatedAt).toBe(1_234_000)

    await user.click(save)
    await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2))
    expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          hash: 'latest-hash',
          graph: expect.objectContaining({
            nodes: [expect.objectContaining({ id: 'latest-start' })],
          }),
        }),
      }),
    )
  })

  it('keeps editing paused after a failed reload and allows the user to retry', async () => {
    const user = userEvent.setup()
    const { store } = renderDraftEditor()
    const save = screen.getByRole('button', { name: 'Save draft' })
    await user.click(save)
    await screen.findByRole('alertdialog')
    mockFetchWorkflowDraft.mockRejectedValueOnce(new Error('Network unavailable'))

    await user.click(screen.getByRole('button', { name: 'workflow.draftConflict.confirmReload' }))
    expect(await screen.findByText('workflow.draftConflict.reloadFailed')).toBeInTheDocument()
    expect(save).toBeDisabled()
    expect(store.getState().syncWorkflowDraftHash).toBe('local-hash')
    expect(rfState.nodes[0]?.id).toBe('local-start')
    expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'workflow.draftConflict.confirmReload' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled()
    expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(2)
  })
  it('keeps the local draft and banner after deferring, and reopens only on request', async () => {
    const user = userEvent.setup()
    const { store } = renderDraftEditor()
    const save = screen.getByRole('button', { name: 'Save draft' })
    await user.click(save)
    const dialog = await screen.findByRole('alertdialog', { name: 'workflow.draftConflict.title' })
    const defer = within(dialog).getByRole('button', { name: 'workflow.draftConflict.cancel' })
    await waitFor(() => expect(defer).toHaveFocus())
    await user.click(defer)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('workflow.draftConflict.message')
    expect(save).toBeDisabled()
    expect(rfState.nodes[0]?.id).toBe('local-start')
    expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
    act(() => store.getState().invalidateWorkflowDraftSync())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'workflow.draftConflict.resolve' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
  })

  it('opens a new confirmation when a later conflict is detected', async () => {
    const user = userEvent.setup()
    const { store } = renderDraftEditor()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await user.click(await screen.findByRole('button', { name: 'workflow.draftConflict.cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    act(() => store.getState().setWorkflowDraftConflict(false))
    act(() => store.getState().setWorkflowDraftConflict(true))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
  })
})
