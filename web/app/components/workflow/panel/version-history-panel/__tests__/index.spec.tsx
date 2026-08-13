import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { Shape } from '../../../store'
import type { VersionHistory } from '@/types/workflow'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { VersionHistoryContextMenuOptions, WorkflowVersion } from '../../../types'

const mockHandleRestoreFromPublishedWorkflow = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()
const mockHandleRefreshWorkflowDraft = vi.fn()
const mockHandleExportDSL = vi.fn()
const mockRestoreWorkflow = vi.fn()
const mockUpdateWorkflow = vi.fn()
const mockInvalidateAppWorkflow = vi.fn()
const mockSetCurrentVersion = vi.fn()
const mockSetShowWorkflowVersionHistoryPanel = vi.fn()
const mockWorkflowStoreSetState = vi.fn()
const mockEmitRestoreIntent = vi.fn()
const mockEmitRestoreComplete = vi.fn()
const mockEmitWorkflowUpdate = vi.fn()
const mockFetchNextPage = vi.fn()
const mockToast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))
let mockPlanType: CloudPlan = 'professional'
let mockEnableBilling = true
let mockPublishedEnvironments: VersionHistory['environments']
let mockHasNextPage = false
let mockIsFetching = false

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

type MockVersionStoreState = Pick<
  Shape,
  'currentVersion' | 'setCurrentVersion' | 'setShowWorkflowVersionHistoryPanel'
>
type MockRestoreConfirmModalProps = {
  isOpen: boolean
  versionInfo: VersionHistory
  onRestore: (item: VersionHistory) => void
}
type MockDeleteConfirmModalProps = {
  isOpen: boolean
}
type MockVersionHistoryItemProps = {
  item: VersionHistory
  onClick: (item: VersionHistory) => void
  handleClickActionMenuItem: (operation: VersionHistoryContextMenuOptions) => void
}

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: { type: mockPlanType },
    enableBilling: mockEnableBilling,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({ toast: mockToast }))

vi.mock('@/service/use-workflow', () => ({
  useDeleteWorkflow: () => ({ mutateAsync: vi.fn() }),
  useInvalidateAppWorkflow: () => mockInvalidateAppWorkflow,
  useInvalidAllLastRun: () => vi.fn(),
  useResetWorkflowVersionHistory: () => vi.fn(),
  useRestoreWorkflow: () => ({ mutateAsync: mockRestoreWorkflow }),
  useUpdateWorkflow: () => ({ mutateAsync: mockUpdateWorkflow }),
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
              environments: mockPublishedEnvironments,
            }),
          ],
        },
      ],
    },
    fetchNextPage: mockFetchNextPage,
    hasNextPage: mockHasNextPage,
    isFetching: mockIsFetching,
  }),
}))

vi.mock('../../../hooks/use-DSL', () => ({
  useDSL: () => ({ handleExportDSL: mockHandleExportDSL }),
}))

vi.mock('../../../hooks/use-workflow-refresh-draft', () => ({
  useWorkflowRefreshDraft: () => ({ handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft }),
}))

vi.mock('../../../hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({
    handleRestoreFromPublishedWorkflow: mockHandleRestoreFromPublishedWorkflow,
    handleLoadBackupDraft: mockHandleLoadBackupDraft,
  }),
}))

vi.mock('../../../hooks-store', () => ({
  useHooksStore: (
    selector: (state: {
      accessControl: { canImportExportDSL: boolean }
      configsMap: { flowId: string; flowType: string }
    }) => unknown,
  ) =>
    selector({
      accessControl: { canImportExportDSL: true },
      configsMap: {
        flowId: 'app-1',
        flowType: 'appFlow',
      },
    }),
}))

vi.mock('../../../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    emitRestoreIntent: mockEmitRestoreIntent,
    emitRestoreComplete: mockEmitRestoreComplete,
    emitWorkflowUpdate: mockEmitWorkflowUpdate,
  },
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
  default: ({ isOpen }: MockDeleteConfirmModalProps) => (isOpen ? <div>confirm delete</div> : null),
}))

vi.mock('../restore-confirm-modal', () => ({
  default: (props: MockRestoreConfirmModalProps) => {
    const MockRestoreConfirmModal = () => {
      const { isOpen, versionInfo, onRestore } = props

      if (!isOpen) return null

      return (
        <button type="button" onClick={() => onRestore(versionInfo)}>
          confirm restore
        </button>
      )
    }

    return <MockRestoreConfirmModal />
  },
}))

vi.mock('@/app/components/app/app-publisher/version-info-modal', () => ({
  default: ({
    versionInfo,
    onPublish,
  }: {
    versionInfo: VersionHistory
    onPublish: (params: { id?: string; title: string; releaseNotes: string }) => Promise<void>
  }) => (
    <button
      type="button"
      onClick={() =>
        onPublish({
          id: versionInfo.id,
          title: 'Updated release',
          releaseNotes: 'Updated notes',
        })
      }
    >
      submit version info
    </button>
  ),
}))

vi.mock('../version-history-item', () => ({
  default: (props: MockVersionHistoryItemProps) => {
    const MockVersionHistoryItem = () => {
      const { item, onClick, handleClickActionMenuItem } = props
      const didSelectDraftRef = useRef(false)

      useEffect(() => {
        if (item.version === WorkflowVersion.Draft && !didSelectDraftRef.current) {
          didSelectDraftRef.current = true
          onClick(item)
        }
      }, [item, onClick])

      return (
        <div>
          <button type="button" onClick={() => onClick(item)}>
            {item.marked_name || item.version}
          </button>
          {item.version !== WorkflowVersion.Draft && (
            <>
              <button
                type="button"
                onClick={() => handleClickActionMenuItem(VersionHistoryContextMenuOptions.restore)}
              >
                {`restore-${item.id}`}
              </button>
              <button
                type="button"
                onClick={() =>
                  handleClickActionMenuItem(VersionHistoryContextMenuOptions.exportDSL)
                }
              >
                {`export-${item.id}`}
              </button>
              <button
                type="button"
                onClick={() => handleClickActionMenuItem(VersionHistoryContextMenuOptions.edit)}
              >
                {`edit-${item.id}`}
              </button>
              <button
                type="button"
                onClick={() => handleClickActionMenuItem(VersionHistoryContextMenuOptions.delete)}
              >
                {`delete-${item.id}`}
              </button>
            </>
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
    mockRestoreWorkflow.mockResolvedValue(undefined)
    mockUpdateWorkflow.mockResolvedValue(undefined)
    mockCurrentVersion = null
    mockPlanType = 'professional'
    mockEnableBilling = true
    mockPublishedEnvironments = undefined
    mockHasNextPage = false
    mockIsFetching = false
  })

  it('should expose close and pagination actions as accessible buttons', async () => {
    const user = userEvent.setup()
    mockHasNextPage = true
    const { VersionHistoryPanel } = await import('../index')

    render(
      <VersionHistoryPanel
        latestVersionId="published-version-id"
        restoreVersionUrl={(versionId) => `/apps/app-1/workflows/${versionId}/restore`}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'workflow.common.loadMore' }))
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(mockHandleLoadBackupDraft).toHaveBeenCalled()
    })
    vi.clearAllMocks()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(mockHandleLoadBackupDraft).toHaveBeenCalledTimes(1)
    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ isRestoring: false })
    expect(mockSetShowWorkflowVersionHistoryPanel).toHaveBeenCalledWith(false)
  })

  describe('Version Click Behavior', () => {
    it('should call handleLoadBackupDraft when draft version is selected on mount', async () => {
      const { VersionHistoryPanel } = await import('../index')

      render(
        <VersionHistoryPanel
          latestVersionId="published-version-id"
          restoreVersionUrl={(versionId) => `/apps/app-1/workflows/${versionId}/restore`}
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
          restoreVersionUrl={(versionId) => `/apps/app-1/workflows/${versionId}/restore`}
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
        restoreVersionUrl={(versionId) => `/apps/app-1/workflows/${versionId}/restore`}
      />,
    )

    await waitFor(() => {
      expect(mockHandleLoadBackupDraft).toHaveBeenCalled()
    })
    vi.clearAllMocks()

    fireEvent.click(screen.getByText('restore-published-version-id'))
    fireEvent.click(screen.getByText('confirm restore'))

    await waitFor(() => {
      expect(mockSetCurrentVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'published-version-id',
        }),
      )
      expect(mockRestoreWorkflow).toHaveBeenCalledWith(
        '/apps/app-1/workflows/published-version-id/restore',
      )
      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ isRestoring: false })
      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ backupDraft: undefined })
      expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalled()
    })
  })

  it('should show plan upgrade modal instead of restore confirmation for sandbox users', async () => {
    const { VersionHistoryPanel } = await import('../index')
    mockPlanType = 'sandbox'

    render(
      <VersionHistoryPanel
        latestVersionId="published-version-id"
        restoreVersionUrl={(versionId) => `/apps/app-1/workflows/${versionId}/restore`}
      />,
    )

    vi.clearAllMocks()

    fireEvent.click(screen.getByText('restore-published-version-id'))

    expect(screen.getByText('billing.upgrade.workflowRestore.title')).toBeInTheDocument()
    expect(screen.queryByText('confirm restore')).not.toBeInTheDocument()
    expect(mockRestoreWorkflow).not.toHaveBeenCalled()
  })

  it('should show plan upgrade modal instead of exporting DSL for sandbox users', async () => {
    const { VersionHistoryPanel } = await import('../index')
    mockPlanType = 'sandbox'

    render(
      <VersionHistoryPanel
        latestVersionId="published-version-id"
        restoreVersionUrl={(versionId) => `/apps/app-1/workflows/${versionId}/restore`}
      />,
    )

    vi.clearAllMocks()

    fireEvent.click(screen.getByText('export-published-version-id'))

    expect(screen.getByText('billing.upgrade.workflowRestore.title')).toBeInTheDocument()
    expect(mockHandleExportDSL).not.toHaveBeenCalled()
  })

  it('should block deleting a version deployed to an environment', async () => {
    mockPublishedEnvironments = [{ id: 'environment-id', name: 'Production' }]
    const { VersionHistoryPanel } = await import('../index')

    render(
      <VersionHistoryPanel
        latestVersionId="published-version-id"
        restoreVersionUrl={(versionId) => `/apps/app-1/workflows/${versionId}/restore`}
      />,
    )

    fireEvent.click(screen.getByText('delete-published-version-id'))

    expect(mockToast.error).toHaveBeenCalledWith(
      'workflow.versionHistory.action.deleteDeployedVersionError',
    )
    expect(screen.queryByText('confirm delete')).not.toBeInTheDocument()
  })

  it('should allow deleting a version that is not deployed', async () => {
    const { VersionHistoryPanel } = await import('../index')

    render(
      <VersionHistoryPanel
        latestVersionId="published-version-id"
        restoreVersionUrl={(versionId) => `/apps/app-1/workflows/${versionId}/restore`}
      />,
    )

    fireEvent.click(screen.getByText('delete-published-version-id'))

    expect(screen.getByText('confirm delete')).toBeInTheDocument()
    expect(mockToast.error).not.toHaveBeenCalled()
  })

  it('should keep restore mode backup state when restore request fails', async () => {
    const { VersionHistoryPanel } = await import('../index')
    mockCurrentVersion = createVersionHistory({
      id: 'draft-version-id',
      version: WorkflowVersion.Draft,
    })

    render(
      <VersionHistoryPanel
        latestVersionId="published-version-id"
        restoreVersionUrl={(versionId) => `/apps/app-1/workflows/${versionId}/restore`}
      />,
    )

    vi.clearAllMocks()
    mockRestoreWorkflow.mockRejectedValueOnce(new Error('restore failed'))

    fireEvent.click(screen.getByText('restore-published-version-id'))
    fireEvent.click(screen.getByText('confirm restore'))

    await waitFor(() => {
      expect(mockRestoreWorkflow).toHaveBeenCalledWith(
        '/apps/app-1/workflows/published-version-id/restore',
      )
    })

    expect(mockWorkflowStoreSetState).not.toHaveBeenCalledWith({ isRestoring: false })
    expect(mockWorkflowStoreSetState).not.toHaveBeenCalledWith({ backupDraft: undefined })
    expect(mockSetCurrentVersion).not.toHaveBeenCalled()
    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should refresh the published workflow after editing the latest app version', async () => {
    mockUpdateWorkflow.mockImplementation(
      async (
        _params,
        options?: {
          onSuccess?: () => void
          onSettled?: () => void
        },
      ) => {
        options?.onSuccess?.()
        options?.onSettled?.()
      },
    )
    const { VersionHistoryPanel } = await import('../index')

    render(
      <VersionHistoryPanel
        latestVersionId="published-version-id"
        restoreVersionUrl={(versionId) => `/apps/app-1/workflows/${versionId}/restore`}
        updateVersionUrl={(versionId) => `/apps/app-1/workflows/${versionId}`}
      />,
    )

    fireEvent.click(screen.getByText('edit-published-version-id'))
    fireEvent.click(screen.getByRole('button', { name: 'submit version info' }))

    await waitFor(() => {
      expect(mockInvalidateAppWorkflow).toHaveBeenCalledWith('app-1')
    })
  })
})
