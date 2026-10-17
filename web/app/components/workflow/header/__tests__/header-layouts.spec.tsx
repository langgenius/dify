import type { Shape } from '../../store/workflow'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { seedSystemFeatures } from '@/test/console/query-data'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { WorkflowVersion } from '../../types'
import HeaderInNormal from '../header-in-normal'
import HeaderInRestoring from '../header-in-restoring'
import HeaderInHistory from '../header-in-view-history'

const mockUseNodes = vi.fn()
const mockHandleBackupDraft = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()
const mockHandleNodeSelect = vi.fn()
const mockHandleRefreshWorkflowDraft = vi.fn()
const mockCloseAllInputFieldPanels = vi.fn()
const mockInvalidAllLastRun = vi.fn()
const mockRestoreWorkflow = vi.fn()
const mockResetWorkflowVersionHistory = vi.fn()
const mockEmitRestoreIntent = vi.fn()
const mockEmitRestoreComplete = vi.fn()
const mockEmitWorkflowUpdate = vi.fn()
const mockNotify = vi.fn()

let mockNodesReadOnly = false
let mockTheme: 'light' | 'dark' = 'light'
vi.mock('reactflow', () => ({
  useNodes: () => mockUseNodes(),
}))

vi.mock('../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: mockNodesReadOnly }),
}))

vi.mock('../../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({ handleNodeSelect: mockHandleNodeSelect }),
}))

vi.mock('../../hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({
    handleBackupDraft: mockHandleBackupDraft,
    handleLoadBackupDraft: mockHandleLoadBackupDraft,
  }),
}))

vi.mock('../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: vi.fn(),
  }),
}))

vi.mock('../../hooks/use-workflow-refresh-draft', () => ({
  useWorkflowRefreshDraft: () => ({
    handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft,
  }),
}))

vi.mock('@/app/components/rag-pipeline/hooks/use-input-field-panel', () => ({
  useInputFieldPanel: () => ({
    closeAllInputFieldPanels: mockCloseAllInputFieldPanels,
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: mockTheme,
  }),
}))

vi.mock('@/service/use-workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-workflow')>()),
  useInvalidateAllLastRun: () => mockInvalidAllLastRun,
  useResetWorkflowVersionHistory: () => mockResetWorkflowVersionHistory,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.byWorkflowId.restore.post': (input) =>
        mockRestoreWorkflow('app', input),
      'rag.pipelines.byPipelineId.workflows.byWorkflowId.restore.post': (input) =>
        mockRestoreWorkflow('pipeline', input),
      'snippets.bySnippetId.workflows.byWorkflowId.restore.post': (input) =>
        mockRestoreWorkflow('snippet', input),
    }),
  }
})

vi.mock('../../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    emitRestoreIntent: mockEmitRestoreIntent,
    emitRestoreComplete: mockEmitRestoreComplete,
    emitWorkflowUpdate: mockEmitWorkflowUpdate,
  },
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

vi.mock('../editing-title', () => ({
  default: () => <div>editing-title</div>,
}))

vi.mock('../scroll-to-selected-node-button', () => ({
  default: () => <div>scroll-button</div>,
}))

vi.mock('../online-users', () => ({
  default: () => <div data-testid="online-users" />,
}))

vi.mock('../env-button', () => ({
  default: ({ disabled }: { disabled: boolean }) => (
    <div data-testid="env-button">{`${disabled}`}</div>
  ),
}))

vi.mock('../global-variable-button', () => ({
  default: ({ disabled }: { disabled: boolean }) => (
    <div data-testid="global-variable-button">{`${disabled}`}</div>
  ),
}))

vi.mock('../run-and-history', () => ({
  default: () => <div data-testid="run-and-history" />,
}))

vi.mock('../version-history-button', () => ({
  VersionHistoryButton: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      version-history
    </button>
  ),
}))

vi.mock('../restoring-title', () => ({
  default: () => <div>restoring-title</div>,
}))

vi.mock('../running-title', () => ({
  default: () => <div>running-title</div>,
}))

vi.mock('../view-history', () => ({
  default: (props: { withText?: boolean }) => {
    return <div data-testid="view-history">{props.withText ? 'with-text' : 'icon-only'}</div>
  },
}))

const createSelectedNode = (selected = true) => ({
  id: 'node-selected',
  data: {
    selected,
  },
})

const createBackupDraft = (): NonNullable<Shape['backupDraft']> => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  environmentVariables: [],
})

const createCurrentVersion = (): NonNullable<Shape['currentVersion']> => ({
  id: 'version-1',
  graph: {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  created_at: 0,
  created_by: {
    id: 'user-1',
    name: 'Tester',
    email: 'tester@example.com',
  },
  hash: 'hash-1',
  updated_at: 0,
  updated_by: {
    id: 'user-1',
    name: 'Tester',
    email: 'tester@example.com',
  },
  tool_published: false,
  environment_variables: [],
  version: WorkflowVersion.Latest,
  version_number: 5,
  marked_name: '',
  marked_comment: '',
})

describe('Header layout components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodesReadOnly = false
    mockTheme = 'light'
    mockUseNodes.mockReturnValue([])
    mockRestoreWorkflow.mockResolvedValue({})
  })

  describe('HeaderInNormal', () => {
    it('should render slots, pass read-only state to action buttons, and start restoring mode', async () => {
      mockNodesReadOnly = true
      mockUseNodes.mockReturnValue([createSelectedNode()])

      const { store } = renderWorkflowComponent(
        <HeaderInNormal
          components={{
            left: <div>left-slot</div>,
            middle: <div>middle-slot</div>,
            chatVariableTrigger: <div>chat-trigger</div>,
          }}
        />,
        {
          initialStoreState: {
            showEnvPanel: true,
            showDebugAndPreviewPanel: true,
            showVariableInspectPanel: true,
            showChatVariablePanel: true,
            showGlobalVariablePanel: true,
          },
        },
      )

      expect(screen.getByText('editing-title')).toBeInTheDocument()
      expect(screen.getByText('scroll-button')).toBeInTheDocument()
      expect(screen.getByText('left-slot')).toBeInTheDocument()
      expect(screen.getByText('middle-slot')).toBeInTheDocument()
      expect(screen.getByText('chat-trigger')).toBeInTheDocument()
      expect(screen.getByTestId('env-button')).toHaveTextContent('true')
      expect(screen.getByTestId('global-variable-button')).toHaveTextContent('true')
      expect(screen.getByTestId('run-and-history')).toBeInTheDocument()

      await userEvent.setup().click(screen.getByRole('button', { name: 'version-history' }))

      expect(mockHandleBackupDraft).toHaveBeenCalledTimes(1)
      expect(mockHandleNodeSelect).toHaveBeenCalledWith('node-selected', true)
      expect(mockCloseAllInputFieldPanels).toHaveBeenCalledTimes(1)
      expect(store.getState().isRestoring).toBe(true)
      expect(store.getState().showWorkflowVersionHistoryPanel).toBe(true)
      expect(store.getState().showEnvPanel).toBe(false)
      expect(store.getState().showDebugAndPreviewPanel).toBe(false)
      expect(store.getState().showVariableInspectPanel).toBe(false)
      expect(store.getState().showChatVariablePanel).toBe(false)
      expect(store.getState().showGlobalVariablePanel).toBe(false)
    })

    it('should hide env and global variable buttons when the controls are disabled', () => {
      renderWorkflowComponent(
        <HeaderInNormal
          controls={{
            showEnvButton: false,
            showGlobalVariableButton: false,
          }}
        />,
      )

      expect(screen.queryByTestId('env-button')).not.toBeInTheDocument()
      expect(screen.queryByTestId('global-variable-button')).not.toBeInTheDocument()
    })
  })

  describe('HeaderInRestoring', () => {
    it('should cancel restoring mode and reopen the editor state', async () => {
      const { store } = renderWorkflowComponent(<HeaderInRestoring />, {
        initialStoreState: {
          isRestoring: true,
          showWorkflowVersionHistoryPanel: true,
        },
        resource: { kind: 'app' as const, appId: 'flow-1', mode: 'workflow' as const },
        hooksStoreProps: {
          fileSettings: {},
        },
      })

      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: 'workflow.common.exitVersions' }))

      expect(mockHandleLoadBackupDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().isRestoring).toBe(false)
      expect(store.getState().showWorkflowVersionHistoryPanel).toBe(false)
    })

    it('should restore the selected version, clear backup state, and forward lifecycle callbacks', async () => {
      const onRestoreSettled = vi.fn()
      const deleteAllInspectVars = vi.fn()
      const currentVersion = createCurrentVersion()
      const currentUser = { id: 'user-1', name: 'Alice' }
      const queryClient = createAccountProfileQueryClient(currentUser)
      seedSystemFeatures(queryClient)

      const { store } = renderWorkflowComponent(
        <HeaderInRestoring onRestoreSettled={onRestoreSettled} />,
        {
          initialStoreState: {
            isRestoring: true,
            showWorkflowVersionHistoryPanel: true,
            backupDraft: createBackupDraft(),
            currentVersion,
            deleteAllInspectVars,
          },
          resource: { kind: 'app' as const, appId: 'flow-1', mode: 'workflow' as const },
          hooksStoreProps: {
            fileSettings: {},
          },
          queryClient,
        },
      )

      await userEvent.setup().click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => {
        expect(mockRestoreWorkflow).toHaveBeenCalledWith('app', {
          params: { app_id: 'flow-1', workflow_id: 'version-1' },
        })
        expect(store.getState().showWorkflowVersionHistoryPanel).toBe(false)
        expect(store.getState().isRestoring).toBe(false)
        expect(store.getState().backupDraft).toBeUndefined()
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(1)
        expect(deleteAllInspectVars).toHaveBeenCalledTimes(1)
        expect(mockInvalidAllLastRun).toHaveBeenCalledTimes(1)
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'success',
          message: 'workflowHistory.versionHistory.action.restoreSuccess',
        })
      })
      expect(mockEmitRestoreIntent).toHaveBeenCalledWith({
        versionId: currentVersion.id,
        versionName: '# 5',
        initiatorUserId: currentUser.id,
        initiatorName: currentUser.name,
      })
      expect(mockEmitRestoreComplete).toHaveBeenCalledWith({
        versionId: currentVersion.id,
        success: true,
      })
      expect(mockEmitWorkflowUpdate).toHaveBeenCalledWith('flow-1')
      expect(mockResetWorkflowVersionHistory).toHaveBeenCalledTimes(1)
      expect(onRestoreSettled).toHaveBeenCalledTimes(1)
    })

    it('keeps the draft recoverable and reports failure when restoration is rejected', async () => {
      mockRestoreWorkflow.mockRejectedValueOnce(new Error('Restore failed'))
      const backupDraft = createBackupDraft()
      const onRestoreSettled = vi.fn()
      const { store } = renderWorkflowComponent(
        <HeaderInRestoring onRestoreSettled={onRestoreSettled} />,
        {
          initialStoreState: {
            isRestoring: true,
            backupDraft,
            currentVersion: createCurrentVersion(),
          },
          resource: { kind: 'app', appId: 'flow-1', mode: 'workflow' },
        },
      )

      await userEvent.setup().click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => expect(onRestoreSettled).toHaveBeenCalledTimes(1))
      expect(store.getState().isRestoring).toBe(true)
      expect(store.getState().backupDraft).toEqual(backupDraft)
      expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
      expect(mockEmitWorkflowUpdate).not.toHaveBeenCalled()
      expect(mockEmitRestoreComplete).toHaveBeenCalledWith({
        versionId: 'version-1',
        success: false,
        error: 'restore failed',
      })
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflowHistory.versionHistory.action.restoreFailure',
      })
    })

    it('should restore rag pipeline versions without emitting collaboration events', async () => {
      const currentVersion = createCurrentVersion()

      renderWorkflowComponent(<HeaderInRestoring />, {
        initialStoreState: {
          isRestoring: true,
          showWorkflowVersionHistoryPanel: true,
          backupDraft: createBackupDraft(),
          currentVersion,
        },
        resource: { kind: 'knowledge-pipeline' as const, pipelineId: 'pipeline-1' },
        hooksStoreProps: {
          fileSettings: {},
        },
      })

      await userEvent.setup().click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => {
        expect(mockRestoreWorkflow).toHaveBeenCalledWith('pipeline', {
          params: { pipeline_id: 'pipeline-1', workflow_id: 'version-1' },
        })
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(1)
      })
      expect(mockEmitRestoreIntent).not.toHaveBeenCalled()
      expect(mockEmitRestoreComplete).not.toHaveBeenCalled()
      expect(mockEmitWorkflowUpdate).not.toHaveBeenCalled()
    })

    it('should restore snippet versions through snippet routes without emitting collaboration events', async () => {
      const currentVersion = createCurrentVersion()

      renderWorkflowComponent(<HeaderInRestoring />, {
        initialStoreState: {
          isRestoring: true,
          showWorkflowVersionHistoryPanel: true,
          backupDraft: createBackupDraft(),
          currentVersion,
        },
        resource: { kind: 'snippet' as const, snippetId: 'snippet-1' },
        hooksStoreProps: {
          fileSettings: {},
        },
      })

      await userEvent.setup().click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => {
        expect(mockRestoreWorkflow).toHaveBeenCalledWith('snippet', {
          params: { snippet_id: 'snippet-1', workflow_id: 'version-1' },
        })
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(1)
      })
      expect(mockEmitRestoreIntent).not.toHaveBeenCalled()
      expect(mockEmitRestoreComplete).not.toHaveBeenCalled()
      expect(mockEmitWorkflowUpdate).not.toHaveBeenCalled()
    })
  })

  describe('HeaderInHistory', () => {
    it('should render the history trigger with text and return to edit mode', async () => {
      const { store } = renderWorkflowComponent(
        <HeaderInHistory viewHistoryProps={{ historyUrl: '/history' } as never} />,
        {
          initialStoreState: {
            historyWorkflowData: {
              id: 'history-1',
            } as Shape['historyWorkflowData'],
          },
        },
      )

      expect(screen.getByText('running-title')).toBeInTheDocument()
      expect(screen.getByTestId('view-history')).toHaveTextContent('with-text')

      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: 'workflow.common.goBackToEdit' }))

      expect(mockHandleLoadBackupDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().historyWorkflowData).toBeUndefined()
    })
  })
})
