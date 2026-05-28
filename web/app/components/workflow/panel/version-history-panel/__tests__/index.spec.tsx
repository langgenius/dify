import type { Shape } from '../../../store'
import type { VersionHistory } from '@/types/workflow'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { VersionHistoryContextMenuOptions, WorkflowVersion } from '../../../types'

const mockHandleRestoreFromPublishedWorkflow = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()
const mockHandleRefreshWorkflowDraft = vi.fn()
const mockRestoreWorkflow = vi.fn()
const mockSetCurrentVersion = vi.fn()
const mockSetShowWorkflowVersionHistoryPanel = vi.fn()
const mockWorkflowStoreSetState = vi.fn()

const createVersionHistory = (overrides: Partial<VersionHistory> = {}): VersionHistory => ({
  id: 'version-id',
  version: WorkflowVersion.Draft,
  graph: { nodes: [], edges: [] },
  features: {
    opening_statement: '',
    suggested_questions: [],
    suggested_questions_after_answer: { enabled: false },
    text_to_speech: { enabled: false },
    speech_to_text: { enabled: false },
    retriever_resource: { enabled: false },
    sensitive_word_avoidance: { enabled: false },
    file_upload: { image: { enabled: false } },
  },
  created_at: Date.now() / 1000,
  created_by: { id: 'user-1', name: 'User 1', email: 'user-1@example.com' },
  hash: 'test-hash',
  updated_at: Date.now() / 1000,
  updated_by: { id: 'user-1', name: 'User 1', email: 'user-1@example.com' },
  tool_published: false,
  environment_variables: [],
  marked_name: '',
  marked_comment: '',
  ...overrides,
})

let mockCurrentVersion: VersionHistory | null = null

type MockVersionStoreState = Pick<Shape, 'currentVersion' | 'setCurrentVersion' | 'setShowWorkflowVersionHistoryPanel'>
type MockRestoreConfirmModalProps = {
  isOpen: boolean
  versionInfo: VersionHistory
  onRestore: (item: VersionHistory) => void
}
type MockVersionHistoryItemProps = {
  item: VersionHistory
  onClick: (item: VersionHistory) => void
  handleClickActionMenuItem: (operation: VersionHistoryContextMenuOptions) => void
}

vi.mock('@/context/app-context', () => ({
  useSelector: () => ({ id: 'test-user-id' }),
}))

vi.mock('@/service/use-workflow', () => ({
  useDeleteWorkflow: () => ({ mutateAsync: vi.fn() }),
  useInvalidAllLastRun: () => vi.fn(),
  useResetWorkflowVersionHistory: () => vi.fn(),
  useRestoreWorkflow: () => ({ mutateAsync: mockRestoreWorkflow }),
  useUpdateWorkflow: () => ({ mutateAsync: vi.fn() }),
  useWorkflowVersionHistory: () => ({
    data: {
      pages: [
        {
          items: [
            createVersionHistory({
              id: 'draft-version-id',
              version: WorkflowVersion.Draft,
            }),
            createVersionHistory({
              id: 'published-version-id',
              version: '2024-01-01T00:00:00Z',
              marked_name: 'v1.0',
              marked_comment: 'First release',
            }),
          ],
        },
      ],
    },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetching: false,
  }),
}))

vi.mock('../../../hooks', () => ({
  useDSL: () => ({ handleExportDSL: vi.fn() }),
  useWorkflowRefreshDraft: () => ({ handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft }),
  useWorkflowRun: () => ({
    handleRestoreFromPublishedWorkflow: mockHandleRestoreFromPublishedWorkflow,
    handleLoadBackupDraft: mockHandleLoadBackupDraft,
  }),
}))

vi.mock('../../../hooks-store', () => ({
  useHooksStore: () => ({
    flowId: 'test-flow-id',
    flowType: 'workflow',
  }),
}))

vi.mock('../../../store', () => ({
  useStore: <T,>(selector: (state: MockVersionStoreState) => T) => {
    const state: MockVersionStoreState = {
      setShowWorkflowVersionHistoryPanel: mockSetShowWorkflowVersionHistoryPanel,
      currentVersion: mockCurrentVersion,
      setCurrentVersion: mockSetCurrentVersion,
    }
    return selector(state)
  },
  useWorkflowStore: () => ({
    getState: () => ({
      deleteAllInspectVars: vi.fn(),
      setShowWorkflowVersionHistoryPanel: mockSetShowWorkflowVersionHistoryPanel,
      setCurrentVersion: mockSetCurrentVersion,
    }),
    setState: mockWorkflowStoreSetState,
  }),
}))

vi.mock('../delete-confirm-modal', () => ({
  default: () => null,
}))

vi.mock('../restore-confirm-modal', () => ({
  default: (props: MockRestoreConfirmModalProps) => {
    const MockRestoreConfirmModal = () => {
      const { isOpen, versionInfo, onRestore } = props

      if (!isOpen)
        return null

      return <button onClick={() => onRestore(versionInfo)}>confirm restore</button>
    }

    return <MockRestoreConfirmModal />
  },
}))

vi.mock('@/app/components/app/app-publisher/version-info-modal', () => ({
  default: () => null,
}))

vi.mock('../version-history-item', () => ({
  default: (props: MockVersionHistoryItemProps) => {
    const MockVersionHistoryItem = () => {
      const { item, onClick, handleClickActionMenuItem } = props

      useEffect(() => {
        if (item.version === WorkflowVersion.Draft)
          onClick(item)
      }, [item, onClick])

      return (
        <div>
          <button onClick={() => onClick(item)}>{item.marked_name || item.version}</button>
          {item.version !== WorkflowVersion.Draft && (
            <button onClick={() => handleClickActionMenuItem(VersionHistoryContextMenuOptions.restore)}>
              {`restore-${item.id}`}
            </button>
          )}
        </div>
      )
    }

    return <MockVersionHistoryItem />
  },
}))

describe('VersionHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCurrentVersion = null
  })

  describe('Version Click Behavior', () => {
    it('should call handleLoadBackupDraft when draft version is selected on mount', async () => {
      const { VersionHistoryPanel } = await import('../index')

      render(
        <VersionHistoryPanel
          latestVersionId="published-version-id"
          restoreVersionUrl={versionId => `/apps/app-1/workflows/${versionId}/restore`}
        />,
      )

      expect(mockHandleLoadBackupDraft).toHaveBeenCalled()
      expect(mockHandleRestoreFromPublishedWorkflow).not.toHaveBeenCalled()
    })

    it('should call handleRestoreFromPublishedWorkflow when clicking published version', async () => {
      const { VersionHistoryPanel } = await import('../index')

      render(
        <VersionHistoryPanel
          latestVersionId="published-version-id"
          restoreVersionUrl={versionId => `/apps/app-1/workflows/${versionId}/restore`}
        />,
      )

      vi.clearAllMocks()

      fireEvent.click(screen.getByText('v1.0'))

      expect(mockHandleRestoreFromPublishedWorkflow).toHaveBeenCalled()
      expect(mockHandleLoadBackupDraft).not.toHaveBeenCalled()
    })
  })

  it('should set current version before confirming restore from context menu', async () => {
    const { VersionHistoryPanel } = await import('../index')

    render(
      <VersionHistoryPanel
        latestVersionId="published-version-id"
        restoreVersionUrl={versionId => `/apps/app-1/workflows/${versionId}/restore`}
      />,
    )

    vi.clearAllMocks()

    fireEvent.click(screen.getByText('restore-published-version-id'))
    fireEvent.click(screen.getByText('confirm restore'))

    await waitFor(() => {
      expect(mockSetCurrentVersion).toHaveBeenCalledWith(expect.objectContaining({
        id: 'published-version-id',
      }))
      expect(mockRestoreWorkflow).toHaveBeenCalledWith('/apps/app-1/workflows/published-version-id/restore')
      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ isRestoring: false })
      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ backupDraft: undefined })
      expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalled()
    })
  })

  it('should keep restore mode backup state when restore request fails', async () => {
    const { VersionHistoryPanel } = await import('../index')
    mockRestoreWorkflow.mockRejectedValueOnce(new Error('restore failed'))
    mockCurrentVersion = createVersionHistory({
      id: 'draft-version-id',
      version: WorkflowVersion.Draft,
    })

    render(
      <VersionHistoryPanel
        latestVersionId="published-version-id"
        restoreVersionUrl={versionId => `/apps/app-1/workflows/${versionId}/restore`}
      />,
    )

    vi.clearAllMocks()

    fireEvent.click(screen.getByText('restore-published-version-id'))
    fireEvent.click(screen.getByText('confirm restore'))

    await waitFor(() => {
      expect(mockRestoreWorkflow).toHaveBeenCalledWith('/apps/app-1/workflows/published-version-id/restore')
    })

    expect(mockWorkflowStoreSetState).not.toHaveBeenCalledWith({ isRestoring: false })
    expect(mockWorkflowStoreSetState).not.toHaveBeenCalledWith({ backupDraft: undefined })
    expect(mockSetCurrentVersion).not.toHaveBeenCalled()
    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
  })
})
