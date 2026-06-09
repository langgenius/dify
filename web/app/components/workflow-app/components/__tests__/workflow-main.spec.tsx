import type { ReactNode } from 'react'
import type { WorkflowProps } from '@/app/components/workflow'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import WorkflowMain from '../workflow-main'

const mockSetFeatures = vi.fn()
const mockSetConversationVariables = vi.fn()
const mockSetEnvironmentVariables = vi.fn()
const mockHandleUpdateWorkflowCanvas = vi.hoisted(() => vi.fn())
const mockFetchWorkflowDraft = vi.hoisted(() => vi.fn())
const mockOnVarsAndFeaturesUpdate = vi.hoisted(() => vi.fn())
const mockOnWorkflowUpdate = vi.hoisted(() => vi.fn())
const mockOnSyncRequest = vi.hoisted(() => vi.fn())

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
  onlineUsers: [] as Array<{ user_id: string, username: string, avatar: string, sid: string }>,
  cursors: {} as Record<string, { x: number, y: number, userId: string, timestamp: number }>,
  isConnected: false,
  isEnabled: false,
}))

const collaborationListeners = vi.hoisted(() => ({
  varsAndFeaturesUpdate: null as null | ((update: unknown) => void | Promise<void>),
  workflowUpdate: null as null | (() => void | Promise<void>),
  syncRequest: null as null | (() => void),
}))

let capturedContextProps: Record<string, unknown> | null = null

type MockWorkflowWithInnerContextProps = Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport' | 'onWorkflowDataUpdate' | 'cursors' | 'myUserId' | 'onlineUsers'> & {
  hooksStore?: Record<string, unknown>
  children?: ReactNode
}

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({
    getState: () => ({
      setFeatures: mockSetFeatures,
    }),
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: { appId: string }) => T) => selector({
    appId: 'app-1',
  }),
  useWorkflowStore: () => ({
    getState: () => ({
      setConversationVariables: mockSetConversationVariables,
      setEnvironmentVariables: mockSetEnvironmentVariables,
    }),
  }),
}))

vi.mock('reactflow', () => ({
  useReactFlow: () => ({
    getNodes: () => [],
    setNodes: vi.fn(),
    getEdges: () => [],
    setEdges: vi.fn(),
  }),
}))

vi.mock('@/app/components/workflow/collaboration/hooks/use-collaboration', () => ({
  useCollaboration: () => ({
    startCursorTracking: collaborationRuntime.startCursorTracking,
    stopCursorTracking: collaborationRuntime.stopCursorTracking,
    onlineUsers: collaborationRuntime.onlineUsers,
    cursors: collaborationRuntime.cursors,
    isConnected: collaborationRuntime.isConnected,
    isEnabled: collaborationRuntime.isEnabled,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-interactions', () => ({
  useWorkflowUpdate: () => ({
    handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas,
  }),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onVarsAndFeaturesUpdate: mockOnVarsAndFeaturesUpdate.mockImplementation((handler: (update: unknown) => void | Promise<void>) => {
      collaborationListeners.varsAndFeaturesUpdate = handler
      return vi.fn()
    }),
    onWorkflowUpdate: mockOnWorkflowUpdate.mockImplementation((handler: () => void | Promise<void>) => {
      collaborationListeners.workflowUpdate = handler
      return vi.fn()
    }),
    onSyncRequest: mockOnSyncRequest.mockImplementation((handler: () => void) => {
      collaborationListeners.syncRequest = handler
      return vi.fn()
    }),
  },
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
}))

vi.mock('@/app/components/workflow', () => ({
  WorkflowWithInnerContext: ({
    nodes,
    edges,
    viewport,
    onWorkflowDataUpdate,
    hooksStore,
    cursors,
    myUserId,
    onlineUsers,
    children,
  }: MockWorkflowWithInnerContextProps) => {
    capturedContextProps = {
      nodes,
      edges,
      viewport,
      hooksStore,
      cursors,
      myUserId,
      onlineUsers,
    }
    return (
      <div data-testid="workflow-inner-context">
        <button
          type="button"
          onClick={() => onWorkflowDataUpdate?.({
            nodes: [],
            edges: [],
            features: { file_upload: { enabled: true } },
            conversation_variables: [{
              id: 'conversation-1',
              name: 'conversation-1',
              value_type: ChatVarType.String,
              value: '',
              description: '',
            }],
            environment_variables: [{
              id: 'env-1',
              name: 'env-1',
              value: '',
              value_type: 'string',
              description: '',
            }],
          })}
        >
          update-workflow-data
        </button>
        <button
          type="button"
          onClick={() => onWorkflowDataUpdate?.({
            nodes: [],
            edges: [],
            conversation_variables: [{
              id: 'conversation-only',
              name: 'conversation-only',
              value_type: ChatVarType.String,
              value: '',
              description: '',
            }],
          })}
        >
          update-conversation-only
        </button>
        <button
          type="button"
          onClick={() => onWorkflowDataUpdate?.({ nodes: [], edges: [] })}
        >
          update-empty-payload
        </button>
        {children}
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow-app/hooks', () => ({
  useAvailableNodesMetaData: () => ({ nodes: [{ id: 'start' }], nodesMap: { start: { id: 'start' } } }),
  useConfigsMap: () => ({ flowId: 'app-1', flowType: 'app-flow', fileSettings: { enabled: true } }),
  useDSL: () => ({ exportCheck: hookFns.exportCheck, handleExportDSL: hookFns.handleExportDSL }),
  useGetRunAndTraceUrl: () => ({ getWorkflowRunAndTraceUrl: hookFns.getWorkflowRunAndTraceUrl }),
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
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: hookFns.doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose: hookFns.syncWorkflowDraftWhenPageClose,
  }),
  useSetWorkflowVarsWithValue: () => ({
    fetchInspectVars: hookFns.fetchInspectVars,
  }),
  useWorkflowRefreshDraft: () => ({ handleRefreshWorkflowDraft: hookFns.handleRefreshWorkflowDraft }),
  useWorkflowRun: () => ({
    handleBackupDraft: hookFns.handleBackupDraft,
    handleLoadBackupDraft: hookFns.handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow: hookFns.handleRestoreFromPublishedWorkflow,
    handleRun: hookFns.handleRun,
    handleStopRun: hookFns.handleStopRun,
  }),
  useWorkflowStartRun: () => ({
    handleStartWorkflowRun: hookFns.handleStartWorkflowRun,
    handleWorkflowStartRunInChatflow: hookFns.handleWorkflowStartRunInChatflow,
    handleWorkflowStartRunInWorkflow: hookFns.handleWorkflowStartRunInWorkflow,
    handleWorkflowTriggerScheduleRunInWorkflow: hookFns.handleWorkflowTriggerScheduleRunInWorkflow,
    handleWorkflowTriggerWebhookRunInWorkflow: hookFns.handleWorkflowTriggerWebhookRunInWorkflow,
    handleWorkflowTriggerPluginRunInWorkflow: hookFns.handleWorkflowTriggerPluginRunInWorkflow,
    handleWorkflowRunAllTriggersInWorkflow: hookFns.handleWorkflowRunAllTriggersInWorkflow,
  }),
}))

vi.mock('../workflow-children', () => ({
  default: () => <div data-testid="workflow-children">workflow-children</div>,
}))

describe('WorkflowMain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mockFetchWorkflowDraft.mockReset()
  })

  it('should render the inner workflow context with children and forwarded graph props', () => {
    const nodes = [{ id: 'node-1' }]
    const edges = [{ id: 'edge-1' }]
    const viewport = { x: 1, y: 2, zoom: 1.5 }

    render(
      <WorkflowMain
        nodes={nodes as never}
        edges={edges as never}
        viewport={viewport}
      />,
    )

    expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-children')).toBeInTheDocument()
    expect(capturedContextProps).toMatchObject({
      nodes,
      edges,
      viewport,
    })
  })

  it('should update features and workflow variables when workflow data changes', () => {
    render(
      <WorkflowMain
        nodes={[]}
        edges={[]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /update-workflow-data/i }))

    expect(mockSetFeatures).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({ enabled: true }),
    }))
    expect(mockSetConversationVariables).toHaveBeenCalledWith([expect.objectContaining({ id: 'conversation-1' })])
    expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([expect.objectContaining({ id: 'env-1' })])
  })

  it('should only update the workflow store slices present in the payload', () => {
    render(
      <WorkflowMain
        nodes={[]}
        edges={[]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /update-conversation-only/i }))

    expect(mockSetConversationVariables).toHaveBeenCalledWith([expect.objectContaining({ id: 'conversation-only' })])
    expect(mockSetFeatures).not.toHaveBeenCalled()
    expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('should ignore empty workflow data updates', () => {
    render(
      <WorkflowMain
        nodes={[]}
        edges={[]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /update-empty-payload/i }))

    expect(mockSetFeatures).not.toHaveBeenCalled()
    expect(mockSetConversationVariables).not.toHaveBeenCalled()
    expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('should expose the composed workflow action hooks through hooksStore', () => {
    render(
      <WorkflowMain
        nodes={[]}
        edges={[]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
      />,
    )

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
      handleWorkflowTriggerScheduleRunInWorkflow: hookFns.handleWorkflowTriggerScheduleRunInWorkflow,
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
    collaborationRuntime.onlineUsers = [{ user_id: 'u-1', username: 'Alice', avatar: '', sid: 'sid-1' }]
    collaborationRuntime.cursors = {
      'current-user': { x: 1, y: 2, userId: 'current-user', timestamp: 1 },
      'user-other': { x: 20, y: 30, userId: 'user-other', timestamp: 2 },
    }

    const { unmount } = render(
      <WorkflowMain
        nodes={[]}
        edges={[]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
      />,
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

  it('subscribes collaboration listeners and handles sync/workflow update callbacks', async () => {
    collaborationRuntime.isEnabled = true
    mockFetchWorkflowDraft.mockResolvedValue({
      features: {
        file_upload: { enabled: true },
        opening_statement: 'hello',
      },
      conversation_variables: [],
      environment_variables: [],
      graph: {
        nodes: [{ id: 'n-1' }],
        edges: [{ id: 'e-1' }],
        viewport: { x: 3, y: 4, zoom: 1.2 },
      },
    })

    render(
      <WorkflowMain
        nodes={[]}
        edges={[]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
      />,
    )

    expect(mockOnVarsAndFeaturesUpdate).toHaveBeenCalled()
    expect(mockOnWorkflowUpdate).toHaveBeenCalled()
    expect(mockOnSyncRequest).toHaveBeenCalled()

    collaborationListeners.syncRequest?.()
    expect(hookFns.doSyncWorkflowDraft).toHaveBeenCalled()

    await collaborationListeners.varsAndFeaturesUpdate?.({})
    await collaborationListeners.workflowUpdate?.()

    await waitFor(() => {
      expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('/apps/app-1/workflows/draft')
      expect(mockSetFeatures).toHaveBeenCalled()
      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
        nodes: [{ id: 'n-1' }],
        edges: [{ id: 'e-1' }],
        viewport: { x: 3, y: 4, zoom: 1.2 },
      })
    })
  })
})
