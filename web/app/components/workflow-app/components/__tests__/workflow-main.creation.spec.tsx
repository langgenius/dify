import type { DifyBuilderStreamEventResponse } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ReactNode } from 'react'
import type { SessionView } from '../dify-builder/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue, useSetAtom } from 'jotai'
import { StrictMode, useState } from 'react'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { builderModel, createBuilderQueryClient } from '../dify-builder/__tests__/model-fixtures'
import { difyBuilderPendingCreationAtom } from '../dify-builder/creation'
import { difyBuilderDraftAtom, difyBuilderErrorAtom } from '../dify-builder/store'
import WorkflowMain from '../workflow-main'

let workflowStore: ReturnType<typeof createWorkflowStore>

const mocks = vi.hoisted(() => ({
  collaborative: true,
  graphReady: false,
  graphReadyListener: undefined as ((ready: boolean) => void) | undefined,
  setShowPanel: vi.fn(),
  syncWorkflowDraft: vi.fn(async () => ({ hash: 'saved-hash', updated_at: 1 })),
  create: vi.fn(),
  conversation: vi.fn(),
  refreshDraft: vi.fn(async () => true),
  getNodes: () => [{ id: 'start-placeholder', data: { type: 'start-placeholder' } }],
  getEdges: () => [],
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: <T,>(selector: (state: { appDetail: { maintainer: string } }) => T) =>
    selector({ appDetail: { maintainer: 'user-1' } }),
}))
vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({ currentWorkspace: { id: 'workspace-1' } }))
})
vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({ getState: () => ({ features: {} }) }),
}))
vi.mock('@/app/components/workflow/store', async () => {
  const { useStore } = await import('zustand')
  return {
    useStore: <T,>(selector: (value: ReturnType<typeof workflowStore.getState>) => T) =>
      useStore(workflowStore, selector),
    useWorkflowStore: () => workflowStore,
  }
})
vi.mock('reactflow', () => {
  const flow = { getNodes: mocks.getNodes, getEdges: mocks.getEdges }
  const store = {
    getState: () => ({ getNodes: mocks.getNodes, edges: [], transform: [0, 0, 1] }),
  }
  return { useReactFlow: () => flow, useStoreApi: () => store }
})
vi.mock('@/app/components/workflow', () => ({
  WorkflowWithInnerContext: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('../workflow-children', () => ({
  default: function BuilderStatus() {
    const draft = useAtomValue(difyBuilderDraftAtom)
    const error = useAtomValue(difyBuilderErrorAtom)
    return (
      <>
        <output aria-label="Builder draft">{draft}</output>
        <output aria-label="Builder error">{error}</output>
      </>
    )
  },
}))
vi.mock('@/app/components/workflow/collaboration/hooks/use-collaboration', () => ({
  useCollaboration: () => ({
    isEnabled: mocks.collaborative,
    isConnected: mocks.graphReady,
    onlineUsers: [],
    cursors: {},
    startCursorTracking: () => {},
    stopCursorTracking: () => {},
  }),
}))
vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    canPersistLocalGraph: () => mocks.graphReady,
    isConnected: () => mocks.graphReady,
    getIsLeader: () => true,
    onGraphReadyChange: (listener: (ready: boolean) => void) => {
      mocks.graphReadyListener = listener
      // Before the collaboration connection starts, graph editing is still allowed.
      listener(true)
      return () => {
        mocks.graphReadyListener = undefined
      }
    },
    onVarsAndFeaturesUpdate: () => () => {},
    onWorkflowUpdate: () => () => {},
    onSyncRequest: () => () => {},
    onGraphReloadRequired: () => () => {},
    emitWorkflowUpdate: vi.fn(),
  },
}))
vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnlyByCanEdit: () => ({ getNodesReadOnly: () => false }),
}))
vi.mock('@/service/workflow', () => ({ syncWorkflowDraft: mocks.syncWorkflowDraft }))
vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: {
    difyBuilder: {
      sessions: {
        post: mocks.create,
        bySessionId: { conversation: { get: mocks.conversation } },
      },
    },
  },
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({}),
}))
vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({}),
}))
vi.mock('../../hooks/use-workflow-draft-graph-for-canvas', () => ({
  useWorkflowDraftGraphForCanvas: () => ({}),
}))
vi.mock('../../hooks/use-workflow-refresh-draft', () => ({
  useWorkflowRefreshDraft: () => ({ handleRefreshWorkflowDraft: mocks.refreshDraft }),
}))
vi.mock('../../hooks/use-workflow-run', () => ({ useWorkflowRunByCanEdit: () => ({}) }))
vi.mock('../../hooks/use-workflow-start-run', () => ({ useWorkflowStartRunByCanEdit: () => ({}) }))
vi.mock('../../hooks/use-available-nodes-meta-data', () => ({
  useAvailableNodesMetaData: () => ({}),
}))
vi.mock('../../hooks/use-get-run-and-trace-url', () => ({ useGetRunAndTraceUrl: () => ({}) }))
vi.mock('../../hooks/use-DSL', () => ({ useDSLByCanEdit: () => ({}) }))
vi.mock('../../hooks/use-configs-map', () => ({ useConfigsMap: () => ({}) }))
vi.mock('../../hooks/use-inspect-vars-crud', () => ({ useInspectVarsCrud: () => ({}) }))

function CreatedAppNavigation() {
  const setPendingCreation = useSetAtom(difyBuilderPendingCreationAtom)
  const [created, setCreated] = useState(false)
  return created ? (
    <WorkflowMain nodes={[]} edges={[]} />
  ) : (
    <button
      type="button"
      onClick={() => {
        setPendingCreation({ appId: 'created-app', prompt: 'Build an expense workflow' })
        setCreated(true)
      }}
    >
      Open created app
    </button>
  )
}

describe('Workflow creation with App Builder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.collaborative = true
    mocks.graphReady = false
    mocks.graphReadyListener = undefined
    workflowStore = createWorkflowStore({})
    workflowStore.setState({
      appId: 'created-app',
      isWorkflowDataLoaded: true,
      syncWorkflowDraftHash: 'initial-hash',
      setShowDifyBuilderPanel: mocks.setShowPanel,
    })
    mocks.refreshDraft.mockImplementation(async () => {
      workflowStore.getState().setWorkflowDraftSyncPhase('idle')
      return true
    })
    mocks.conversation.mockResolvedValue({
      data: [],
      has_more: false,
      first_seq: null,
      last_seq: null,
    })
    mocks.create.mockImplementation(
      async function* (): AsyncGenerator<DifyBuilderStreamEventResponse> {
        const view: SessionView = {
          app_id: 'created-app',
          session_id: 'session-1',
          state: 'build.goal_analysis',
          version: 1,
          canvas_read_only: false,
          run_status: 'waiting_input',
          interrupted: false,
          conversation_last_seq: -1,
        }
        yield { event: 'command_started', data: { kind: 'command_started', ...view } }
        yield { event: 'state', data: { kind: 'state', ...view } }
      },
    )
    window.sessionStorage.clear()
  })

  it('waits for a persistable collaboration graph before syncing and sending the initial prompt once', async () => {
    const user = userEvent.setup()
    renderWithConsoleQuery(
      <StrictMode>
        <CreatedAppNavigation />
      </StrictMode>,
      {
        queryClient: createBuilderQueryClient(),
        accountProfile: { id: 'user-1' },
        features: { dify_builder_enabled: true },
        systemFeatures: { enable_collaboration_mode: true },
        workspacePermissionKeys: ['app.create_and_management'],
      },
    )

    await user.click(screen.getByRole('button', { name: 'Open created app' }))

    expect(mocks.syncWorkflowDraft).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(screen.getByRole('status', { name: 'Builder error' })).toBeEmptyDOMElement()

    act(() => {
      mocks.graphReady = true
      mocks.graphReadyListener?.(true)
    })

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        {
          body: expect.objectContaining({
            app_id: 'created-app',
            goal_text: 'Build an expense workflow',
            model_config: builderModel,
          }),
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    )
    expect(mocks.setShowPanel).toHaveBeenCalledWith(true)
    expect(mocks.syncWorkflowDraft).toHaveBeenCalledOnce()
    expect(screen.getByRole('status', { name: 'Builder draft' })).toBeEmptyDOMElement()
    expect(screen.getByRole('status', { name: 'Builder error' })).toBeEmptyDOMElement()

    act(() => mocks.graphReadyListener?.(true))
    expect(mocks.create).toHaveBeenCalledOnce()
  })

  it('syncs and sends without waiting for collaboration when collaboration is disabled', async () => {
    mocks.collaborative = false
    const user = userEvent.setup()
    renderWithConsoleQuery(<CreatedAppNavigation />, {
      queryClient: createBuilderQueryClient(),
      accountProfile: { id: 'user-1' },
      features: { dify_builder_enabled: true },
      systemFeatures: { enable_collaboration_mode: false },
      workspacePermissionKeys: ['app.create_and_management'],
    })

    await user.click(screen.getByRole('button', { name: 'Open created app' }))

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        {
          body: expect.objectContaining({
            app_id: 'created-app',
            goal_text: 'Build an expense workflow',
            model_config: builderModel,
          }),
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    )
    expect(mocks.syncWorkflowDraft).toHaveBeenCalledOnce()
    expect(screen.getByRole('status', { name: 'Builder error' })).toBeEmptyDOMElement()
  })
})
