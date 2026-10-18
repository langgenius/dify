import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { ReactElement } from 'react'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { fullWorkflowAccessControl } from '../../../hooks-store/store'
import { WorkflowVersion } from '../../../types'

const mockHandleRestoreFromPublishedWorkflow = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()
const mockHandleRefreshWorkflowDraft = vi.fn()
const mockHandleExportDSL = vi.fn()
const mockRestoreWorkflow = vi.fn()
const mockUpdateWorkflow = vi.fn()
const mockInvalidateAppWorkflow = vi.fn()
const mockEmitRestoreIntent = vi.fn()
const mockEmitRestoreComplete = vi.fn()
const mockEmitWorkflowUpdate = vi.fn()
const mockFetchNextPage = vi.fn()
const mockToast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))
let mockPlanType: CloudPlan = 'professional'
let deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'CLOUD'
let mockPublishedEnvironments: FetchWorkflowDraftResponse['environments']
let mockHasNextPage = false
let mockIsFetching = false

const createVersionHistory = (
  overrides: Partial<FetchWorkflowDraftResponse> = {},
): FetchWorkflowDraftResponse => ({
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

let mockCurrentVersion: FetchWorkflowDraftResponse | null = null

vi.mock('@/app/notifications', () => ({ toast: mockToast }))

vi.mock('@/service/use-workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-workflow')>()),
  useDeleteWorkflow: () => ({ mutateAsync: vi.fn() }),
  useInvalidateAppWorkflow: () => mockInvalidateAppWorkflow,
  useInvalidateAllLastRun: () => vi.fn(),
  useResetWorkflowVersionHistory: () => vi.fn(),
  useRestoreWorkflow: () => ({ mutateAsync: mockRestoreWorkflow }),
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

vi.mock('../../../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    emitRestoreIntent: mockEmitRestoreIntent,
    emitRestoreComplete: mockEmitRestoreComplete,
    emitWorkflowUpdate: mockEmitWorkflowUpdate,
  },
}))

vi.mock('@/app/components/app/app-publisher/version-info-modal', () => ({
  default: ({
    versionInfo,
    onPublish,
  }: {
    versionInfo: FetchWorkflowDraftResponse
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

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  patch: (...args: unknown[]) => mockUpdateWorkflow(...args),
}))

let renderedStore: ReturnType<typeof renderWorkflowComponent>['store']

const selectAction = async (name: RegExp) => {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  await user.click(await screen.findByRole('menuitem', { name }))
}

describe('VersionHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRestoreWorkflow.mockResolvedValue(undefined)
    mockUpdateWorkflow.mockResolvedValue(undefined)
    mockCurrentVersion = null
    mockPlanType = 'professional'
    deploymentEdition = 'CLOUD'
    mockPublishedEnvironments = undefined
    mockHasNextPage = false
    mockIsFetching = false
  })

  it('should expose close and pagination actions as accessible buttons', async () => {
    const user = userEvent.setup()
    mockHasNextPage = true
    const { VersionHistoryPanel } = await import('../index')

    render(<VersionHistoryPanel latestVersionId="published-version-id" />)

    await user.click(screen.getByRole('button', { name: 'workflow.common.loadMore' }))
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(mockHandleLoadBackupDraft).toHaveBeenCalled()
    })
    vi.clearAllMocks()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(mockHandleLoadBackupDraft).toHaveBeenCalledTimes(1)
    expect(renderedStore.getState().isRestoring).toBe(false)
    expect(renderedStore.getState().showWorkflowVersionHistoryPanel).toBe(false)
  })

  describe('Version Click Behavior', () => {
    it('should call handleLoadBackupDraft when draft version is selected on mount', async () => {
      const { VersionHistoryPanel } = await import('../index')

      render(<VersionHistoryPanel latestVersionId="published-version-id" />)

      expect(mockHandleLoadBackupDraft).toHaveBeenCalled()
      expect(mockHandleRestoreFromPublishedWorkflow).not.toHaveBeenCalled()
    })

    it('should call handleRestoreFromPublishedWorkflow when clicking published version', async () => {
      const user = userEvent.setup()
      const { VersionHistoryPanel } = await import('../index')

      render(<VersionHistoryPanel latestVersionId="published-version-id" />)

      vi.clearAllMocks()

      await user.click(screen.getByRole('button', { name: 'v1.0' }))

      expect(mockHandleRestoreFromPublishedWorkflow).toHaveBeenCalled()
      expect(mockHandleLoadBackupDraft).not.toHaveBeenCalled()
    })
  })

  it('should set current version before confirming restore from context menu', async () => {
    const user = userEvent.setup()
    const { VersionHistoryPanel } = await import('../index')

    render(<VersionHistoryPanel latestVersionId="published-version-id" />)

    await waitFor(() => {
      expect(mockHandleLoadBackupDraft).toHaveBeenCalled()
    })
    vi.clearAllMocks()

    await selectAction(/common\.restore/)
    await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

    await waitFor(() => {
      expect(renderedStore.getState().currentVersion?.id).toBe('published-version-id')
      expect(mockRestoreWorkflow).toHaveBeenCalledWith('published-version-id')
      expect(renderedStore.getState().isRestoring).toBe(false)
      expect(renderedStore.getState().backupDraft).toBeUndefined()
      expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalled()
    })
  })

  it('should show plan upgrade modal instead of restore confirmation for sandbox users', async () => {
    const { VersionHistoryPanel } = await import('../index')
    mockPlanType = 'sandbox'

    render(<VersionHistoryPanel latestVersionId="published-version-id" />)

    vi.clearAllMocks()

    await selectAction(/common\.restore/)

    expect(screen.getByText('billing.upgrade.workflowRestore.title')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockRestoreWorkflow).not.toHaveBeenCalled()
  })

  it('should show plan upgrade modal instead of exporting DSL for sandbox users', async () => {
    const { VersionHistoryPanel } = await import('../index')
    mockPlanType = 'sandbox'

    render(<VersionHistoryPanel latestVersionId="published-version-id" />)

    vi.clearAllMocks()

    await selectAction(/exportApp/)

    expect(screen.getByText('billing.upgrade.workflowRestore.title')).toBeInTheDocument()
    expect(mockHandleExportDSL).not.toHaveBeenCalled()
  })

  it('should block deleting a version deployed to an environment', async () => {
    mockPublishedEnvironments = [{ id: 'environment-id', name: 'Production' }]
    const { VersionHistoryPanel } = await import('../index')

    render(<VersionHistoryPanel latestVersionId="newer-version-id" />)

    await selectAction(/operation\.delete/)

    expect(mockToast.error).toHaveBeenCalledWith(
      'workflowHistory.versionHistory.action.deleteDeployedVersionError',
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('should allow deleting a version that is not deployed', async () => {
    const { VersionHistoryPanel } = await import('../index')

    render(<VersionHistoryPanel latestVersionId="newer-version-id" />)

    await selectAction(/operation\.delete/)

    expect(
      screen.getByRole('alertdialog', { name: 'common.operation.delete v1.0' }),
    ).toBeInTheDocument()
    expect(mockToast.error).not.toHaveBeenCalled()
  })

  it('should keep restore mode backup state when restore request fails', async () => {
    const user = userEvent.setup()
    const { VersionHistoryPanel } = await import('../index')
    mockCurrentVersion = createVersionHistory({
      id: 'draft-version-id',
      version: WorkflowVersion.Draft,
    })

    render(<VersionHistoryPanel latestVersionId="published-version-id" />)

    vi.clearAllMocks()
    mockRestoreWorkflow.mockRejectedValueOnce(new Error('restore failed'))

    await selectAction(/common\.restore/)
    await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

    await waitFor(() => {
      expect(mockEmitRestoreComplete).toHaveBeenCalledWith({
        versionId: 'published-version-id',
        success: false,
        error: 'restore failed',
      })
    })

    expect(renderedStore.getState().isRestoring).toBe(true)
    expect(renderedStore.getState().backupDraft).toBeDefined()
    expect(renderedStore.getState().currentVersion?.id).toBe('draft-version-id')
    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should refresh the published workflow after editing the latest app version', async () => {
    const user = userEvent.setup()
    mockUpdateWorkflow.mockResolvedValue({
      id: 'published-version-id',
      marked_name: 'Updated release',
      marked_comment: 'Updated notes',
    })
    const { VersionHistoryPanel } = await import('../index')

    render(
      <VersionHistoryPanel
        latestVersionId="published-version-id"
        updateVersionUrl={(versionId) => `/apps/app-1/workflows/${versionId}`}
      />,
    )

    await selectAction(/editVersionInfo/)
    await user.click(screen.getByRole('button', { name: 'submit version info' }))

    await waitFor(() => {
      expect(mockUpdateWorkflow).toHaveBeenCalledWith(
        '/apps/app-1/workflows/published-version-id',
        { body: { marked_name: 'Updated release', marked_comment: 'Updated notes' } },
      )
      expect(mockInvalidateAppWorkflow).toHaveBeenCalledWith('app-1')
    })
  })
})

function render(ui: ReactElement) {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: deploymentEdition },
    features: { billing: { subscription: { plan: mockPlanType } } },
  })
  const rendered = renderWorkflowComponent(<NuqsTestingAdapter>{ui}</NuqsTestingAdapter>, {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    hooksStoreProps: { accessControl: fullWorkflowAccessControl },
    initialStoreState: {
      currentVersion: mockCurrentVersion,
      isRestoring: true,
      backupDraft: {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        environmentVariables: [],
      },
      showWorkflowVersionHistoryPanel: true,
    },
  })
  renderedStore = rendered.store
  return rendered
}
