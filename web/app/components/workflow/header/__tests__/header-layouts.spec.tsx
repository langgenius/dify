import type { Shape } from '../../store/workflow'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { FlowType } from '@/types/common'
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
const mockRunAndHistory = vi.fn()
const mockViewHistory = vi.fn()

let mockNodesReadOnly = false
let mockTheme: 'light' | 'dark' = 'light'

vi.mock('reactflow', () => ({
  useNodes: () => mockUseNodes(),
}))

vi.mock('../../hooks', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: mockNodesReadOnly }),
  useNodesInteractions: () => ({ handleNodeSelect: mockHandleNodeSelect }),
  useWorkflowRun: () => ({
    handleBackupDraft: mockHandleBackupDraft,
    handleLoadBackupDraft: mockHandleLoadBackupDraft,
  }),
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: vi.fn(),
  }),
  useWorkflowRefreshDraft: () => ({
    handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft,
  }),
}))

vi.mock('@/app/components/rag-pipeline/hooks', () => ({
  useInputFieldPanel: () => ({
    closeAllInputFieldPanels: mockCloseAllInputFieldPanels,
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: mockTheme,
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidAllLastRun: () => mockInvalidAllLastRun,
  useResetWorkflowVersionHistory: () => mockResetWorkflowVersionHistory,
  useRestoreWorkflow: () => ({
    mutateAsync: mockRestoreWorkflow,
  }),
}))

vi.mock('../../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    emitRestoreIntent: mockEmitRestoreIntent,
    emitRestoreComplete: mockEmitRestoreComplete,
    emitWorkflowUpdate: mockEmitWorkflowUpdate,
  },
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
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
  default: ({ disabled }: { disabled: boolean }) => <div data-testid="env-button">{`${disabled}`}</div>,
}))

vi.mock('../global-variable-button', () => ({
  default: ({ disabled }: { disabled: boolean }) => <div data-testid="global-variable-button">{`${disabled}`}</div>,
}))

vi.mock('../run-and-history', () => ({
  default: (props: object) => {
    mockRunAndHistory(props)
    return <div data-testid="run-and-history" />
  },
}))

vi.mock('../version-history-button', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
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
    mockViewHistory(props)
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
    it('should render slots, pass read-only state to action buttons, and start restoring mode', () => {
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
      expect(mockRunAndHistory).toHaveBeenCalledTimes(1)

      fireEvent.click(screen.getByRole('button', { name: 'version-history' }))

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
  })

  describe('HeaderInRestoring', () => {
    it('should cancel restoring mode and reopen the editor state', () => {
      const { store } = renderWorkflowComponent(
        <HeaderInRestoring />,
        {
          initialStoreState: {
            isRestoring: true,
            showWorkflowVersionHistoryPanel: true,
          },
          hooksStoreProps: {
            configsMap: {
              flowType: FlowType.appFlow,
              flowId: 'flow-1',
              fileSettings: {},
            },
          },
        },
      )

      fireEvent.click(screen.getByRole('button', { name: 'workflow.common.exitVersions' }))

      expect(mockHandleLoadBackupDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().isRestoring).toBe(false)
      expect(store.getState().showWorkflowVersionHistoryPanel).toBe(false)
    })

    it('should restore the selected version, clear backup state, and forward lifecycle callbacks', async () => {
      const onRestoreSettled = vi.fn()
      const deleteAllInspectVars = vi.fn()
      const currentVersion = createCurrentVersion()

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
          hooksStoreProps: {
            configsMap: {
              flowType: FlowType.appFlow,
              flowId: 'flow-1',
              fileSettings: {},
            },
          },
        },
      )

      fireEvent.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => {
        expect(mockRestoreWorkflow).toHaveBeenCalledWith('/apps/flow-1/workflows/version-1/restore')
        expect(store.getState().showWorkflowVersionHistoryPanel).toBe(false)
        expect(store.getState().isRestoring).toBe(false)
        expect(store.getState().backupDraft).toBeUndefined()
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(1)
        expect(deleteAllInspectVars).toHaveBeenCalledTimes(1)
        expect(mockInvalidAllLastRun).toHaveBeenCalledTimes(1)
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'success',
          message: 'workflow.versionHistory.action.restoreSuccess',
        })
      })
      expect(mockEmitRestoreIntent).toHaveBeenCalledWith({
        versionId: currentVersion.id,
        versionName: currentVersion.marked_name,
        initiatorUserId: '',
        initiatorName: '',
      })
      expect(mockEmitRestoreComplete).toHaveBeenCalledWith({
        versionId: currentVersion.id,
        success: true,
      })
      expect(mockEmitWorkflowUpdate).toHaveBeenCalledWith('flow-1')
      expect(mockResetWorkflowVersionHistory).toHaveBeenCalledTimes(1)
      expect(onRestoreSettled).toHaveBeenCalledTimes(1)
    })

    it('should restore rag pipeline versions without emitting collaboration events', async () => {
      const currentVersion = createCurrentVersion()

      renderWorkflowComponent(
        <HeaderInRestoring />,
        {
          initialStoreState: {
            isRestoring: true,
            showWorkflowVersionHistoryPanel: true,
            backupDraft: createBackupDraft(),
            currentVersion,
          },
          hooksStoreProps: {
            configsMap: {
              flowType: FlowType.ragPipeline,
              flowId: 'pipeline-1',
              fileSettings: {},
            },
          },
        },
      )

      fireEvent.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => {
        expect(mockRestoreWorkflow).toHaveBeenCalledWith('/rag/pipelines/pipeline-1/workflows/version-1/restore')
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(1)
      })
      expect(mockEmitRestoreIntent).not.toHaveBeenCalled()
      expect(mockEmitRestoreComplete).not.toHaveBeenCalled()
      expect(mockEmitWorkflowUpdate).not.toHaveBeenCalled()
    })
  })

  describe('HeaderInHistory', () => {
    it('should render the history trigger with text and return to edit mode', () => {
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

      fireEvent.click(screen.getByRole('button', { name: 'workflow.common.goBackToEdit' }))

      expect(mockHandleLoadBackupDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().historyWorkflowData).toBeUndefined()
      expect(mockViewHistory).toHaveBeenCalledWith(expect.objectContaining({
        withText: true,
      }))
    })
  })
})
