import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  resetReactFlowMockState,
  rfState,
} from '@/app/components/workflow/__tests__/reactflow-mock-state'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { useNodesReadOnlyByCanEdit } from '@/app/components/workflow/hooks/use-workflow'
import { useStore } from '@/app/components/workflow/store'
import { createConsoleQueryClient, seedSystemFeatures } from '@/test/console/query-data'
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

vi.mock('@/app/components/app/store', () => ({
  useStore: <T,>(selector: (state: { appDetail: { mode: string } }) => T) =>
    selector({ appDetail: { mode: 'workflow' } }),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({ getState: () => ({ features: {} }) }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({ eventEmitter: { emit: mockCanvasEvent } }),
}))

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  syncWorkflowDraft: (params: unknown) => mockSyncWorkflowDraft(params),
  fetchWorkflowDraft: (url: string) => mockFetchWorkflowDraft(url),
}))

const DraftEditor = () => {
  const hasConflict = useStore((s) => s.hasWorkflowDraftConflict)
  const { nodesReadOnly } = useNodesReadOnlyByCanEdit(true)
  const { doSyncWorkflowDraft } = useNodesSyncDraftByCanEdit(true)

  return (
    <>
      {hasConflict && <WorkflowDraftConflict />}
      <button type="button" disabled={nodesReadOnly} onClick={() => void doSyncWorkflowDraft()}>
        Save draft
      </button>
    </>
  )
}

const renderDraftEditor = () => {
  const queryClient = createConsoleQueryClient()
  seedSystemFeatures(queryClient, { enable_collaboration_mode: false })
  return renderWorkflowComponent(<DraftEditor />, {
    queryClient,
    initialStoreState: {
      appId: 'app-1',
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
        new Response(JSON.stringify({ code: 'draft_workflow_not_sync' }), { status: 409 }),
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
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()

    expect(await screen.findByRole('alert')).toHaveTextContent('workflow.draftConflict.message')
    expect(screen.getByRole('alert')).toHaveTextContent('workflow.draftConflict.description')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
    expect(rfState.nodes[0]?.id).toBe('local-start')

    let resolveReload!: (draft: typeof latestDraft) => void
    mockFetchWorkflowDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReload = resolve
      }),
    )
    const reload = screen.getByRole('button', { name: 'workflow.draftConflict.reload' })
    await user.click(reload)
    expect(reload).toHaveAttribute('aria-disabled', 'true')
    await user.click(reload)
    expect(mockFetchWorkflowDraft).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    expect(rfState.nodes[0]?.id).toBe('local-start')

    await act(async () => resolveReload(latestDraft))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(rfState.nodes[0]?.id).toBe('latest-start')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled()
    expect(store.getState().draftUpdatedAt).toBe(1_234_000)

    await user.click(screen.getByRole('button', { name: 'Save draft' }))
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
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await screen.findByRole('alert')
    mockFetchWorkflowDraft.mockRejectedValueOnce(new Error('Network unavailable'))

    await user.click(screen.getByRole('button', { name: 'workflow.draftConflict.reload' }))
    expect(await screen.findByText('workflow.draftConflict.reloadFailed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    expect(store.getState().syncWorkflowDraftHash).toBe('local-hash')
    expect(rfState.nodes[0]?.id).toBe('local-start')
    expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'workflow.draftConflict.reload' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled()
    expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(2)
  })
})
