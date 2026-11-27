import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { WorkflowVersionListItem } from '@/service/workflow-queries'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { appWorkflowQueryOptions } from '@/service/workflow-queries'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { fullWorkflowAccessControl } from '../../../hooks-store/store'
import { WorkflowVersion } from '../../../types'

const mockHandleRestoreFromPublishedWorkflow = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()
const mockHandleRefreshWorkflowDraft = vi.fn()
const mockHandleExportDSL = vi.fn()
const mockRestoreWorkflow = vi.hoisted(() => vi.fn())
const mockDeleteWorkflow = vi.hoisted(() => vi.fn())
const mockUpdateWorkflow = vi.hoisted(() => vi.fn())
const mockFetchVersions = vi.hoisted(() => vi.fn())
const mockEmitRestoreIntent = vi.fn()
const mockEmitRestoreComplete = vi.fn()
const mockEmitWorkflowUpdate = vi.fn()
const mockToast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))
let mockPlanType: CloudPlan = 'professional'
let deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'CLOUD'
let mockPublishedEnvironments: WorkflowVersionListItem['environments']
let mockHasNextPage = false

const createVersionHistory = ({
  environments,
  ...overrides
}: Partial<WorkflowResponse> & Pick<WorkflowVersionListItem, 'environments'> = {}) => ({
  ...createWorkflowResponseFixture({
    id: 'version-id',
    version: WorkflowVersion.Draft,
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
    created_at: Math.floor(Date.now() / 1000),
    created_by: { id: 'user-1', name: 'User 1', email: 'user-1@example.com' },
    hash: 'test-hash',
    updated_at: Math.floor(Date.now() / 1000),
    updated_by: { id: 'user-1', name: 'User 1', email: 'user-1@example.com' },
    ...overrides,
  }),
  environments,
})

let mockCurrentVersion: WorkflowVersionListItem | null = null

vi.mock('@/app/notifications', () => ({ toast: mockToast }))

// boundary: version history API responses
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.get': mockFetchVersions,
      'apps.byAppId.workflows.byWorkflowId.patch': mockUpdateWorkflow,
      'apps.byAppId.workflows.byWorkflowId.delete': mockDeleteWorkflow,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.byWorkflowId.restore.post': mockRestoreWorkflow,
    }),
  }
})

const createVersionPage = (page: number, namedOnly = false) => ({
  items: (page === 1
    ? [
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
      ]
    : []
  ).filter((item) => !namedOnly || item.marked_name),
  page,
  limit: 10,
  has_more: page === 1 && mockHasNextPage,
})

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
    versionInfo: Pick<WorkflowResponse, 'id'>
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

let renderedStore: ReturnType<typeof renderWorkflowComponent>['store']

const selectAction = async (name: RegExp) => {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'common.operation.more' }))
  await user.click(await screen.findByRole('menuitem', { name }))
}

describe('VersionHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Like the API, the named-only list leaves out every version without a name, the draft included.
    mockFetchVersions.mockImplementation(
      async (input: { query: { page: number; named_only?: boolean } }) =>
        createVersionPage(input.query.page, input.query.named_only),
    )
    mockDeleteWorkflow.mockResolvedValue(undefined)
    mockRestoreWorkflow.mockResolvedValue(createWorkflowResponseFixture())
    mockUpdateWorkflow.mockResolvedValue(createWorkflowResponseFixture())
    mockCurrentVersion = null
    mockPlanType = 'professional'
    deploymentEdition = 'CLOUD'
    mockPublishedEnvironments = undefined
    mockHasNextPage = false
  })

  it('should expose close and pagination actions as accessible buttons', async () => {
    const user = userEvent.setup()
    mockHasNextPage = true
    const { VersionHistoryPanel } = await import('../index')

    render(<VersionHistoryPanel latestVersionId="published-version-id" />)

    await user.click(await screen.findByRole('button', { name: 'workflow.common.loadMore' }))
    await waitFor(() =>
      expect(mockFetchVersions).toHaveBeenLastCalledWith({
        params: { app_id: 'app-1' },
        query: { limit: 10, user_id: undefined, named_only: false, page: 2 },
      }),
    )

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

      await waitFor(() => expect(mockHandleLoadBackupDraft).toHaveBeenCalled())
      expect(mockHandleRestoreFromPublishedWorkflow).not.toHaveBeenCalled()
    })

    it('should call handleRestoreFromPublishedWorkflow when clicking published version', async () => {
      const user = userEvent.setup()
      const { VersionHistoryPanel } = await import('../index')

      render(<VersionHistoryPanel latestVersionId="published-version-id" />)

      const publishedVersion = await screen.findByRole('button', { name: 'v1.0' })
      vi.clearAllMocks()

      await user.click(publishedVersion)

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
      expect(mockRestoreWorkflow).toHaveBeenCalledWith({
        params: { app_id: 'app-1', workflow_id: 'published-version-id' },
      })
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

  it.each([false, true])('handles version deletion (failed: %s)', async (failed) => {
    const user = userEvent.setup()
    if (failed) mockDeleteWorkflow.mockRejectedValueOnce(new Error('Delete failed'))
    const { VersionHistoryPanel } = await import('../index')
    render(<VersionHistoryPanel latestVersionId="newer-version-id" />)
    await selectAction(/operation\.delete/)
    // The list refresh after a delete never settles, so the dialog must not wait for it.
    if (!failed) mockFetchVersions.mockImplementationOnce(() => new Promise(() => {}))
    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    await waitFor(() =>
      expect(mockDeleteWorkflow).toHaveBeenCalledWith({
        params: { app_id: 'app-1', workflow_id: 'published-version-id' },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    if (failed) {
      expect(mockToast.error).toHaveBeenCalledWith('Delete failed')
      expect(mockFetchVersions).toHaveBeenCalledOnce()
    } else {
      expect(mockToast.error).not.toHaveBeenCalled()
      // A successful delete refreshes the loaded page once, without a second reset fetch.
      expect(mockFetchVersions).toHaveBeenCalledTimes(2)
    }
  })

  it('returns to the draft and drops the version when the previewed version is deleted', async () => {
    const user = userEvent.setup()
    const { VersionHistoryPanel } = await import('../index')
    render(<VersionHistoryPanel latestVersionId="newer-version-id" />)
    await user.click(await screen.findByRole('button', { name: 'v1.0' }))
    await waitFor(() =>
      expect(renderedStore.getState().currentVersion?.id).toBe('published-version-id'),
    )
    // Even when the list refresh after the delete fails, the deleted version must not come back.
    mockFetchVersions.mockRejectedValue(new Error('refresh failed'))

    await selectAction(/operation\.delete/)
    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() =>
      expect(renderedStore.getState().currentVersion?.id).toBe('draft-version-id'),
    )
    await waitFor(() => expect(screen.queryByText('v1.0')).not.toBeInTheDocument())
  })

  it('returns to the draft after deleting the previewed version while only named versions are shown', async () => {
    const user = userEvent.setup()
    const { VersionHistoryPanel } = await import('../index')
    render(<VersionHistoryPanel latestVersionId="newer-version-id" />)
    await user.click(await screen.findByRole('button', { name: 'v1.0' }))
    const filterTrigger = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-haspopup') === 'dialog')
    if (!filterTrigger) throw new Error('filter trigger not found')
    await user.click(filterTrigger)
    await user.click(await screen.findByRole('switch'))
    await waitFor(() =>
      expect(
        screen.queryByText('workflowHistory.versionHistory.currentDraft'),
      ).not.toBeInTheDocument(),
    )

    await selectAction(/operation\.delete/)
    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() =>
      expect(renderedStore.getState().currentVersion?.id).toBe('draft-version-id'),
    )
  })

  it('keeps the draft backup for the whole history session and clears it on close', async () => {
    const user = userEvent.setup()
    // Like the editors' handler: loading the backup clears it.
    mockHandleLoadBackupDraft.mockImplementation(() =>
      renderedStore.setState({ backupDraft: undefined }),
    )
    const { VersionHistoryPanel } = await import('../index')
    render(<VersionHistoryPanel latestVersionId="newer-version-id" />)
    // The draft row is selected when the panel opens.
    await waitFor(() => expect(mockHandleLoadBackupDraft).toHaveBeenCalledOnce())
    expect(renderedStore.getState().backupDraft).toBeDefined()

    await user.click(await screen.findByRole('button', { name: 'v1.0' }))
    await selectAction(/operation\.delete/)
    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))

    // Deleting the previewed version shows the draft again from the kept backup.
    await waitFor(() => expect(mockHandleLoadBackupDraft).toHaveBeenCalledTimes(2))
    expect(renderedStore.getState().backupDraft).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(renderedStore.getState().backupDraft).toBeUndefined()
  })

  it('returns to the draft when the version being deleted is selected before the delete finishes', async () => {
    const user = userEvent.setup()
    const deletion = createDeferred<undefined>()
    mockDeleteWorkflow.mockReturnValueOnce(deletion.promise)
    const { VersionHistoryPanel } = await import('../index')
    render(<VersionHistoryPanel latestVersionId="newer-version-id" />)
    await waitFor(() =>
      expect(renderedStore.getState().currentVersion?.id).toBe('draft-version-id'),
    )

    // Start deleting v1.0 while the draft is selected, then preview v1.0 before the delete returns.
    await selectAction(/operation\.delete/)
    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    await waitFor(() => expect(mockDeleteWorkflow).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await user.click(await screen.findByRole('button', { name: 'v1.0' }))
    expect(renderedStore.getState().currentVersion?.id).toBe('published-version-id')

    deletion.resolve(undefined)

    await waitFor(() =>
      expect(renderedStore.getState().currentVersion?.id).toBe('draft-version-id'),
    )
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

    const { queryClient } = render(<VersionHistoryPanel latestVersionId="published-version-id" />)
    const publishedWorkflowKey = appWorkflowQueryOptions('app-1').queryKey
    queryClient.setQueryData(publishedWorkflowKey, createWorkflowResponseFixture())

    await selectAction(/editVersionInfo/)
    await user.click(screen.getByRole('button', { name: 'submit version info' }))

    await waitFor(() => {
      expect(mockUpdateWorkflow).toHaveBeenCalledWith({
        params: { app_id: 'app-1', workflow_id: 'published-version-id' },
        body: { marked_name: 'Updated release', marked_comment: 'Updated notes' },
      })
      expect(queryClient.getQueryState(publishedWorkflowKey)?.isInvalidated).toBe(true)
    })
  })
})

function render(ui: ReactElement): ReturnType<typeof renderWorkflowComponent> & {
  queryClient: QueryClient
} {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: deploymentEdition },
    features: { billing: { subscription: { plan: mockPlanType } } },
  })
  const rendered = renderWorkflowComponent(<NuqsTestingAdapter>{ui}</NuqsTestingAdapter>, {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    // Export, draft refresh and restore are provided by the app hooks through the hooks store.
    hooksStoreProps: {
      accessControl: fullWorkflowAccessControl,
      handleExportDSL: mockHandleExportDSL,
      handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft,
      handleRestoreFromPublishedWorkflow: mockHandleRestoreFromPublishedWorkflow,
      handleLoadBackupDraft: mockHandleLoadBackupDraft,
    },
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
  return { ...rendered, queryClient }
}
