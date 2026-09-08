import type { ReactNode } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue, useSetAtom } from 'jotai'
import { StrictMode, useState } from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { difyBuilderPendingCreationAtom } from '../dify-builder/creation'
import { difyBuilderDraftAtom, difyBuilderLocalErrorAtom } from '../dify-builder/store'
import WorkflowMain from '../workflow-main'

const mocks = vi.hoisted(() => ({
  collaborative: true,
  graphReady: false,
  graphReadyListener: undefined as ((ready: boolean) => void) | undefined,
  setShowPanel: vi.fn(),
  setCanvasReadOnly: vi.fn(),
  setDraftUpdatedAt: vi.fn(),
  setSyncWorkflowDraftHash: vi.fn(),
  syncWorkflowDraft: vi.fn(async () => ({ hash: 'saved-hash', updated_at: 1 })),
  startBuild: vi.fn(async () => true),
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
vi.mock('@/app/components/workflow/store', () => {
  const state = {
    appId: 'created-app',
    isWorkflowDataLoaded: true,
    conversationVariables: [],
    syncWorkflowDraftHash: 'initial-hash',
    showDifyBuilderPanel: false,
    setShowDifyBuilderPanel: mocks.setShowPanel,
    setCanvasReadOnly: mocks.setCanvasReadOnly,
    setDraftUpdatedAt: mocks.setDraftUpdatedAt,
    setSyncWorkflowDraftHash: mocks.setSyncWorkflowDraftHash,
  }
  const store = { getState: () => state }
  return {
    useStore: <T,>(selector: (value: typeof state) => T) => selector(state),
    useWorkflowStore: () => store,
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
    const error = useAtomValue(difyBuilderLocalErrorAtom)
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
  },
}))
vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnlyByCanEdit: () => ({ getNodesReadOnly: () => false }),
}))
vi.mock('@/service/workflow', () => ({ syncWorkflowDraft: mocks.syncWorkflowDraft }))
vi.mock('../dify-builder/session/use-session-controller', () => ({
  useDifyBuilderSessionController: () => ({ startBuild: mocks.startBuild }),
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
    window.sessionStorage.clear()
  })

  it('waits for a persistable collaboration graph before syncing and sending the initial prompt once', async () => {
    const user = userEvent.setup()
    renderWithConsoleQuery(
      <StrictMode>
        <CreatedAppNavigation />
      </StrictMode>,
      {
        accountProfile: { id: 'user-1' },
        features: { dify_builder_enabled: true },
        systemFeatures: { enable_collaboration_mode: true },
        workspacePermissionKeys: ['app.create_and_management'],
      },
    )

    await user.click(screen.getByRole('button', { name: 'Open created app' }))

    expect(mocks.syncWorkflowDraft).not.toHaveBeenCalled()
    expect(mocks.startBuild).not.toHaveBeenCalled()
    expect(screen.getByRole('status', { name: 'Builder error' })).toBeEmptyDOMElement()

    act(() => {
      mocks.graphReady = true
      mocks.graphReadyListener?.(true)
    })

    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense workflow',
        undefined,
      ),
    )
    expect(mocks.setShowPanel).toHaveBeenCalledWith(true)
    expect(mocks.syncWorkflowDraft).toHaveBeenCalledOnce()
    expect(screen.getByRole('status', { name: 'Builder draft' })).toBeEmptyDOMElement()
    expect(screen.getByRole('status', { name: 'Builder error' })).toBeEmptyDOMElement()

    act(() => mocks.graphReadyListener?.(true))
    expect(mocks.startBuild).toHaveBeenCalledOnce()
  })

  it('syncs and sends without waiting for collaboration when collaboration is disabled', async () => {
    mocks.collaborative = false
    const user = userEvent.setup()
    renderWithConsoleQuery(<CreatedAppNavigation />, {
      accountProfile: { id: 'user-1' },
      features: { dify_builder_enabled: true },
      systemFeatures: { enable_collaboration_mode: false },
      workspacePermissionKeys: ['app.create_and_management'],
    })

    await user.click(screen.getByRole('button', { name: 'Open created app' }))

    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense workflow',
        undefined,
      ),
    )
    expect(mocks.syncWorkflowDraft).toHaveBeenCalledOnce()
    expect(screen.getByRole('status', { name: 'Builder error' })).toBeEmptyDOMElement()
  })
})
