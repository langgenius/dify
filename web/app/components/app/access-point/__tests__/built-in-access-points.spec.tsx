import type {
  AppDetailWithSite,
  AppMode,
  WorkflowResponse,
  WorkflowTriggerResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement } from 'react'
import type { PublishedWorkflow } from '../shared/utils'
import { ORPCError } from '@orpc/client'
import { screen, waitFor, within } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { appWorkflowQueryOptions } from '@/service/workflow-queries'
import { renderWithConsoleQuery as renderWithConsole } from '@/test/console/query-data'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { createTestQueryClient } from '@/test/query-client'
import { BuiltInAccessPoints } from '../built-in-access-points'

const fetchPublishedWorkflow = vi.hoisted(() => vi.fn<() => Promise<PublishedWorkflow>>())

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test${path}`,
}))

// boundary: published workflow retrieval is the network boundary for this availability coordinator.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.publish.get': fetchPublishedWorkflow,
    }),
  }
})

vi.mock('@/service/access-control/use-app-access-control', () => ({
  useAppWhiteListSubjects: () => ({ data: undefined }),
  useGetUserCanAccessApp: () => ({ data: { result: true }, refetch: vi.fn() }),
}))

// These independently tested dialogs do not own card availability or permission state.
vi.mock('@/app/components/app/overview/customize', () => ({
  CustomizeDialog: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" disabled={disabled}>
      Customize
    </button>
  ),
}))

vi.mock('@/app/components/app/overview/settings', () => ({
  SettingsDialog: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" disabled={disabled}>
      Settings
    </button>
  ),
}))

vi.mock('@/app/components/app/overview/workflow-launch-dialog', () => ({
  WorkflowLaunchDialog: () => null,
}))

const startWorkflow = createWorkflowResponseFixture({
  graph: { nodes: [{ id: 'start', data: { type: 'start' } }], edges: [] },
})

const triggerWorkflow = createWorkflowResponseFixture({
  graph: { nodes: [{ id: 'trigger', data: { type: 'trigger-webhook' } }], edges: [] },
})

const publishedTrigger: WorkflowTriggerResponse = {
  id: 'trigger-1',
  trigger_type: 'trigger-webhook',
  title: 'Published webhook',
  node_id: 'trigger',
  provider_name: 'Webhook',
  icon: '',
  status: 'enabled',
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
}

let appInfo: AppDetailWithSite
let triggers: WorkflowTriggerResponse[]
let publishedWorkflow: WorkflowResponse | undefined

function createAppInfo(mode: AppMode = 'workflow', overrides: Partial<AppDetailWithSite> = {}) {
  return createAppDetailFixture({
    id: 'app-1',
    mode,
    enable_site: false,
    enable_api: false,
    site: createAppSiteFixture(),
    permission_keys: [],
    ...overrides,
  })
}

function render(ui: ReactElement) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    appInfo,
  )
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.server.get.queryKey({
      input: { params: { app_id: 'app-1' } },
    }),
    {
      id: '',
      server_code: '',
      name: '',
      description: '',
      parameters: {},
      status: 'inactive',
    },
  )
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.triggers.get.queryKey({
      input: { params: { app_id: 'app-1' } },
    }),
    { data: triggers },
  )
  queryClient.setQueryData(
    consoleQuery.apps.byResourceId.apiKeys.get.queryKey({
      input: { params: { resource_id: 'app-1' } },
    }),
    { data: [] },
  )
  if (publishedWorkflow)
    queryClient.setQueryData(appWorkflowQueryOptions('app-1').queryKey, publishedWorkflow)
  return renderWithConsole(ui, {
    queryClient,
    currentWorkspace: { id: 'workspace-1', role: 'owner' },
    systemFeatures: { webapp_auth: { enabled: false }, rbac_enabled: true },
  })
}

function renderAccessPoints(
  permissions: {
    canDeploy?: boolean
    canManageAccessPoint?: boolean
    canReleaseAndVersion?: boolean
  } = {},
) {
  return render(
    <BuiltInAccessPoints
      canViewLayout
      appId="app-1"
      canDeploy={permissions.canDeploy ?? true}
      canManageAccessPoint={permissions.canManageAccessPoint ?? true}
      canReleaseAndVersion={permissions.canReleaseAndVersion ?? true}
    />,
  )
}

const forbidden = () => new ORPCError('forbidden', { status: 403, message: 'Forbidden' })
const pending = () => new Promise<PublishedWorkflow>(() => {})

const getCards = () => ({
  web: screen.getByRole('region', { name: /agentDetail\.access\.webApp\.title/ }),
  api: screen.getByRole('region', { name: /agentDetail\.access\.serviceApi\.title/ }),
  mcp: screen.getByRole('region', { name: /mcp\.server\.title/ }),
  trigger: screen.queryByRole('region', { name: /settings\.trigger/ }),
})

describe('BuiltInAccessPoints', () => {
  beforeEach(() => {
    appInfo = createAppInfo()
    triggers = []
    publishedWorkflow = undefined
    // The backend answers an unpublished app with a null body.
    fetchPublishedWorkflow.mockResolvedValue(null)
  })

  it('renders the unpublished state across all access point cards', async () => {
    renderAccessPoints({ canManageAccessPoint: false, canReleaseAndVersion: false })

    expect(
      await screen.findByText('deployments.studio.accessPoint.noPublishedTitle'),
    ).toBeInTheDocument()
    const cards = getCards()
    expect(cards.trigger).toBeInTheDocument()
    for (const card of [cards.web, cards.api, cards.mcp, cards.trigger!])
      expect(
        within(card).getAllByText('deployments.health.ENVIRONMENT_STATUS_FAILED').length,
      ).toBeGreaterThan(0)
    expect(
      screen.getByRole('button', { name: 'deployments.studio.accessPoint.goToPublish' }),
    ).toBeDisabled()
  })

  it('keeps Trigger unavailable when no trigger node is published', () => {
    publishedWorkflow = startWorkflow
    renderAccessPoints({ canManageAccessPoint: false, canReleaseAndVersion: false })

    expect(
      screen.queryByText('deployments.studio.accessPoint.noPublishedTitle'),
    ).not.toBeInTheDocument()
    const cards = getCards()
    expect(
      within(cards.web).queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
    ).not.toBeInTheDocument()
    expect(
      within(cards.api).queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
    ).not.toBeInTheDocument()
    expect(
      within(cards.trigger!).getByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
    ).toBeInTheDocument()
  })

  it('keeps an unpublished Chatflow unavailable without showing a Trigger card', async () => {
    appInfo = createAppInfo('advanced-chat', { enable_site: true, enable_api: true })
    renderAccessPoints()

    expect(
      await screen.findByText('deployments.studio.accessPoint.noPublishedTitle'),
    ).toBeInTheDocument()
    const cards = getCards()
    expect(cards.trigger).not.toBeInTheDocument()
    for (const card of [cards.web, cards.api, cards.mcp])
      expect(
        within(card).getAllByText('deployments.health.ENVIRONMENT_STATUS_FAILED').length,
      ).toBeGreaterThan(0)
  })

  it.each([
    ['loading', 'loading'],
    ['failed', 'unavailable'],
    ['published', 'available'],
  ] as const)('shows Chatflow access points as %s', async (state, availability) => {
    appInfo = createAppInfo('advanced-chat', { enable_site: true, enable_api: true })
    if (state === 'loading') fetchPublishedWorkflow.mockImplementation(pending)
    if (state === 'failed') fetchPublishedWorkflow.mockRejectedValue(forbidden())
    if (state === 'published') publishedWorkflow = startWorkflow
    renderAccessPoints()

    const cards = getCards()
    expect(cards.trigger).not.toBeInTheDocument()
    await waitFor(() => {
      for (const card of [cards.web, cards.api]) {
        if (availability === 'loading') expect(card).toHaveAttribute('aria-busy', 'true')
        else expect(card).not.toHaveAttribute('aria-busy')
      }
    })
    for (const card of [cards.web, cards.api]) {
      if (availability === 'unavailable')
        expect(
          within(card).getAllByText('deployments.health.ENVIRONMENT_STATUS_FAILED').length,
        ).toBeGreaterThan(0)
      else
        expect(
          within(card).queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
        ).not.toBeInTheDocument()
    }
    expect(
      screen.queryByText('deployments.studio.accessPoint.noPublishedTitle'),
    ).not.toBeInTheDocument()
  })

  it('enables access point management controls only with permission', () => {
    publishedWorkflow = startWorkflow
    const { rerender } = renderAccessPoints({ canManageAccessPoint: false })

    expect(
      screen.getByRole('switch', { name: 'appOverview.overview.appInfo.title' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('switch', { name: 'appOverview.overview.apiInfo.title' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('switch', { name: 'tools.mcp.server.title' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    rerender(
      <BuiltInAccessPoints
        canViewLayout
        appId="app-1"
        canDeploy
        canManageAccessPoint
        canReleaseAndVersion
      />,
    )
    expect(
      screen.getByRole('switch', { name: 'appOverview.overview.appInfo.title' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('switch', { name: 'appOverview.overview.apiInfo.title' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('switch', { name: 'tools.mcp.server.title' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('enables Trigger and disables the other access points in trigger mode', () => {
    publishedWorkflow = triggerWorkflow
    triggers = [publishedTrigger]
    renderAccessPoints()

    const cards = getCards()
    for (const card of [cards.web, cards.api, cards.mcp])
      expect(
        within(card).getAllByText('deployments.health.ENVIRONMENT_STATUS_FAILED').length,
      ).toBeGreaterThan(0)
    expect(cards.trigger).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Published webhook' })).toBeChecked()
    expect(
      screen.getByText('deployments.studio.accessPoint.triggerExclusiveNotice'),
    ).toBeInTheDocument()
  })

  it('keeps all cards visible while the published workflow is loading', () => {
    fetchPublishedWorkflow.mockImplementation(pending)
    renderAccessPoints()

    const cards = getCards()
    for (const card of [cards.web, cards.api, cards.mcp, cards.trigger!])
      expect(card).toHaveAttribute('aria-busy', 'true')
  })

  it('does not show the unpublished card when loading the published workflow fails', async () => {
    fetchPublishedWorkflow.mockRejectedValue(forbidden())
    renderAccessPoints()

    const { web } = getCards()
    await waitFor(() => expect(web).not.toHaveAttribute('aria-busy'))
    expect(
      within(web).getAllByText('deployments.health.ENVIRONMENT_STATUS_FAILED').length,
    ).toBeGreaterThan(0)

    expect(
      screen.queryByText('deployments.studio.accessPoint.noPublishedTitle'),
    ).not.toBeInTheDocument()
  })
})
