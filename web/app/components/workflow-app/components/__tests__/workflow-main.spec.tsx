import type { ReactNode } from 'react'
import type { WorkflowProps } from '@/app/components/workflow'
import type { EventEmitterValue } from '@/context/event-emitter'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { EventEmitter } from 'ahooks/lib/useEventEmitter'
import { ReactFlowProvider, useStoreApi } from 'reactflow'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { BlockEnum } from '@/app/components/workflow/types'
import { isWorkflowDraftReplacedEvent } from '@/app/components/workflow/workflow-data-update-event'
import { EventEmitterContext, useEventEmitterContextContext } from '@/context/event-emitter'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { AppACLPermission } from '@/utils/permission'
import WorkflowMain from '../workflow-main'

let eventEmitter: EventEmitter<EventEmitterValue>
const withWorkflowProviders = (ui: ReactNode) => (
  <EventEmitterContext.Provider value={{ eventEmitter }}>
    <ReactFlowProvider>{ui}</ReactFlowProvider>
  </EventEmitterContext.Provider>
)
let queryClient = createConsoleQueryClient()
const render = (ui: ReactNode) =>
  renderWithConsoleQuery(withWorkflowProviders(ui), { queryClient })

const mockSetFeatures = vi.fn()
const mockSetConversationVariables = vi.fn()
const mockSetEnvironmentVariables = vi.fn()
const mockSetEnvSecrets = vi.fn()
const mockSetSyncWorkflowDraftHash = vi.fn()
const mockSetDraftUpdatedAt = vi.fn()
const mockSetToolPublished = vi.fn()
const mockSetLastAppliedReplacementId = vi.fn()
const mockAdvanceDraftReplacementEpoch = vi.fn()
let draftReplacementEpoch = 0
let lastAppliedReplacementId: string | null = null
const mockHandleUpdateWorkflowCanvas = vi.hoisted(() => vi.fn())
const mockFetchWorkflowDraft = vi.hoisted(() => vi.fn())
const mockOnVarsAndFeaturesUpdate = vi.hoisted(() => vi.fn())
const mockOnWorkflowUpdate = vi.hoisted(() => vi.fn())
const mockOnSyncRequest = vi.hoisted(() => vi.fn())
const mockGetIsLeader = vi.hoisted(() => vi.fn(() => true))
const mockOnGraphReloadRequired = vi.hoisted(() => vi.fn())
const mockOnGraphReadyChange = vi.hoisted(() => vi.fn())
const mockOnGraphSnapshotValidationRequired = vi.hoisted(() => vi.fn())
const mockIsGraphSnapshotValidationCurrent = vi.hoisted(() => vi.fn())
const mockCompleteGraphSnapshotValidation = vi.hoisted(() => vi.fn())
const mockIsGraphSnapshotValidationPending = vi.hoisted(() => vi.fn())
const mockRefreshGraphSynchronously = vi.hoisted(() => vi.fn())
const mockReplaceGraphFromServerDraft = vi.hoisted(() => vi.fn())
const mockCanPersistLocalGraph = vi.hoisted(() => vi.fn())
const mockIsGraphReloadCurrent = vi.hoisted(() => vi.fn())
const mockRetryGraphReload = vi.hoisted(() => vi.fn())
const mockRefreshPendingGraphReload = vi.hoisted(() => vi.fn())
const mockHasAppliedReplacement = vi.hoisted(() => vi.fn())
const mockBeginCommittedReplacement = vi.hoisted(() => vi.fn())
const mockCompleteCommittedReplacement = vi.hoisted(() => vi.fn())
const mockBeginWorkflowReplacement = vi.hoisted(() => vi.fn())
const mockIsWorkflowReplacementCurrent = vi.hoisted(() => vi.fn())
const mockCompleteWorkflowReplacement = vi.hoisted(() => vi.fn())
const mockCancelWorkflowReplacement = vi.hoisted(() => vi.fn())
const mockGetWorkflowReplacementSequence = vi.hoisted(() => vi.fn())
const mockIsWorkflowReplacementPending = vi.hoisted(() => vi.fn())
const mockUseCollaboration = vi.hoisted(() => vi.fn())

const hookFns = {
  doSyncWorkflowDraft: vi.fn(),
  syncWorkflowDraftWhenPageClose: vi.fn(),
  handleRefreshWorkflowDraft: vi.fn(),
  handleBackupDraft: vi.fn(),
  handleLoadBackupDraft: vi.fn(),
  handleRestoreFromPublishedWorkflow: vi.fn(),
  handleRun: vi.fn(),
  handleStopRun: vi.fn(),
  handleStartWorkflowRun: vi.fn(),
  handleWorkflowStartRunInChatflow: vi.fn(),
  handleWorkflowStartRunInWorkflow: vi.fn(),
  handleWorkflowTriggerScheduleRunInWorkflow: vi.fn(),
  handleWorkflowTriggerWebhookRunInWorkflow: vi.fn(),
  handleWorkflowTriggerPluginRunInWorkflow: vi.fn(),
  handleWorkflowRunAllTriggersInWorkflow: vi.fn(),
  getWorkflowRunAndTraceUrl: vi.fn(),
  exportCheck: vi.fn(),
  handleExportDSL: vi.fn(),
  fetchInspectVars: vi.fn(),
  hasNodeInspectVars: vi.fn(),
  hasSetInspectVar: vi.fn(),
  fetchInspectVarValue: vi.fn(),
  editInspectVarValue: vi.fn(),
  renameInspectVarName: vi.fn(),
  appendNodeInspectVars: vi.fn(),
  deleteInspectVar: vi.fn(),
  deleteNodeInspectorVars: vi.fn(),
  deleteAllInspectorVars: vi.fn(),
  isInspectVarEdited: vi.fn(),
  resetToLastRunVar: vi.fn(),
  invalidateSysVarValues: vi.fn(),
  resetConversationVar: vi.fn(),
  invalidateConversationVarValues: vi.fn(),
}

const collaborationRuntime = vi.hoisted(() => ({
  startCursorTracking: vi.fn(),
  stopCursorTracking: vi.fn(),
  onlineUsers: [] as Array<{ user_id: string; username: string; avatar: string; sid: string }>,
  cursors: {} as Record<string, { x: number; y: number; userId: string; timestamp: number }>,
  isConnected: false,
  isEnabled: false,
}))

const collaborationListeners = vi.hoisted(() => ({
  varsAndFeaturesUpdate: null as null | ((update: unknown) => void | Promise<void>),
  workflowUpdate: null as
    | null
    | ((update: {
        appId: string
        timestamp: number
        replacementId: string
      }) => void | Promise<void>),
  syncRequest: null as
    | null
    | ((request: {
        requestId: string
        acknowledge: (result: { success: boolean; hash?: string; updatedAt?: number }) => void
      }) => void),
  graphReloadRequired: null as
    | null
    | ((request: { generation: number; token: number; attempt: number }) => void | Promise<void>),
  graphReadyChange: null as null | ((isReady: boolean) => void),
  graphSnapshotValidationRequired: null as
    | null
    | ((request: {
        appId: string
        generation: number
        token: number
        lastReplacementId: string | null
      }) => void | Promise<void>),
}))

let capturedContextProps: Record<string, unknown> | null = null

type MockWorkflowWithInnerContextProps = Pick<
  WorkflowProps,
  | 'nodes'
  | 'edges'
  | 'viewport'
  | 'onWorkflowDataUpdate'
  | 'onDraftReplacementListenerReadyChange'
  | 'onDraftReplacementApplied'
  | 'cursors'
  | 'myUserId'
  | 'onlineUsers'
> & {
  hooksStore?: Record<string, unknown>
  children?: ReactNode
}

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({
    getState: () => ({
      setFeatures: mockSetFeatures,
    }),
  }),
}))

vi.mock('@/app/components/workflow/store', () => {
  const workflowStore = {
    getState: () => ({
      envSecrets: {},
      setConversationVariables: mockSetConversationVariables,
      setEnvironmentVariables: mockSetEnvironmentVariables,
      setEnvSecrets: mockSetEnvSecrets,
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setDraftUpdatedAt: mockSetDraftUpdatedAt,
      setToolPublished: mockSetToolPublished,
      setLastAppliedReplacementId: mockSetLastAppliedReplacementId,
      lastAppliedReplacementId,
      draftReplacementEpoch,
      advanceDraftReplacementEpoch: mockAdvanceDraftReplacementEpoch,
    }),
  }

  return {
    useStore: <T,>(selector: (state: { appId: string }) => T) => selector({ appId: 'app-1' }),
    useWorkflowStore: () => workflowStore,
  }
})

vi.mock('reactflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('reactflow')>()),
  useReactFlow: () => ({
    getNodes: () => [],
    setNodes: vi.fn(),
    getEdges: () => [],
    setEdges: vi.fn(),
  }),
}))

vi.mock('@/app/components/workflow/collaboration/hooks/use-collaboration', () => ({
  useCollaboration: (...args: unknown[]) => {
    mockUseCollaboration(...args)
    return collaborationRuntime
  },
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({
    handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas,
  }),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onVarsAndFeaturesUpdate: mockOnVarsAndFeaturesUpdate.mockImplementation(
      (handler: (update: unknown) => void | Promise<void>) => {
        collaborationListeners.varsAndFeaturesUpdate = handler
        return vi.fn()
      },
    ),
    onWorkflowUpdate: mockOnWorkflowUpdate.mockImplementation(
      (handler: NonNullable<typeof collaborationListeners.workflowUpdate>) => {
        collaborationListeners.workflowUpdate = handler
        return vi.fn()
      },
    ),
    onSyncRequest: mockOnSyncRequest.mockImplementation(
      (handler: typeof collaborationListeners.syncRequest) => {
        collaborationListeners.syncRequest = handler
        return vi.fn()
      },
    ),
    onGraphReloadRequired: mockOnGraphReloadRequired.mockImplementation(
      (handler: typeof collaborationListeners.graphReloadRequired) => {
        collaborationListeners.graphReloadRequired = handler
        return vi.fn()
      },
    ),
    onGraphReadyChange: mockOnGraphReadyChange.mockImplementation(
      (handler: typeof collaborationListeners.graphReadyChange) => {
        collaborationListeners.graphReadyChange = handler
        handler?.(true)
        return vi.fn()
      },
    ),
    onGraphSnapshotValidationRequired: mockOnGraphSnapshotValidationRequired.mockImplementation(
      (handler: typeof collaborationListeners.graphSnapshotValidationRequired) => {
        collaborationListeners.graphSnapshotValidationRequired = handler
        return vi.fn()
      },
    ),
    isGraphSnapshotValidationCurrent: mockIsGraphSnapshotValidationCurrent,
    isGraphSnapshotValidationPending: mockIsGraphSnapshotValidationPending,
    completeGraphSnapshotValidation: mockCompleteGraphSnapshotValidation,
    refreshGraphSynchronously: mockRefreshGraphSynchronously,
    replaceGraphFromServerDraft: mockReplaceGraphFromServerDraft,
    canPersistLocalGraph: mockCanPersistLocalGraph,
    isGraphReloadCurrent: mockIsGraphReloadCurrent,
    retryGraphReload: mockRetryGraphReload,
    refreshPendingGraphReload: mockRefreshPendingGraphReload,
    hasAppliedReplacement: mockHasAppliedReplacement,
    beginCommittedReplacement: mockBeginCommittedReplacement,
    completeCommittedReplacement: mockCompleteCommittedReplacement,
    beginWorkflowReplacement: mockBeginWorkflowReplacement,
    isWorkflowReplacementCurrent: mockIsWorkflowReplacementCurrent,
    completeWorkflowReplacement: mockCompleteWorkflowReplacement,
    cancelWorkflowReplacement: mockCancelWorkflowReplacement,
    getWorkflowReplacementSequence: mockGetWorkflowReplacementSequence,
    isWorkflowReplacementPending: mockIsWorkflowReplacementPending,
    getIsLeader: mockGetIsLeader,
  },
}))

vi.mock('@/service/workflow', () => ({
  fetchAppWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
}))

vi.mock('@/app/components/workflow', () => ({
  WorkflowWithInnerContext: ({
    nodes,
    edges,
    viewport,
    onWorkflowDataUpdate,
    onDraftReplacementApplied,
    onDraftReplacementListenerReadyChange,
    hooksStore,
    cursors,
    myUserId,
    onlineUsers,
    children,
  }: MockWorkflowWithInnerContextProps) => {
    const { eventEmitter } = useEventEmitterContextContext()
    eventEmitter?.useSubscription((event) => {
      if (isWorkflowDraftReplacedEvent(event)) onWorkflowDataUpdate?.(event.payload.workflowData)
    })
    capturedContextProps = {
      nodes,
      edges,
      viewport,
      onDraftReplacementListenerReadyChange,
      onDraftReplacementApplied,
      hooksStore,
      cursors,
      myUserId,
      onlineUsers,
    }
    return (
      <div data-testid="workflow-inner-context">
        <button
          type="button"
          onClick={() =>
            onWorkflowDataUpdate?.({
              nodes: [],
              edges: [],
              features: { file_upload: { enabled: true } },
              conversation_variables: [
                {
                  id: 'conversation-1',
                  name: 'conversation-1',
                  value_type: ChatVarType.String,
                  value: '',
                  description: '',
                },
              ],
              environment_variables: [
                {
                  id: 'env-1',
                  name: 'env-1',
                  value: '********************',
                  value_type: 'secret',
                  description: '',
                },
              ],
            })
          }
        >
          update-workflow-data
        </button>
        <button
          type="button"
          onClick={() =>
            onWorkflowDataUpdate?.({
              nodes: [],
              edges: [],
              conversation_variables: [
                {
                  id: 'conversation-only',
                  name: 'conversation-only',
                  value_type: ChatVarType.String,
                  value: '',
                  description: '',
                },
              ],
            })
          }
        >
          update-conversation-only
        </button>
        <button type="button" onClick={() => onWorkflowDataUpdate?.({ nodes: [], edges: [] })}>
          update-empty-payload
        </button>
        {children}
      </div>
    )
  },
}))

vi.mock('../../hooks/use-available-nodes-meta-data', () => ({
  useAvailableNodesMetaData: () => ({
    nodes: [{ id: 'start' }],
    nodesMap: { start: { id: 'start' } },
  }),
}))

vi.mock('../../hooks/use-configs-map', () => ({
  useConfigsMap: () => ({ flowId: 'app-1', flowType: 'app-flow', fileSettings: { enabled: true } }),
}))

vi.mock('../../hooks/use-DSL', () => ({
  useDSL: () => ({ exportCheck: hookFns.exportCheck, handleExportDSL: hookFns.handleExportDSL }),
  useDSLByCanEdit: () => ({
    exportCheck: hookFns.exportCheck,
    handleExportDSL: hookFns.handleExportDSL,
  }),
}))

vi.mock('../../hooks/use-get-run-and-trace-url', () => ({
  useGetRunAndTraceUrl: () => ({ getWorkflowRunAndTraceUrl: hookFns.getWorkflowRunAndTraceUrl }),
}))

vi.mock('../../hooks/use-inspect-vars-crud', () => ({
  useInspectVarsCrud: () => ({
    hasNodeInspectVars: hookFns.hasNodeInspectVars,
    hasSetInspectVar: hookFns.hasSetInspectVar,
    fetchInspectVarValue: hookFns.fetchInspectVarValue,
    editInspectVarValue: hookFns.editInspectVarValue,
    renameInspectVarName: hookFns.renameInspectVarName,
    appendNodeInspectVars: hookFns.appendNodeInspectVars,
    deleteInspectVar: hookFns.deleteInspectVar,
    deleteNodeInspectorVars: hookFns.deleteNodeInspectorVars,
    deleteAllInspectorVars: hookFns.deleteAllInspectorVars,
    isInspectVarEdited: hookFns.isInspectVarEdited,
    resetToLastRunVar: hookFns.resetToLastRunVar,
    invalidateSysVarValues: hookFns.invalidateSysVarValues,
    resetConversationVar: hookFns.resetConversationVar,
    invalidateConversationVarValues: hookFns.invalidateConversationVarValues,
  }),
}))

vi.mock('../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: hookFns.doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose: hookFns.syncWorkflowDraftWhenPageClose,
  }),
  useNodesSyncDraftByCanEdit: () => ({
    doSyncWorkflowDraft: hookFns.doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose: hookFns.syncWorkflowDraftWhenPageClose,
  }),
}))

vi.mock('../../hooks/use-workflow-refresh-draft', () => ({
  useWorkflowRefreshDraft: () => ({
    handleRefreshWorkflowDraft: hookFns.handleRefreshWorkflowDraft,
  }),
}))

vi.mock('../../hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({
    handleBackupDraft: hookFns.handleBackupDraft,
    handleLoadBackupDraft: hookFns.handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow: hookFns.handleRestoreFromPublishedWorkflow,
    handleRun: hookFns.handleRun,
    handleStopRun: hookFns.handleStopRun,
  }),
  useWorkflowRunByCanEdit: () => ({
    handleBackupDraft: hookFns.handleBackupDraft,
    handleLoadBackupDraft: hookFns.handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow: hookFns.handleRestoreFromPublishedWorkflow,
    handleRun: hookFns.handleRun,
    handleStopRun: hookFns.handleStopRun,
  }),
}))

vi.mock('../../hooks/use-workflow-start-run', () => ({
  useWorkflowStartRun: () => ({
    handleStartWorkflowRun: hookFns.handleStartWorkflowRun,
    handleWorkflowStartRunInChatflow: hookFns.handleWorkflowStartRunInChatflow,
    handleWorkflowStartRunInWorkflow: hookFns.handleWorkflowStartRunInWorkflow,
    handleWorkflowTriggerScheduleRunInWorkflow: hookFns.handleWorkflowTriggerScheduleRunInWorkflow,
    handleWorkflowTriggerWebhookRunInWorkflow: hookFns.handleWorkflowTriggerWebhookRunInWorkflow,
    handleWorkflowTriggerPluginRunInWorkflow: hookFns.handleWorkflowTriggerPluginRunInWorkflow,
    handleWorkflowRunAllTriggersInWorkflow: hookFns.handleWorkflowRunAllTriggersInWorkflow,
  }),
  useWorkflowStartRunByCanEdit: () => ({
    handleStartWorkflowRun: hookFns.handleStartWorkflowRun,
    handleWorkflowStartRunInChatflow: hookFns.handleWorkflowStartRunInChatflow,
    handleWorkflowStartRunInWorkflow: hookFns.handleWorkflowStartRunInWorkflow,
    handleWorkflowTriggerScheduleRunInWorkflow: hookFns.handleWorkflowTriggerScheduleRunInWorkflow,
    handleWorkflowTriggerWebhookRunInWorkflow: hookFns.handleWorkflowTriggerWebhookRunInWorkflow,
    handleWorkflowTriggerPluginRunInWorkflow: hookFns.handleWorkflowTriggerPluginRunInWorkflow,
    handleWorkflowRunAllTriggersInWorkflow: hookFns.handleWorkflowRunAllTriggersInWorkflow,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({
    fetchInspectVars: hookFns.fetchInspectVars,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-draft-graph-for-canvas', () => ({
  useWorkflowDraftGraphForCanvas: () => ({
    getWorkflowDraftGraphForCanvas: (
      graph?: {
        nodes?: unknown[]
        edges?: unknown[]
        viewport?: unknown
      },
      options?: { localStartPlaceholderNodes?: unknown[] },
    ) => ({
      nodes: graph?.nodes?.length
        ? graph.nodes
        : options?.localStartPlaceholderNodes?.length
          ? options.localStartPlaceholderNodes
          : [{ id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } }],
      edges: graph?.edges || [],
      viewport: graph?.viewport || { x: 0, y: 0, zoom: 1 },
    }),
  }),
}))

vi.mock('../workflow-children', () => ({
  default: () => <div data-testid="workflow-children">workflow-children</div>,
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

describe('WorkflowMain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    draftReplacementEpoch = 0
    lastAppliedReplacementId = null
    mockSetLastAppliedReplacementId.mockImplementation((replacementId: string | null) => {
      lastAppliedReplacementId = replacementId
    })
    mockAdvanceDraftReplacementEpoch.mockImplementation(() => {
      draftReplacementEpoch++
    })
    eventEmitter = new EventEmitter<EventEmitterValue>()
    capturedContextProps = null
    collaborationRuntime.startCursorTracking.mockReset()
    collaborationRuntime.stopCursorTracking.mockReset()
    collaborationRuntime.onlineUsers = []
    collaborationRuntime.cursors = {}
    collaborationRuntime.isConnected = false
    collaborationRuntime.isEnabled = false
    collaborationListeners.varsAndFeaturesUpdate = null
    collaborationListeners.workflowUpdate = null
    collaborationListeners.syncRequest = null
    collaborationListeners.graphReloadRequired = null
    collaborationListeners.graphReadyChange = null
    collaborationListeners.graphSnapshotValidationRequired = null
    mockFetchWorkflowDraft.mockReset()
    hookFns.doSyncWorkflowDraft.mockReset()
    mockGetIsLeader.mockReturnValue(true)
    mockCanPersistLocalGraph.mockReturnValue(true)
    mockIsGraphReloadCurrent.mockReturnValue(true)
    mockIsGraphSnapshotValidationCurrent.mockReturnValue(true)
    mockIsGraphSnapshotValidationPending.mockReturnValue(false)
    mockCompleteGraphSnapshotValidation.mockReturnValue(true)
    mockReplaceGraphFromServerDraft.mockReturnValue(true)
    mockRefreshPendingGraphReload.mockReturnValue(false)
    mockHasAppliedReplacement.mockReturnValue(false)
    mockBeginWorkflowReplacement.mockReturnValue(null)
    mockIsWorkflowReplacementCurrent.mockReturnValue(true)
    mockGetWorkflowReplacementSequence.mockReturnValue(null)
    mockIsWorkflowReplacementPending.mockReturnValue(false)
    hookFns.doSyncWorkflowDraft.mockResolvedValue({ hash: 'saved-hash', updatedAt: 2 })
    hookFns.handleRefreshWorkflowDraft.mockResolvedValue(true)
    queryClient = createConsoleQueryClient()
    seedAppDetail(queryClient, { id: 'app-1', mode: 'workflow' })
  })

  it('validates a follower snapshot marker and updates metadata without replacing peer graph edits', async () => {
    collaborationRuntime.isEnabled = true
    collaborationRuntime.isConnected = true
    const draft = {
      hash: 'imported-hash',
      last_replacement_id: 'import-B',
      features: { opening_statement: 'Imported' },
      conversation_variables: [],
      environment_variables: [],
      updated_at: 2,
      tool_published: false,
    }
    mockFetchWorkflowDraft.mockResolvedValue(draft)
    render(<WorkflowMain nodes={[]} edges={[]} />)
    const request = { appId: 'app-1', generation: 1, token: 2, lastReplacementId: 'import-B' }

    act(() => {
      collaborationListeners.graphSnapshotValidationRequired?.(request)
    })
    await waitFor(() => {
      expect(mockCompleteGraphSnapshotValidation).toHaveBeenCalledWith(request, 'import-B')
    })

    expect(mockSetFeatures).toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('imported-hash')
    expect(mockSetLastAppliedReplacementId).toHaveBeenCalledWith('import-B')
    expect(mockAdvanceDraftReplacementEpoch).toHaveBeenCalled()
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    expect(mockReplaceGraphFromServerDraft).not.toHaveBeenCalled()
  })

  it('keeps follower metadata unchanged while a snapshot marker differs from the server', async () => {
    collaborationRuntime.isEnabled = true
    collaborationRuntime.isConnected = true
    mockFetchWorkflowDraft.mockResolvedValue({ last_replacement_id: 'import-B' })
    mockCompleteGraphSnapshotValidation.mockReturnValue(false)
    render(<WorkflowMain nodes={[]} edges={[]} />)
    const request = { appId: 'app-1', generation: 1, token: 2, lastReplacementId: 'import-A' }

    act(() => {
      collaborationListeners.graphSnapshotValidationRequired?.(request)
    })
    await waitFor(() => {
      expect(mockCompleteGraphSnapshotValidation).toHaveBeenCalledWith(request, 'import-B')
    })

    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
    expect(mockSetLastAppliedReplacementId).not.toHaveBeenCalled()
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
  })

  it('retries snapshot validation after a failed draft GET before opening persistence', async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      collaborationRuntime.isEnabled = true
      collaborationRuntime.isConnected = true
      mockFetchWorkflowDraft
        .mockRejectedValueOnce(new Error('Draft temporarily unavailable'))
        .mockResolvedValueOnce({
          hash: 'imported-hash',
          last_replacement_id: 'import-B',
          features: {},
          conversation_variables: [],
          environment_variables: [],
          updated_at: 2,
          tool_published: false,
        })
      render(<WorkflowMain nodes={[]} edges={[]} />)
      const request = { appId: 'app-1', generation: 1, token: 2, lastReplacementId: 'import-B' }

      await act(async () => {
        collaborationListeners.graphSnapshotValidationRequired?.(request)
      })
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(mockCompleteGraphSnapshotValidation).not.toHaveBeenCalled()
      expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('imported-hash')
      expect(mockCompleteGraphSnapshotValidation).toHaveBeenCalledWith(request, 'import-B')
    } finally {
      consoleError.mockRestore()
      vi.useRealTimers()
    }
  })

  it('discards an import A GET that resolves after import B snapshot validation', async () => {
    collaborationRuntime.isEnabled = true
    collaborationRuntime.isConnected = true
    let resolveOldDraft: ((draft: unknown) => void) | undefined
    mockFetchWorkflowDraft
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldDraft = resolve
        }),
      )
      .mockResolvedValueOnce({
        hash: 'imported-hash',
        last_replacement_id: 'import-B',
        features: {},
        conversation_variables: [],
        environment_variables: [],
        updated_at: 2,
        tool_published: false,
      })
    const emit = vi.spyOn(eventEmitter, 'emit')
    render(<WorkflowMain nodes={[]} edges={[]} />)

    act(() => {
      collaborationListeners.workflowUpdate?.({
        appId: 'app-1',
        timestamp: 1,
        replacementId: 'import-A',
      })
    })
    const request = { appId: 'app-1', generation: 1, token: 2, lastReplacementId: 'import-B' }
    await act(async () => {
      collaborationListeners.graphSnapshotValidationRequired?.(request)
    })
    expect(mockCompleteGraphSnapshotValidation).toHaveBeenCalledWith(request, 'import-B')

    await act(async () => {
      resolveOldDraft?.({
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        hash: 'old-hash',
        last_replacement_id: null,
        features: {},
      })
    })

    expect(emit).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledTimes(1)
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenLastCalledWith('imported-hash')
  })

  it('waits for import B snapshot validation when an older import A GET resolves first', async () => {
    collaborationRuntime.isEnabled = true
    collaborationRuntime.isConnected = true
    let resolveOldDraft: ((draft: unknown) => void) | undefined
    let resolveImportedDraft: ((draft: unknown) => void) | undefined
    mockFetchWorkflowDraft
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldDraft = resolve
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveImportedDraft = resolve
        }),
      )
    const emit = vi.spyOn(eventEmitter, 'emit')
    render(<WorkflowMain nodes={[]} edges={[]} />)

    act(() => {
      collaborationListeners.workflowUpdate?.({
        appId: 'app-1',
        timestamp: 1,
        replacementId: 'import-A',
      })
    })
    const request = { appId: 'app-1', generation: 1, token: 2, lastReplacementId: 'import-B' }
    mockIsGraphSnapshotValidationPending.mockReturnValue(true)
    act(() => {
      collaborationListeners.graphSnapshotValidationRequired?.(request)
    })
    await act(async () => {
      resolveOldDraft?.({
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        hash: 'old-hash',
        last_replacement_id: null,
        features: {},
      })
    })
    expect(emit).not.toHaveBeenCalled()

    await act(async () => {
      resolveImportedDraft?.({
        hash: 'imported-hash',
        last_replacement_id: 'import-B',
        features: {},
        conversation_variables: [],
        environment_variables: [],
        updated_at: 2,
        tool_published: false,
      })
    })
    expect(mockCompleteGraphSnapshotValidation).toHaveBeenCalledWith(request, 'import-B')
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenLastCalledWith('imported-hash')
    expect(emit).not.toHaveBeenCalled()
  })

  it('keeps a restore notification pending until its matching canvas replacement applies', async () => {
    collaborationRuntime.isEnabled = true
    collaborationRuntime.isConnected = true
    mockBeginWorkflowReplacement.mockReturnValue(7)
    let resolveDraft: ((draft: unknown) => void) | undefined
    mockFetchWorkflowDraft.mockReturnValue(
      new Promise((resolve) => {
        resolveDraft = resolve
      }),
    )
    const emit = vi.spyOn(eventEmitter, 'emit').mockImplementation(() => {
      mockIsWorkflowReplacementCurrent.mockReturnValue(false)
    })
    render(<WorkflowMain nodes={[]} edges={[]} />)

    act(() => {
      collaborationListeners.workflowUpdate?.({
        appId: 'app-1',
        timestamp: 1,
        replacementId: 'restore-C',
      })
    })
    expect(mockBeginWorkflowReplacement).toHaveBeenCalledWith('app-1')
    expect(mockCancelWorkflowReplacement).not.toHaveBeenCalled()

    await act(async () => {
      resolveDraft?.({
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        hash: 'restored-hash',
        last_replacement_id: 'restore-C',
        features: {},
        conversation_variables: [],
        environment_variables: [],
      })
    })

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          appliedReplacementId: 'restore-C',
          replacementId: 'restore-C',
          workflowReplacementToken: 7,
        }),
      }),
    )
    expect(mockCancelWorkflowReplacement).not.toHaveBeenCalled()
  })

  it('completes a delayed import A notification after validating import B without replacing peer edits', async () => {
    vi.useFakeTimers()
    try {
      collaborationRuntime.isEnabled = true
      collaborationRuntime.isConnected = true
      mockBeginWorkflowReplacement.mockReturnValue(7)
      let resolveOldDraft: ((draft: unknown) => void) | undefined
      mockFetchWorkflowDraft
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveOldDraft = resolve
          }),
        )
        .mockResolvedValue({
          hash: 'imported-hash',
          last_replacement_id: 'import-B',
          features: {},
          conversation_variables: [],
          environment_variables: [],
          updated_at: 2,
          tool_published: false,
        })
      const emit = vi.spyOn(eventEmitter, 'emit')
      render(<WorkflowMain nodes={[]} edges={[]} />)
      act(() => {
        collaborationListeners.workflowUpdate?.({
          appId: 'app-1',
          timestamp: 1,
          replacementId: 'import-A',
        })
        collaborationListeners.graphSnapshotValidationRequired?.({
          appId: 'app-1',
          generation: 1,
          token: 2,
          lastReplacementId: 'import-B',
        })
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(mockCompleteGraphSnapshotValidation).toHaveBeenCalled()

      await act(async () => {
        resolveOldDraft?.({
          graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          hash: 'old-hash',
          last_replacement_id: null,
          features: {},
        })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(mockCompleteCommittedReplacement).toHaveBeenCalledWith(
        'app-1',
        expect.objectContaining({ getState: expect.any(Function) }),
        'import-B',
        'import-A',
      )
      expect(mockCompleteWorkflowReplacement).toHaveBeenCalledWith(
        'app-1',
        expect.objectContaining({ getState: expect.any(Function) }),
        7,
      )
      expect(emit).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let a delayed notification overwrite a newer local import token', async () => {
    collaborationRuntime.isEnabled = true
    collaborationRuntime.isConnected = true
    mockBeginWorkflowReplacement.mockReturnValue(7)
    let resolveOldDraft: ((draft: unknown) => void) | undefined
    mockFetchWorkflowDraft.mockReturnValue(
      new Promise((resolve) => {
        resolveOldDraft = resolve
      }),
    )
    const emit = vi.spyOn(eventEmitter, 'emit')
    render(<WorkflowMain nodes={[]} edges={[]} />)
    act(() => {
      collaborationListeners.workflowUpdate?.({
        appId: 'app-1',
        timestamp: 1,
        replacementId: 'import-C',
      })
    })
    expect(mockBeginWorkflowReplacement).toHaveBeenCalledWith('app-1')

    mockIsWorkflowReplacementCurrent.mockReturnValue(false)
    lastAppliedReplacementId = 'import-D'
    draftReplacementEpoch += 1
    await act(async () => {
      resolveOldDraft?.({
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        hash: 'import-C-hash',
        last_replacement_id: 'import-C',
        features: {},
      })
    })
    expect(emit).not.toHaveBeenCalled()
    expect(mockCompleteWorkflowReplacement).not.toHaveBeenCalled()
    expect(mockCancelWorkflowReplacement).not.toHaveBeenCalled()
  })

  it('applies restore C after import B snapshot validation', async () => {
    vi.useFakeTimers()
    try {
      collaborationRuntime.isEnabled = true
      collaborationRuntime.isConnected = true
      lastAppliedReplacementId = 'import-B'
      mockBeginWorkflowReplacement.mockReturnValue(7)
      mockCompleteGraphSnapshotValidation.mockImplementation(() => {
        mockIsGraphSnapshotValidationPending.mockReturnValue(false)
        return true
      })
      let resolveFirstRestoreGet: ((draft: unknown) => void) | undefined
      mockFetchWorkflowDraft
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirstRestoreGet = resolve
          }),
        )
        .mockResolvedValueOnce({
          hash: 'snapshot-hash',
          last_replacement_id: 'import-B',
          features: {},
          conversation_variables: [],
          environment_variables: [],
          updated_at: 2,
          tool_published: false,
        })
        .mockResolvedValueOnce({
          graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          hash: 'restored-hash',
          last_replacement_id: 'restore-C',
          features: {},
          conversation_variables: [],
          environment_variables: [],
        })
      const emit = vi.spyOn(eventEmitter, 'emit').mockImplementation(() => {
        mockIsWorkflowReplacementCurrent.mockReturnValue(false)
      })
      render(<WorkflowMain nodes={[]} edges={[]} />)
      act(() => {
        collaborationListeners.workflowUpdate?.({
          appId: 'app-1',
          timestamp: 3,
          replacementId: 'restore-C',
        })
        mockIsGraphSnapshotValidationPending.mockReturnValue(true)
        collaborationListeners.graphSnapshotValidationRequired?.({
          appId: 'app-1',
          generation: 1,
          token: 2,
          lastReplacementId: 'import-B',
        })
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(mockCompleteGraphSnapshotValidation).toHaveBeenCalled()

      await act(async () => {
        resolveFirstRestoreGet?.({
          graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          hash: 'snapshot-hash',
          last_replacement_id: 'import-B',
          features: {},
        })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(3)
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            appliedReplacementId: 'restore-C',
            replacementId: 'restore-C',
            workflowReplacementToken: 7,
            workflowData: expect.objectContaining({ hash: 'restored-hash' }),
          }),
        }),
      )
      expect(mockCancelWorkflowReplacement).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a newer import after an older snapshot validation advances the draft epoch', async () => {
    vi.useFakeTimers()
    try {
      collaborationRuntime.isEnabled = true
      collaborationRuntime.isConnected = true
      mockIsGraphSnapshotValidationPending.mockReturnValue(true)
      mockCompleteGraphSnapshotValidation.mockImplementation(() => {
        mockIsGraphSnapshotValidationPending.mockReturnValue(false)
        return true
      })
      let resolveOlderValidation: ((draft: unknown) => void) | undefined
      mockFetchWorkflowDraft
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveOlderValidation = resolve
          }),
        )
        .mockResolvedValueOnce({
          graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          hash: 'import-C-hash',
          last_replacement_id: 'import-C',
          features: {},
          conversation_variables: [],
          environment_variables: [],
        })
      const emit = vi.spyOn(eventEmitter, 'emit')
      render(<WorkflowMain nodes={[]} edges={[]} />)
      const request = { appId: 'app-1', generation: 1, token: 2, lastReplacementId: 'import-B' }

      act(() => {
        collaborationListeners.graphSnapshotValidationRequired?.(request)
        collaborationListeners.workflowUpdate?.({
          appId: 'app-1',
          timestamp: 3,
          replacementId: 'import-C',
        })
      })
      expect(mockBeginCommittedReplacement).toHaveBeenCalledWith('app-1', 'import-C')

      await act(async () => {
        resolveOlderValidation?.({
          hash: 'import-B-hash',
          last_replacement_id: 'import-B',
          features: {},
          conversation_variables: [],
          environment_variables: [],
          updated_at: 2,
          tool_published: false,
        })
      })
      expect(mockCompleteGraphSnapshotValidation).toHaveBeenCalledWith(request, 'import-B')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ replacementId: 'import-C' }),
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries restore C received during import B snapshot validation', async () => {
    vi.useFakeTimers()
    try {
      collaborationRuntime.isEnabled = true
      collaborationRuntime.isConnected = true
      mockIsGraphSnapshotValidationPending.mockReturnValue(true)
      mockCompleteGraphSnapshotValidation.mockImplementation(() => {
        mockIsGraphSnapshotValidationPending.mockReturnValue(false)
        return true
      })
      let resolveOlderValidation: ((draft: unknown) => void) | undefined
      mockFetchWorkflowDraft
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveOlderValidation = resolve
          }),
        )
        .mockResolvedValueOnce({
          graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          hash: 'restored-hash',
          last_replacement_id: 'restore-C',
          features: { opening_statement: 'Restored' },
          conversation_variables: [],
          environment_variables: [],
        })
      const emit = vi.spyOn(eventEmitter, 'emit')
      render(<WorkflowMain nodes={[]} edges={[]} />)
      const request = { appId: 'app-1', generation: 1, token: 2, lastReplacementId: 'import-B' }

      act(() => {
        collaborationListeners.graphSnapshotValidationRequired?.(request)
        collaborationListeners.workflowUpdate?.({
          appId: 'app-1',
          timestamp: 3,
          replacementId: 'restore-C',
        })
      })

      await act(async () => {
        resolveOlderValidation?.({
          hash: 'import-B-hash',
          last_replacement_id: 'import-B',
          features: {},
          conversation_variables: [],
          environment_variables: [],
          updated_at: 2,
          tool_published: false,
        })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })

      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            appliedReplacementId: 'restore-C',
            replacementId: 'restore-C',
            workflowData: expect.objectContaining({ hash: 'restored-hash' }),
          }),
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops an old vars and features GET after a newer imported snapshot is accepted', async () => {
    collaborationRuntime.isEnabled = true
    collaborationRuntime.isConnected = true
    let resolveOldDraft: ((draft: unknown) => void) | undefined
    mockFetchWorkflowDraft
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldDraft = resolve
        }),
      )
      .mockResolvedValueOnce({
        hash: 'imported-hash',
        last_replacement_id: 'import-B',
        features: { opening_statement: 'Imported' },
        conversation_variables: [],
        environment_variables: [],
        updated_at: 2,
        tool_published: false,
      })
    render(<WorkflowMain nodes={[]} edges={[]} />)

    act(() => {
      void collaborationListeners.varsAndFeaturesUpdate?.({ data: { syncWorkflowDraft: true } })
    })
    const request = { appId: 'app-1', generation: 1, token: 2, lastReplacementId: 'import-B' }
    await act(async () => {
      collaborationListeners.graphSnapshotValidationRequired?.(request)
    })

    await act(async () => {
      resolveOldDraft?.({
        hash: 'old-hash',
        last_replacement_id: null,
        features: { opening_statement: 'Old' },
        conversation_variables: [],
        environment_variables: [],
      })
    })

    expect(mockSetFeatures).toHaveBeenCalledTimes(1)
    expect(mockSetFeatures).toHaveBeenCalledWith(
      expect.objectContaining({
        opening: expect.objectContaining({ opening_statement: 'Imported' }),
      }),
    )
    expect(hookFns.doSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('routes a vars update that fetched a newer import through full draft reconciliation', async () => {
    collaborationRuntime.isEnabled = true
    const importedDraft = {
      graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      hash: 'imported-hash',
      last_replacement_id: 'import-B',
      features: { opening_statement: 'Imported' },
      conversation_variables: [],
      environment_variables: [],
    }
    mockFetchWorkflowDraft.mockResolvedValue(importedDraft)
    render(<WorkflowMain nodes={[]} edges={[]} />)

    await act(async () => {
      await collaborationListeners.varsAndFeaturesUpdate?.({ data: { syncWorkflowDraft: true } })
    })

    expect(hookFns.handleRefreshWorkflowDraft).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        prefetchedDraft: importedDraft,
        shouldApply: expect.any(Function),
      }),
    )
    expect(mockSetFeatures).not.toHaveBeenCalled()
    expect(hookFns.doSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('leaves vars reconciliation to pending snapshot validation', async () => {
    collaborationRuntime.isEnabled = true
    mockIsGraphSnapshotValidationPending.mockReturnValue(true)
    mockFetchWorkflowDraft.mockResolvedValue({
      last_replacement_id: 'import-B',
      features: { opening_statement: 'Imported' },
      conversation_variables: [],
      environment_variables: [],
    })
    render(<WorkflowMain nodes={[]} edges={[]} />)

    await act(async () => {
      await collaborationListeners.varsAndFeaturesUpdate?.({ data: { syncWorkflowDraft: true } })
    })

    expect(hookFns.handleRefreshWorkflowDraft).not.toHaveBeenCalled()
    expect(mockSetFeatures).not.toHaveBeenCalled()
    expect(hookFns.doSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('passes the actual ReactFlow store identity through the collaboration adapter', () => {
    let sourceStore: ReturnType<typeof useStoreApi> | undefined
    const Canvas = () => {
      sourceStore = useStoreApi()
      return <WorkflowMain nodes={[]} edges={[]} />
    }
    render(<Canvas />)
    expect(sourceStore).toBeDefined()
    const adapter = mockUseCollaboration.mock.calls.at(-1)?.[2]
    expect(adapter?.sourceStore).not.toBe(sourceStore)
    expect(adapter?.sourceStore.getState).toBe(sourceStore?.getState)
    expect(mockUseCollaboration).toHaveBeenCalledWith(
      'app-1',
      expect.any(Boolean),
      expect.objectContaining({ sourceStore }),
    )
  })

  it.each(['GET before CRDT patch', 'CRDT patch before GET'])(
    'projects the local placeholder through the collaboration adapter after %s',
    (ordering) => {
      render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)
      const adapter = mockUseCollaboration.mock.calls.at(-1)?.[2]
      const localPlaceholder = {
        id: 'existing-placeholder',
        data: { type: BlockEnum.StartPlaceholder, selected: true },
      }
      const localNodes = ordering === 'GET before CRDT patch' ? [localPlaceholder] : []

      expect(adapter?.projectNodesForCanvas([], localNodes)).toEqual([
        ordering === 'GET before CRDT patch'
          ? localPlaceholder
          : { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } },
      ])
    },
  )

  it('keeps peer edits when import A notification arrives after import B is applied', async () => {
    collaborationRuntime.isEnabled = true
    lastAppliedReplacementId = 'import-A'
    mockHasAppliedReplacement.mockImplementation(
      (_appId, replacementId) => replacementId === 'import-A' || replacementId === 'import-B',
    )
    mockFetchWorkflowDraft.mockResolvedValue({
      graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      last_replacement_id: 'import-B',
    })
    const emit = vi.spyOn(eventEmitter, 'emit')
    render(
      <WorkflowMain
        nodes={[]}
        edges={[]}
        initialReplacementId="import-A"
        viewport={{ x: 0, y: 0, zoom: 1 }}
      />,
    )
    const adapter = mockUseCollaboration.mock.calls.at(-1)?.[2]
    expect(adapter.getInitialReplacementId()).toBe('import-A')

    act(() => {
      const onApplied = capturedContextProps?.onDraftReplacementApplied as
        | ((replacementId: string) => void)
        | undefined
      onApplied?.('import-B')
    })
    lastAppliedReplacementId = 'import-B'
    expect(adapter.getInitialReplacementId()).toBe('import-B')

    act(() => {
      collaborationListeners.workflowUpdate?.({
        appId: 'app-1',
        timestamp: 1,
        replacementId: 'import-A',
      })
    })

    await waitFor(() =>
      expect(mockCompleteCommittedReplacement).toHaveBeenCalledWith(
        'app-1',
        expect.objectContaining({ getState: expect.any(Function) }),
        'import-B',
        'import-A',
      ),
    )
    expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
    expect(emit).not.toHaveBeenCalled()
    expect(mockAdvanceDraftReplacementEpoch).not.toHaveBeenCalled()
  })

  it('should render the inner workflow context with children and forwarded graph props', () => {
    const nodes = [{ id: 'node-1' }]
    const edges = [{ id: 'edge-1' }]
    const viewport = { x: 1, y: 2, zoom: 1.5 }
    const onDraftReplacementListenerReadyChange = vi.fn()

    render(
      <WorkflowMain
        nodes={nodes as never}
        edges={edges as never}
        viewport={viewport}
        onDraftReplacementListenerReadyChange={onDraftReplacementListenerReadyChange}
      />,
    )

    expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-children')).toBeInTheDocument()
    expect(capturedContextProps).toMatchObject({
      nodes,
      edges,
      viewport,
      onDraftReplacementListenerReadyChange,
    })
  })

  it('should update features and workflow variables when workflow data changes', () => {
    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    fireEvent.click(screen.getByRole('button', { name: /update-workflow-data/i }))

    expect(mockSetFeatures).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ enabled: true }),
      }),
    )
    expect(mockSetConversationVariables).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'conversation-1' }),
    ])
    expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'env-1' }),
    ])
  })

  it('should only update the workflow store slices present in the payload', () => {
    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    fireEvent.click(screen.getByRole('button', { name: /update-conversation-only/i }))

    expect(mockSetConversationVariables).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'conversation-only' }),
    ])
    expect(mockSetFeatures).not.toHaveBeenCalled()
    expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('normalizes secret masks from collaboration refreshes', () => {
    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    fireEvent.click(screen.getByRole('button', { name: /update-workflow-data/i }))

    expect(mockSetEnvSecrets).toHaveBeenCalledWith({ 'env-1': '********************' })
    expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'env-1', value: '[__HIDDEN__]' }),
    ])
  })

  it('should ignore empty workflow data updates', () => {
    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    fireEvent.click(screen.getByRole('button', { name: /update-empty-payload/i }))

    expect(mockSetFeatures).not.toHaveBeenCalled()
    expect(mockSetConversationVariables).not.toHaveBeenCalled()
    expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('should expose the composed workflow action hooks through hooksStore', () => {
    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    expect(capturedContextProps?.hooksStore).toMatchObject({
      syncWorkflowDraftWhenPageClose: hookFns.syncWorkflowDraftWhenPageClose,
      doSyncWorkflowDraft: hookFns.doSyncWorkflowDraft,
      handleRefreshWorkflowDraft: hookFns.handleRefreshWorkflowDraft,
      handleBackupDraft: hookFns.handleBackupDraft,
      handleLoadBackupDraft: hookFns.handleLoadBackupDraft,
      handleRestoreFromPublishedWorkflow: hookFns.handleRestoreFromPublishedWorkflow,
      handleRun: hookFns.handleRun,
      handleStopRun: hookFns.handleStopRun,
      handleStartWorkflowRun: hookFns.handleStartWorkflowRun,
      handleWorkflowStartRunInChatflow: hookFns.handleWorkflowStartRunInChatflow,
      handleWorkflowStartRunInWorkflow: hookFns.handleWorkflowStartRunInWorkflow,
      handleWorkflowTriggerScheduleRunInWorkflow:
        hookFns.handleWorkflowTriggerScheduleRunInWorkflow,
      handleWorkflowTriggerWebhookRunInWorkflow: hookFns.handleWorkflowTriggerWebhookRunInWorkflow,
      handleWorkflowTriggerPluginRunInWorkflow: hookFns.handleWorkflowTriggerPluginRunInWorkflow,
      handleWorkflowRunAllTriggersInWorkflow: hookFns.handleWorkflowRunAllTriggersInWorkflow,
      availableNodesMetaData: { nodes: [{ id: 'start' }], nodesMap: { start: { id: 'start' } } },
      getWorkflowRunAndTraceUrl: hookFns.getWorkflowRunAndTraceUrl,
      exportCheck: hookFns.exportCheck,
      handleExportDSL: hookFns.handleExportDSL,
      fetchInspectVars: hookFns.fetchInspectVars,
      configsMap: { flowId: 'app-1', flowType: 'app-flow', fileSettings: { enabled: true } },
    })
  })

  it('passes collaboration props and tracks cursors when collaboration is enabled', () => {
    collaborationRuntime.isEnabled = true
    collaborationRuntime.isConnected = true
    collaborationRuntime.onlineUsers = [
      { user_id: 'u-1', username: 'Alice', avatar: '', sid: 'sid-1' },
    ]
    collaborationRuntime.cursors = {
      'current-user': { x: 1, y: 2, userId: 'current-user', timestamp: 1 },
      'user-other': { x: 20, y: 30, userId: 'user-other', timestamp: 2 },
    }

    const { unmount } = render(
      <WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />,
    )

    expect(collaborationRuntime.startCursorTracking).toHaveBeenCalled()
    expect(capturedContextProps).toMatchObject({
      myUserId: 'current-user',
      onlineUsers: [{ user_id: 'u-1' }],
      cursors: {
        'user-other': expect.objectContaining({ userId: 'user-other' }),
      },
    })

    unmount()
    expect(collaborationRuntime.stopCursorTracking).toHaveBeenCalled()
  })

  it('blocks canvas input until the collaborative graph is ready', () => {
    collaborationRuntime.isEnabled = true

    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    expect(screen.queryByTestId('collaboration-graph-loading')).not.toBeInTheDocument()

    act(() => collaborationListeners.graphReadyChange?.(false))
    expect(screen.getByRole('status')).toHaveTextContent('workflow.common.syncingData')

    act(() => collaborationListeners.graphReadyChange?.(true))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('disables collaboration for view-only apps', () => {
    seedAppDetail(queryClient, { id: 'app-1', permission_keys: [AppACLPermission.ViewLayout] })

    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    expect(mockUseCollaboration).toHaveBeenCalledWith('app-1', false, expect.any(Object))
  })

  it('subscribes collaboration listeners and handles sync/workflow update callbacks', async () => {
    collaborationRuntime.isEnabled = true
    const emit = vi.spyOn(eventEmitter, 'emit')
    mockFetchWorkflowDraft.mockResolvedValue({
      hash: 'imported-hash',
      last_replacement_id: 'import-1',
      features: {
        file_upload: { enabled: true },
        opening_statement: 'hello',
      },
      conversation_variables: [],
      environment_variables: [],
      graph: {
        nodes: [
          {
            id: 'n-1',
            type: 'custom',
            position: { x: 0, y: 0 },
            data: { type: BlockEnum.Start, title: 'Start', desc: '' },
          },
        ],
        edges: [],
        viewport: { x: 3, y: 4, zoom: 1.2 },
      },
    })

    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    expect(mockOnVarsAndFeaturesUpdate).toHaveBeenCalled()
    expect(mockOnWorkflowUpdate).toHaveBeenCalled()
    expect(mockOnSyncRequest).toHaveBeenCalled()

    const acknowledge = vi.fn()
    collaborationListeners.syncRequest?.({ requestId: 'request-1', acknowledge })
    expect(mockRefreshGraphSynchronously).toHaveBeenCalled()
    await waitFor(() => {
      expect(hookFns.doSyncWorkflowDraft).toHaveBeenCalledWith(false, undefined, {
        forceLocal: true,
      })
      expect(acknowledge).toHaveBeenCalledWith({
        success: true,
        hash: 'saved-hash',
        updatedAt: 2,
      })
    })

    await collaborationListeners.varsAndFeaturesUpdate?.({})
    await collaborationListeners.workflowUpdate?.({
      appId: 'app-1',
      timestamp: 1,
      replacementId: 'import-1',
    })

    await waitFor(() => {
      expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('app-1')
      expect(mockSetFeatures).toHaveBeenCalled()
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'WORKFLOW_DRAFT_REPLACED',
          payload: expect.objectContaining({
            appId: 'app-1',
            workflowData: expect.objectContaining({
              hash: 'imported-hash',
              features: {
                file_upload: { enabled: true },
                opening_statement: 'hello',
              },
            }),
          }),
        }),
      )
      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    })
  })

  it('discards an own import notification when the local canvas applies it before the GET resolves', async () => {
    collaborationRuntime.isEnabled = true
    let resolveDraft:
      | ((draft: {
          graph: { nodes: []; edges: []; viewport: { x: number; y: number; zoom: number } }
          last_replacement_id: string
        }) => void)
      | undefined
    mockFetchWorkflowDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDraft = resolve
      }),
    )
    const emit = vi.spyOn(eventEmitter, 'emit')
    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    act(() => {
      collaborationListeners.workflowUpdate?.({
        appId: 'app-1',
        timestamp: 1,
        replacementId: 'import-1',
      })
    })
    expect(mockBeginCommittedReplacement).toHaveBeenCalledWith('app-1', 'import-1')

    lastAppliedReplacementId = 'import-1'
    mockHasAppliedReplacement.mockImplementation(
      (_appId, replacementId) => replacementId === 'import-1',
    )
    await act(async () => {
      resolveDraft?.({
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        last_replacement_id: 'import-1',
      })
    })

    expect(emit).not.toHaveBeenCalled()
    expect(mockCompleteCommittedReplacement).toHaveBeenCalledWith(
      'app-1',
      expect.objectContaining({ getState: expect.any(Function) }),
      'import-1',
      'import-1',
    )
  })

  it('applies restore C that supersedes an in-flight import A notification', async () => {
    collaborationRuntime.isEnabled = true
    let resolveImport:
      | ((draft: {
          graph: { nodes: []; edges: []; viewport: { x: number; y: number; zoom: number } }
          last_replacement_id: string
        }) => void)
      | undefined
    mockFetchWorkflowDraft
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveImport = resolve
        }),
      )
      .mockResolvedValueOnce({
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        features: { opening_statement: 'Restored' },
        last_replacement_id: 'restore-C',
      })
    const emit = vi.spyOn(eventEmitter, 'emit')
    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    act(() => {
      collaborationListeners.workflowUpdate?.({
        appId: 'app-1',
        timestamp: 1,
        replacementId: 'import-a',
      })
      collaborationListeners.workflowUpdate?.({
        appId: 'app-1',
        timestamp: 2,
        replacementId: 'restore-C',
      })
    })

    await waitFor(() => {
      expect(emit).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            appliedReplacementId: 'restore-C',
            replacementId: 'restore-C',
            draft: expect.objectContaining({ last_replacement_id: 'restore-C' }),
          }),
        }),
      )
    })
    await act(async () => {
      resolveImport?.({
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        last_replacement_id: 'import-a',
      })
    })
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('uses the GET replacement ID when an older notification reads a newer import', async () => {
    collaborationRuntime.isEnabled = true
    const emit = vi.spyOn(eventEmitter, 'emit')
    mockFetchWorkflowDraft.mockResolvedValue({
      graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      features: {},
      hash: 'same-graph-hash',
      last_replacement_id: 'import-b',
    })
    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    act(() => {
      collaborationListeners.workflowUpdate?.({
        appId: 'app-1',
        timestamp: 1,
        replacementId: 'import-a',
      })
    })
    await waitFor(() =>
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            appliedReplacementId: 'import-b',
            replacementId: 'import-a',
          }),
        }),
      ),
    )

    lastAppliedReplacementId = 'import-b'
    mockHasAppliedReplacement.mockImplementation(
      (_appId, replacementId) => replacementId === 'import-b',
    )
    act(() => {
      collaborationListeners.workflowUpdate?.({
        appId: 'app-1',
        timestamp: 2,
        replacementId: 'import-b',
      })
    })

    expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('keeps the committed import gate closed and retries a failed remote draft GET', async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      collaborationRuntime.isEnabled = true
      const emit = vi.spyOn(eventEmitter, 'emit')
      mockFetchWorkflowDraft
        .mockRejectedValueOnce(new Error('Draft temporarily unavailable'))
        .mockResolvedValueOnce({
          graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          features: {},
          last_replacement_id: 'import-1',
        })
      const { rerender } = render(
        <WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />,
      )

      await act(async () => {
        collaborationListeners.workflowUpdate?.({
          appId: 'app-1',
          timestamp: 1,
          replacementId: 'import-1',
        })
      })
      expect(mockBeginCommittedReplacement).toHaveBeenCalledWith('app-1', 'import-1')
      expect(emit).not.toHaveBeenCalled()

      rerender(
        withWorkflowProviders(
          <WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />,
        ),
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ replacementId: 'import-1' }),
        }),
      )
    } finally {
      consoleError.mockRestore()
      vi.useRealTimers()
    }
  })

  it('syncs the leader only after applying a follower environment update', async () => {
    collaborationRuntime.isEnabled = true
    mockFetchWorkflowDraft.mockResolvedValue({
      last_replacement_id: null,
      features: {},
      conversation_variables: [],
      environment_variables: [
        {
          id: 'env-model',
          name: 'shared_model',
          value_type: 'llm',
          value: { provider: 'openai', name: 'gpt-4o', mode: 'chat' },
          description: '',
        },
      ],
    })

    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)
    hookFns.doSyncWorkflowDraft.mockClear()

    await collaborationListeners.varsAndFeaturesUpdate?.({
      data: { syncWorkflowDraft: true },
    })

    expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'env-model' }),
    ])
    expect(hookFns.doSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    expect(mockSetEnvironmentVariables.mock.invocationCallOrder[0]).toBeLessThan(
      hookFns.doSyncWorkflowDraft.mock.invocationCallOrder[0]!,
    )
  })

  it('re-fetches the latest vars after a same-marker workflow replacement token closes', async () => {
    vi.useFakeTimers()
    try {
      collaborationRuntime.isEnabled = true
      mockGetWorkflowReplacementSequence.mockReturnValue(1)
      let resolveOldVars!: (draft: unknown) => void
      mockFetchWorkflowDraft
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveOldVars = resolve
          }),
        )
        .mockResolvedValueOnce({
          last_replacement_id: null,
          features: { opening_statement: 'Latest' },
          conversation_variables: [],
          environment_variables: [
            {
              id: 'env-latest',
              name: 'LATEST',
              value_type: 'string',
              value: 'new',
              description: '',
            },
          ],
        })
      render(<WorkflowMain nodes={[]} edges={[]} />)
      const firstUpdate = collaborationListeners.varsAndFeaturesUpdate?.({})
      mockGetWorkflowReplacementSequence.mockReturnValue(2)
      mockIsWorkflowReplacementPending.mockReturnValue(true)

      await act(async () => {
        resolveOldVars({
          last_replacement_id: null,
          features: { opening_statement: 'Old' },
          conversation_variables: [],
          environment_variables: [
            {
              id: 'env-old',
              name: 'OLD',
              value_type: 'string',
              value: 'old',
              description: '',
            },
          ],
        })
        await firstUpdate
      })
      expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
      mockIsWorkflowReplacementPending.mockReturnValue(false)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'env-latest' }),
      ])
      expect(mockSetEnvironmentVariables).not.toHaveBeenCalledWith([
        expect.objectContaining({ id: 'env-old' }),
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores an older environment refresh that resolves after the latest update', async () => {
    collaborationRuntime.isEnabled = true
    let resolveFirst!: (value: Record<string, unknown>) => void
    let resolveSecond!: (value: Record<string, unknown>) => void
    mockFetchWorkflowDraft
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve
        }),
      )

    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)
    const firstUpdate = collaborationListeners.varsAndFeaturesUpdate?.({
      data: { syncWorkflowDraft: true },
    })
    const secondUpdate = collaborationListeners.varsAndFeaturesUpdate?.({})

    resolveSecond({
      last_replacement_id: null,
      features: {},
      conversation_variables: [],
      environment_variables: [
        {
          id: 'env-model',
          name: 'shared_model',
          value_type: 'llm',
          value: { provider: 'openai', name: 'gpt-latest', mode: 'chat' },
          description: '',
        },
      ],
    })
    await secondUpdate

    expect(mockSetEnvironmentVariables).toHaveBeenLastCalledWith([
      expect.objectContaining({ value: expect.objectContaining({ name: 'gpt-latest' }) }),
    ])
    expect(hookFns.doSyncWorkflowDraft).toHaveBeenCalledTimes(1)

    resolveFirst({
      last_replacement_id: null,
      features: {},
      conversation_variables: [],
      environment_variables: [
        {
          id: 'env-model',
          name: 'shared_model',
          value_type: 'llm',
          value: { provider: 'openai', name: 'gpt-stale', mode: 'chat' },
          description: '',
        },
      ],
    })
    await firstUpdate

    expect(mockSetEnvironmentVariables).toHaveBeenCalledTimes(1)
    expect(hookFns.doSyncWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('applies the latest successful refresh when a newer refresh fails', async () => {
    collaborationRuntime.isEnabled = true
    let resolveFirst!: (value: Record<string, unknown>) => void
    let rejectSecond!: (reason: Error) => void
    mockFetchWorkflowDraft
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectSecond = reject
        }),
      )

    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)
    const firstUpdate = collaborationListeners.varsAndFeaturesUpdate?.({
      data: { syncWorkflowDraft: true },
    })
    const secondUpdate = collaborationListeners.varsAndFeaturesUpdate?.({})

    resolveFirst({
      last_replacement_id: null,
      features: {},
      conversation_variables: [],
      environment_variables: [
        {
          id: 'env-model',
          name: 'shared_model',
          value_type: 'llm',
          value: { provider: 'openai', name: 'gpt-recovered', mode: 'chat' },
          description: '',
        },
      ],
    })
    await firstUpdate
    expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()

    rejectSecond(new Error('refresh failed'))
    await secondUpdate

    expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([
      expect.objectContaining({ value: expect.objectContaining({ name: 'gpt-recovered' }) }),
    ])
    expect(hookFns.doSyncWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('applies a slow successful refresh after all newer refresh attempts fail', async () => {
    collaborationRuntime.isEnabled = true
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let resolveFirst!: (value: Record<string, unknown>) => void
    mockFetchWorkflowDraft
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockRejectedValueOnce(new Error('retry failed'))

    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)
    const firstUpdate = collaborationListeners.varsAndFeaturesUpdate?.({
      data: { syncWorkflowDraft: true },
    })
    const secondUpdate = collaborationListeners.varsAndFeaturesUpdate?.({})

    await secondUpdate
    expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()

    resolveFirst({
      last_replacement_id: null,
      features: {},
      conversation_variables: [],
      environment_variables: [
        {
          id: 'env-model',
          name: 'shared_model',
          value_type: 'llm',
          value: { provider: 'openai', name: 'gpt-slow-success', mode: 'chat' },
          description: '',
        },
      ],
    })
    await firstUpdate

    expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([
      expect.objectContaining({ value: expect.objectContaining({ name: 'gpt-slow-success' }) }),
    ])
    expect(hookFns.doSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })

  it('applies a slow retry after all newer refresh attempts fail', async () => {
    collaborationRuntime.isEnabled = true
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchWorkflowDraft.mockResolvedValueOnce({
      last_replacement_id: null,
      features: {},
      conversation_variables: [],
      environment_variables: [],
    })

    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)
    await collaborationListeners.varsAndFeaturesUpdate?.({})
    mockFetchWorkflowDraft.mockReset()
    mockSetEnvironmentVariables.mockClear()
    hookFns.doSyncWorkflowDraft.mockClear()

    let resolveSlowRetry!: (value: Record<string, unknown>) => void
    mockFetchWorkflowDraft
      .mockRejectedValueOnce(new Error('older refresh failed'))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSlowRetry = resolve
        }),
      )
      .mockRejectedValueOnce(new Error('newer refresh failed'))
      .mockRejectedValueOnce(new Error('newer retry failed'))

    const olderUpdate = collaborationListeners.varsAndFeaturesUpdate?.({
      data: { syncWorkflowDraft: true },
    })
    await waitFor(() => expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(2))
    const newerUpdate = collaborationListeners.varsAndFeaturesUpdate?.({})

    await newerUpdate
    expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()

    resolveSlowRetry({
      last_replacement_id: null,
      features: {},
      conversation_variables: [],
      environment_variables: [
        {
          id: 'env-model',
          name: 'shared_model',
          value_type: 'llm',
          value: { provider: 'openai', name: 'gpt-slow-retry', mode: 'chat' },
          description: '',
        },
      ],
    })
    await olderUpdate

    expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([
      expect.objectContaining({ value: expect.objectContaining({ name: 'gpt-slow-retry' }) }),
    ])
    expect(hookFns.doSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })

  it('retries a pending follower sync request after the first leader sync fails', async () => {
    collaborationRuntime.isEnabled = true
    mockFetchWorkflowDraft.mockResolvedValue({
      last_replacement_id: null,
      features: {},
      conversation_variables: [],
      environment_variables: [],
    })
    hookFns.doSyncWorkflowDraft
      .mockImplementationOnce(async (_notRefresh, callback) => {
        callback?.onError?.()
      })
      .mockImplementationOnce(async (_notRefresh, callback) => {
        callback?.onSuccess?.()
      })

    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    await collaborationListeners.varsAndFeaturesUpdate?.({
      data: { syncWorkflowDraft: true },
    })
    await collaborationListeners.varsAndFeaturesUpdate?.({})

    expect(hookFns.doSyncWorkflowDraft).toHaveBeenCalledTimes(2)
  })

  it('reloads the complete HTTP draft before trusting a leader document', async () => {
    collaborationRuntime.isEnabled = true
    const request = { generation: 2, token: 1, attempt: 0 }
    hookFns.handleRefreshWorkflowDraft.mockImplementationOnce(async (_notUpdateCanvas, options) => {
      options.onSuccess({
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        features: { file_upload: { enabled: true } },
        conversation_variables: [],
        environment_variables: [],
        updated_at: 123,
        tool_published: true,
      })
      return true
    })

    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    await collaborationListeners.graphReloadRequired?.(request)

    expect(hookFns.handleRefreshWorkflowDraft).toHaveBeenCalledWith(false, {
      shouldApply: expect.any(Function),
      onSuccess: expect.any(Function),
    })
    expect(mockSetFeatures).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ enabled: true }),
      }),
    )
    expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith(123)
    expect(mockSetToolPublished).toHaveBeenCalledWith(true)
    expect(mockReplaceGraphFromServerDraft).toHaveBeenCalledWith(request, [], [], undefined)
  })

  it('invalidates a stale leader reload when an import arrives during its draft GET', async () => {
    collaborationRuntime.isEnabled = true
    const firstRequest = { generation: 2, token: 1, attempt: 0 }
    const secondRequest = { generation: 2, token: 2, attempt: 0 }
    let activeToken = 1
    const completeFetches: Array<
      (draft: { graph: { nodes: []; edges: [] }; last_replacement_id: string }) => void
    > = []
    hookFns.handleRefreshWorkflowDraft.mockImplementation(
      (_notUpdateCanvas, options) =>
        new Promise<boolean>((resolve) => {
          completeFetches.push((draft) => {
            if (!options.shouldApply()) {
              resolve(false)
              return
            }
            options.onSuccess(draft)
            resolve(true)
          })
        }),
    )
    mockIsGraphReloadCurrent.mockImplementation((request) => request.token === activeToken)
    let secondReload: void | Promise<void>
    mockRefreshPendingGraphReload.mockImplementation(() => {
      activeToken = 2
      secondReload = collaborationListeners.graphReloadRequired?.(secondRequest)
      return true
    })
    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    const firstReload = collaborationListeners.graphReloadRequired?.(firstRequest)
    expect(completeFetches).toHaveLength(1)
    act(() => {
      collaborationListeners.workflowUpdate?.({
        appId: 'app-1',
        timestamp: 1,
        replacementId: 'import-new',
      })
    })
    expect(mockRefreshPendingGraphReload).toHaveBeenCalledWith('app-1', 'import-new')
    expect(completeFetches).toHaveLength(2)
    expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()

    await act(async () => {
      completeFetches[1]?.({ graph: { nodes: [], edges: [] }, last_replacement_id: 'import-new' })
      await secondReload
    })
    await act(async () => {
      completeFetches[0]?.({ graph: { nodes: [], edges: [] }, last_replacement_id: 'import-old' })
      await firstReload
    })

    expect(mockReplaceGraphFromServerDraft).toHaveBeenCalledExactlyOnceWith(
      secondRequest,
      [],
      [],
      'import-new',
    )
  })

  it('rejects a directed save without importing an untrusted CRDT graph', () => {
    collaborationRuntime.isEnabled = true
    mockCanPersistLocalGraph.mockReturnValue(false)

    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    const acknowledge = vi.fn()
    collaborationListeners.syncRequest?.({ requestId: 'request-untrusted', acknowledge })

    expect(acknowledge).toHaveBeenCalledWith({
      success: false,
      error: 'Collaborative graph is not ready to save.',
    })
    expect(mockRefreshGraphSynchronously).not.toHaveBeenCalled()
    expect(hookFns.doSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('retries an authoritative graph reload after a transient fetch failure', async () => {
    vi.useFakeTimers()
    try {
      collaborationRuntime.isEnabled = true
      hookFns.handleRefreshWorkflowDraft.mockResolvedValue(false)
      const request = { generation: 2, token: 1, attempt: 0 }

      render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)
      await collaborationListeners.graphReloadRequired?.(request)

      expect(mockRetryGraphReload).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1000)
      expect(mockRetryGraphReload).toHaveBeenCalledWith(request)
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores a local start placeholder for empty collaboration workflow updates', async () => {
    collaborationRuntime.isEnabled = true
    const emit = vi.spyOn(eventEmitter, 'emit')
    mockFetchWorkflowDraft.mockResolvedValue({
      last_replacement_id: 'restore-empty',
      features: {},
      conversation_variables: [],
      environment_variables: [],
      graph: {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })

    render(<WorkflowMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

    await collaborationListeners.workflowUpdate?.({
      appId: 'app-1',
      timestamp: 1,
      replacementId: 'restore-empty',
    })

    await waitFor(() => {
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'WORKFLOW_DRAFT_REPLACED',
          payload: expect.objectContaining({
            collaborationGraph: { nodes: [], edges: [] },
            workflowData: expect.objectContaining({
              nodes: [expect.objectContaining({ id: 'start-placeholder' })],
            }),
          }),
        }),
      )
    })
  })
})
