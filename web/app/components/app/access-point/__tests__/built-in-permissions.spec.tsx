import type {
  AppDetailWithSite,
  WorkflowResponse,
  WorkflowTriggerResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import { BuiltInAccessPoints } from '../built-in-access-points'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/context/i18n', () => ({ useDocLink: () => (path: string) => path }))
vi.mock('@/service/use-triggers', () => ({ useAllTriggerPlugins: () => ({ data: [] }) }))
vi.mock('@/app/components/app/overview/customize', () => ({
  default: () => null,
  CustomizeDialog: () => null,
}))
vi.mock('@/app/components/app/overview/settings', () => ({ SettingsDialog: () => null }))
vi.mock('@/app/components/app/overview/embedded', () => ({ EmbeddedDialogContent: () => null }))

const inService = 'agentV2.agentDetail.access.status.inService'
const unavailable = 'deployments.health.ENVIRONMENT_STATUS_FAILED'
const unpublishedTitle = 'deployments.studio.accessPoint.noPublishedTitle'
const publishedPath = '/apps/app-1/workflows/publish'

const getWebCard = () =>
  screen.getByRole('region', { name: 'agentV2.agentDetail.access.webApp.title' })
const getApiCard = () =>
  screen.getByRole('region', { name: 'agentV2.agentDetail.access.serviceApi.title' })
const getMcpCard = () => screen.getByRole('region', { name: 'tools.mcp.server.title' })
const getTriggerCard = () => screen.getByRole('region', { name: 'navigation.settings.trigger' })

const publishedWorkflow: WorkflowResponse = {
  id: 'published-workflow',
  graph: { nodes: [{ data: { type: 'start' } }] },
  features: {},
  conversation_variables: [],
  environment_variables: [],
  rag_pipeline_variables: [],
  created_at: 1,
  updated_at: 1,
  hash: 'published-hash',
  marked_comment: '',
  marked_name: '',
  tool_published: false,
  version: 'published',
}

function renderAccessPoints({
  mode = 'workflow',
  role = 'normal',
  published = true,
  triggers = [],
  workflow = publishedWorkflow,
  rbacEnabled = false,
  canViewLayout = role === 'owner',
  triggerResponse,
}: {
  mode?: AppDetailWithSite['mode']
  role?: 'normal' | 'owner'
  published?: boolean
  triggers?: WorkflowTriggerResponse[]
  workflow?: WorkflowResponse | null
  rbacEnabled?: boolean
  canViewLayout?: boolean
  triggerResponse?: Promise<Response>
} = {}) {
  const paths: string[] = []
  vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname.replace('/console/api', '')
    if (request.method === 'POST' && path === '/apps/app-1/trigger-enable' && role === 'owner') {
      const body = (await request.json()) as { trigger_id: string; enable_trigger: boolean }
      triggers = triggers.map((trigger) =>
        trigger.id === body.trigger_id
          ? { ...trigger, status: body.enable_trigger ? 'enabled' : 'disabled' }
          : trigger,
      )
      return Response.json({ result: 'success' })
    }
    if (request.method !== 'GET') throw new Error(`Unexpected mutation: ${request.method} ${path}`)
    paths.push(path)
    if (path === publishedPath) {
      return role === 'normal' && !rbacEnabled
        ? Response.json(
            {
              code: 'forbidden',
              message: "You don't have the permission to access the requested resource.",
            },
            { status: 403 },
          )
        : Response.json(workflow)
    }
    if (path === '/apps/app-1/server')
      return Response.json({ id: 'server-1', server_code: 'server-code', status: 'active' })
    if (path === '/apps/app-1/triggers') return triggerResponse ?? Response.json({ data: triggers })
    throw new Error(`Unexpected request: ${request.method} ${path}`)
  })
  const queryClient = createConsoleQueryClient()
  seedAppDetail(
    queryClient,
    createAppDetailFixture({
      id: 'app-1',
      mode,
      site: createAppSiteFixture(),
      workflow: published ? { id: 'published-workflow' } : null,
    }),
  )
  renderWithConsoleQuery(
    <BuiltInAccessPoints
      appId="app-1"
      canViewLayout={canViewLayout}
      canDeploy={false}
      canManageAccessPoint={role === 'owner'}
      canReleaseAndVersion={role === 'owner'}
    />,
    {
      queryClient,
      currentWorkspace: { role },
      systemFeatures: { deployment_edition: 'CLOUD', rbac_enabled: rbacEnabled },
    },
  )
  return paths
}

beforeEach(() => {
  vi.clearAllMocks()
})

it.each(['workflow', 'advanced-chat'] as const)(
  'shows a published %s to Normal members without requesting its graph',
  async (mode) => {
    const paths = renderAccessPoints({ mode })

    await waitFor(() => expect(getMcpCard()).not.toHaveAttribute('aria-busy', 'true'))
    expect(paths).not.toContain(publishedPath)
    expect(within(getWebCard()).getByText(inService)).toBeInTheDocument()
    expect(within(getApiCard()).getByText(inService)).toBeInTheDocument()
    expect(within(getMcpCard()).getByText(inService)).toBeInTheDocument()
    expect(screen.queryByText(unpublishedTitle)).not.toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
    for (const card of [getWebCard(), getApiCard(), getMcpCard()])
      expect(within(card).getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    expect(paths.filter((path) => path === '/apps/app-1/triggers')).toHaveLength(
      mode === 'workflow' ? 1 : 0,
    )
  },
)

it('uses the app summary to identify an unpublished workflow for Normal members', async () => {
  const paths = renderAccessPoints({ published: false })

  await waitFor(() => expect(getMcpCard()).not.toHaveAttribute('aria-busy', 'true'))
  expect(paths).not.toContain(publishedPath)
  expect(screen.getByText(unpublishedTitle)).toBeInTheDocument()
  expect(within(getWebCard()).getAllByText(unavailable).length).toBeGreaterThan(0)
  expect(toast.error).not.toHaveBeenCalled()
})

it('keeps published Owner access points available using the workflow graph', async () => {
  const paths = renderAccessPoints({ role: 'owner' })

  await waitFor(() => expect(within(getMcpCard()).getByText(inService)).toBeInTheDocument())
  expect(paths.filter((path) => path === publishedPath)).toHaveLength(1)
  expect(within(getWebCard()).getByText(inService)).toBeInTheDocument()
  expect(within(getApiCard()).getByText(inService)).toBeInTheDocument()
  expect(within(getTriggerCard()).getByText(unavailable)).toBeInTheDocument()
  expect(toast.error).not.toHaveBeenCalled()
})

it.each(['disabled', 'unauthorized'])(
  'preserves trigger-only availability for a Normal member when its trigger is %s',
  async (status) => {
    const paths = renderAccessPoints({
      triggers: [
        {
          id: 'trigger-1',
          node_id: 'trigger-node',
          title: 'Published trigger',
          trigger_type: 'trigger-webhook',
          status,
          icon: '',
          provider_name: '',
        },
      ],
    })

    await waitFor(() => expect(getMcpCard()).not.toHaveAttribute('aria-busy', 'true'))
    expect(paths).not.toContain(publishedPath)
    for (const card of [getWebCard(), getApiCard(), getMcpCard()])
      expect(within(card).getAllByText(unavailable).length).toBeGreaterThan(0)
    expect(within(getTriggerCard()).getByText('Published trigger')).toBeInTheDocument()
    expect(within(getTriggerCard()).getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText('deployments.studio.accessPoint.triggerExclusiveNotice'),
    ).toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  },
)

it('waits for published trigger metadata before showing Normal access point availability', async () => {
  let finish!: (response: Response) => void
  const triggerResponse = new Promise<Response>((resolve) => {
    finish = resolve
  })
  const paths = renderAccessPoints({ triggerResponse })

  await waitFor(() => expect(paths).toContain('/apps/app-1/triggers'))
  expect(getWebCard()).toHaveAttribute('aria-busy', 'true')
  expect(screen.queryByText(unpublishedTitle)).not.toBeInTheDocument()

  finish(Response.json({ data: [] }))
  await waitFor(() => expect(within(getWebCard()).getByText(inService)).toBeInTheDocument())
  expect(paths.filter((path) => path === '/apps/app-1/triggers')).toHaveLength(1)
  expect(paths).not.toContain(publishedPath)
})

it('honors RBAC layout access even for a Normal workspace member', async () => {
  const paths = renderAccessPoints({ rbacEnabled: true, canViewLayout: true })

  await waitFor(() => expect(within(getMcpCard()).getByText(inService)).toBeInTheDocument())
  expect(paths.filter((path) => path === publishedPath)).toHaveLength(1)
  expect(toast.error).not.toHaveBeenCalled()
})

it('keeps Owner MCP unavailable when the published graph has no Start node', async () => {
  renderAccessPoints({ role: 'owner', workflow: { ...publishedWorkflow, graph: { nodes: [] } } })

  await waitFor(() => expect(getMcpCard()).not.toHaveAttribute('aria-busy', 'true'))
  expect(within(getMcpCard()).getAllByText(unavailable).length).toBeGreaterThan(0)
  expect(screen.queryByText(unpublishedTitle)).not.toBeInTheDocument()
})

it('refreshes the shared trigger query after an Owner changes a published trigger', async () => {
  const user = userEvent.setup()
  const paths = renderAccessPoints({
    role: 'owner',
    workflow: { ...publishedWorkflow, graph: { nodes: [{ data: { type: 'trigger-webhook' } }] } },
    triggers: [
      {
        id: 'trigger-1',
        node_id: 'trigger-node',
        title: 'Published trigger',
        trigger_type: 'trigger-webhook',
        status: 'enabled',
        icon: '',
        provider_name: '',
      },
    ],
  })

  const toggle = await within(getTriggerCard()).findByRole('switch', { name: 'Published trigger' })
  expect(toggle).toHaveAttribute('aria-checked', 'true')
  await user.click(toggle)

  await waitFor(() =>
    expect(paths.filter((path) => path === '/apps/app-1/triggers')).toHaveLength(2),
  )
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(toast.error).not.toHaveBeenCalled()
})
