import type { ReactNode } from 'react'
import type { WorkflowProps } from '@/app/components/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import WorkflowMain from '../workflow-main'

const mockSetFeatures = vi.fn()
const mockSetConversationVariables = vi.fn()
const mockSetEnvironmentVariables = vi.fn()

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

let capturedContextProps: Record<string, unknown> | null = null

type MockWorkflowWithInnerContextProps = Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport' | 'onWorkflowDataUpdate'> & {
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
  useWorkflowStore: () => ({
    getState: () => ({
      setConversationVariables: mockSetConversationVariables,
      setEnvironmentVariables: mockSetEnvironmentVariables,
    }),
  }),
}))

vi.mock('@/app/components/workflow', () => ({
  WorkflowWithInnerContext: ({
    nodes,
    edges,
    viewport,
    onWorkflowDataUpdate,
    hooksStore,
    children,
  }: MockWorkflowWithInnerContextProps) => {
    capturedContextProps = {
      nodes,
      edges,
      viewport,
      hooksStore,
    }
    return (
      <div data-testid="workflow-inner-context">
        <button
          type="button"
          onClick={() => onWorkflowDataUpdate?.({
            features: { file: { enabled: true } },
            conversation_variables: [{ id: 'conversation-1' }],
            environment_variables: [{ id: 'env-1' }],
          })}
        >
          update-workflow-data
        </button>
        <button
          type="button"
          onClick={() => onWorkflowDataUpdate?.({
            conversation_variables: [{ id: 'conversation-only' }],
          })}
        >
          update-conversation-only
        </button>
        <button
          type="button"
          onClick={() => onWorkflowDataUpdate?.({})}
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

    expect(mockSetFeatures).toHaveBeenCalledWith({ file: { enabled: true } })
    expect(mockSetConversationVariables).toHaveBeenCalledWith([{ id: 'conversation-1' }])
    expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([{ id: 'env-1' }])
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

    expect(mockSetConversationVariables).toHaveBeenCalledWith([{ id: 'conversation-only' }])
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
})
