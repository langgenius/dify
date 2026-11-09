import type { DifyBuilderStreamEventResponse } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ReactNode } from 'react'
import type { WorkflowDraftRefreshResult } from '../../draft/use-draft-refresh'
import type { SessionView } from '@/features/dify-builder/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue, useSetAtom } from 'jotai'
import { StrictMode, useState } from 'react'
import { createWorkflowAppStore as createWorkflowStore } from '@/app/components/workflow-app/__tests__/workflow-store'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import {
  builderModel,
  createBuilderQueryClient,
} from '@/features/dify-builder/__tests__/model-fixtures'
import { difyBuilderPendingCreationAtom } from '@/features/dify-builder/creation'
import { difyBuilderDraftAtom, difyBuilderErrorAtom } from '@/features/dify-builder/state'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery, seedFeatures } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import WorkflowMain from '../workflow-main'

let workflowStore: ReturnType<typeof createWorkflowStore>

const mocks = vi.hoisted(() => ({
  collaborative: true,
  graphReady: false,
  graphReadyListener: undefined as ((ready: boolean) => void) | undefined,
  setShowPanel: vi.fn(),
  syncWorkflowDraft: vi.fn(async () => ({ hash: 'saved-hash', updated_at: 1 })),
  create: vi.fn(),
  session: vi.fn<() => Promise<SessionView>>(),
  conversation: vi.fn(),
  refreshDraft: vi.fn(async (): Promise<WorkflowDraftRefreshResult> => 'refreshed'),
  getNodes: () => [{ id: 'start-placeholder', data: { type: 'start-placeholder' } }],
  getEdges: () => [],
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({ currentWorkspace: { id: 'workspace-1' } }))
})
vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: () => undefined,
  useFeaturesStore: () => ({ getState: () => ({ features: {} }) }),
}))
vi.mock('@/app/components/workflow/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/store')>()
  const { useStore } = await import('zustand')
  return {
    ...actual,
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
  return {
    useReactFlow: () => flow,
    useStoreApi: () => store,
    useStore: <T,>(selector: (state: { d3Selection: null; d3Zoom: null }) => T) =>
      selector({ d3Selection: null, d3Zoom: null }),
  }
})
vi.mock('@/app/components/workflow', () => ({
  Workflow: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/features/dify-builder/panel', () => ({
  default: () => <aside aria-label="App Builder" />,
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
    startCursorTracking: () => {},
    stopCursorTracking: () => {},
  }),
}))
vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    canPersistLocalGraph: () => mocks.graphReady,
    isConnected: () => mocks.graphReady,
    getIsLeader: () => true,
    getNodes: mocks.getNodes,
    createServerDraftUpdate: vi.fn(),
    onServerDraftRequest: () => () => {},
    onServerDraftApplied: () => () => {},
    onJoinFailure: () => () => {},
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
    apps: {
      byAppId: {
        workflows: {
          draft: {
            post: mocks.syncWorkflowDraft,
          },
        },
      },
    },
    difyBuilder: {
      sessions: {
        post: mocks.create,
        bySessionId: { get: mocks.session, conversation: { get: mocks.conversation } },
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
vi.mock('../../draft/use-draft-graph-for-canvas', () => ({
  useWorkflowDraftGraphForCanvas: () => ({}),
}))
vi.mock('../../draft/use-draft-refresh', () => ({
  useWorkflowRefreshDraft: () => ({ handleRefreshWorkflowDraft: mocks.refreshDraft }),
}))
vi.mock('../../hooks/use-workflow-run', () => ({ useWorkflowRunByCanEdit: () => ({}) }))
vi.mock('../../hooks/use-workflow-start-run', () => ({ useWorkflowStartRunByCanEdit: () => ({}) }))
vi.mock('@/app/components/workflow/node-catalog', () => ({
  useWorkflowNodeCatalog: () => ({}),
}))
vi.mock('../../hooks/use-get-run-and-trace-url', () => ({ useGetRunAndTraceUrl: () => ({}) }))
vi.mock('../../hooks/use-DSL', () => ({ useDSLByCanEdit: () => ({}) }))
vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud-common', () => ({
  useInspectVarsCrudCommon: () => ({}),
}))

function CreatedAppNavigation() {
  const setPendingCreation = useSetAtom(difyBuilderPendingCreationAtom)
  const [created, setCreated] = useState(false)
  return created ? (
    <EditorResourceScope
      resource={{
        kind: 'app',
        appId: 'created-app',
        mode: 'workflow',
        collaborationEnabled: mocks.collaborative,
      }}
    >
      <WorkflowMain nodes={[]} edges={[]} />
    </EditorResourceScope>
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

const createCreationQueryClient = () => {
  const queryClient = createBuilderQueryClient()
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'created-app' } } }),
    createAppDetailFixture({ id: 'created-app', mode: 'workflow', maintainer: 'user-1' }),
  )
  return queryClient
}

describe('Workflow creation with App Builder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setShowPanel.mockReset()
    mocks.session.mockReset()
    mocks.collaborative = true
    mocks.graphReady = false
    mocks.graphReadyListener = undefined
    workflowStore = createWorkflowStore()
    mocks.setShowPanel.mockImplementation(workflowStore.getState().setShowDifyBuilderPanel)
    workflowStore.setState({
      isWorkflowDataLoaded: true,
      syncWorkflowDraftHash: 'initial-hash',
      setShowDifyBuilderPanel: mocks.setShowPanel,
    })
    mocks.refreshDraft.mockImplementation(async () => {
      workflowStore.getState().setWorkflowDraftSyncPhase('idle')
      return 'refreshed'
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
          session_id: 'session-1',
          version: 1,
          canvas_read_only: false,
          run_status: 'waiting_input',
          reply_language: '',
          interrupted: false,
          last_command_id: 'command-1',
          conversation_last_seq: -1,
          phase: 'clarify',
          actions: [],
        }
        yield {
          event: 'command_started',
          data: {
            session_id: view.session_id,
            command_id: 'command-1',
            version: view.version,
            phase: 'understand',
            run_status: 'processing',
          },
        }
        yield {
          event: 'command_finished',
          data: {
            session_id: view.session_id,
            command_id: 'command-1',
            version: view.version,
            canvas_read_only: view.canvas_read_only,
            run_status: view.run_status,
            reply_language: view.reply_language,
            interrupted: view.interrupted,
            conversation_last_seq: view.conversation_last_seq,
            phase: view.phase,
            actions: view.actions,
          },
        }
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
        queryClient: createCreationQueryClient(),
        accountProfile: { id: 'user-1' },
        features: { dify_builder_enabled: true },
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
      queryClient: createCreationQueryClient(),
      accountProfile: { id: 'user-1' },
      features: { dify_builder_enabled: true },
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

  it.each(['disabled', 'failed'])(
    'detaches an active Builder session when features are %s',
    async (outcome) => {
      mocks.collaborative = false
      const stream = createDeferred()
      const sessionId = 'session-1'
      const key = 'dify-builder:v1:workspace-1:user-1:created-app:active-session-id'
      mocks.create.mockImplementationOnce(
        async function* (): AsyncGenerator<DifyBuilderStreamEventResponse> {
          yield {
            event: 'command_started',
            data: {
              session_id: sessionId,
              command_id: 'command-1',
              version: 1,
              phase: 'understand',
              run_status: 'processing',
            },
          }
          await stream.promise
          yield {
            event: 'canvas',
            data: {
              session_id: sessionId,
              operation_id: 'op-1',
              at_version: 2,
              revision: 1,
              event: 'graph_changed',
              cause: 'apply',
            },
          }
        },
      )
      mocks.session.mockResolvedValue({
        session_id: sessionId,
        version: 2,
        canvas_read_only: false,
        run_status: 'waiting_input',
        reply_language: '',
        interrupted: false,
        last_command_id: 'command-1',
        conversation_last_seq: -1,
        phase: 'clarify',
        actions: [],
      })
      const queryClient = createCreationQueryClient()
      const user = userEvent.setup()
      renderWithConsoleQuery(<CreatedAppNavigation />, {
        queryClient,
        accountProfile: { id: 'user-1' },
        features: { dify_builder_enabled: true },
        workspacePermissionKeys: ['app.create_and_management'],
      })
      await user.click(screen.getByRole('button', { name: 'Open created app' }))
      await screen.findByRole('complementary', { name: 'App Builder' })
      await waitFor(() => expect(window.sessionStorage.getItem(key)).toBe(sessionId))
      expect(workflowStore.getState().canvasReadOnly).toBe(true)

      await act(async () => {
        if (outcome === 'disabled') seedFeatures(queryClient, { dify_builder_enabled: false })
        else {
          await expect(
            queryClient.query({
              queryKey: consoleQuery.features.get.queryKey(),
              queryFn: async () => {
                throw new Error('Features unavailable')
              },
              staleTime: 0,
              retry: false,
            }),
          ).rejects.toThrow('Features unavailable')
        }
      })

      await waitFor(() => {
        expect(screen.queryByRole('complementary', { name: 'App Builder' })).not.toBeInTheDocument()
        expect(workflowStore.getState().canvasReadOnly).toBe(false)
      })
      expect(mocks.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          signal: expect.objectContaining({ aborted: true }),
        }),
      )
      await act(async () => stream.resolve())
      expect(mocks.refreshDraft).not.toHaveBeenCalled()
      expect(window.sessionStorage.getItem(key)).toBe(sessionId)

      act(() => seedFeatures(queryClient, { dify_builder_enabled: true }))
      await waitFor(() =>
        expect(mocks.session).toHaveBeenCalledWith(
          { params: { session_id: sessionId } },
          expect.anything(),
        ),
      )
      expect(mocks.create).toHaveBeenCalledOnce()
    },
  )
})
