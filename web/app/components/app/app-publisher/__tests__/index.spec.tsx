import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
import type { Socket } from 'socket.io-client'
import { EventEmitter } from 'node:events'
import { EnvironmentStatus } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { toast } from '@/app/notifications'
import { AccessMode } from '@/models/access-control'
import { consoleQuery } from '@/service/console'
import {
  appWorkflowQueryOptions,
  appWorkflowVersionsInfiniteQueryOptions,
} from '@/service/workflow-queries'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { AppACLPermission } from '@/utils/permission'
import { basePath } from '@/utils/var'
import { AppPublisher } from '../index'

const api = vi.hoisted(() => ({
  // WorkflowPublishApi.get returns null when unpublished; its generated response omits that case.
  published: vi.fn<() => Promise<WorkflowResponse | null>>(),
  environments:
    vi.fn<
      typeof import('@/service/console').consoleClient.enterprise.appDeploy.deploymentService.listAppEnvironments
    >(),
  deployments:
    vi.fn<
      typeof import('@/service/console').consoleClient.enterprise.appDeploy.deploymentService.listEnvironmentDeployments
    >(),
  marketplace:
    vi.fn<
      typeof import('@/service/console').consoleClient.apps.byAppId.publishToCreatorsPlatform.post
    >(),
  createTool:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.workflow.create.post
    >(),
  access: vi.fn<typeof import('@/service/share').getUserCanAccess>(),
  patch:
    vi.fn<
      typeof import('@/service/console').consoleClient.apps.byAppId.workflows.byWorkflowId.patch
    >(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.byWorkflowId.patch': api.patch,
      'apps.byAppId.workflows.publish.get': api.published,
      'enterprise.appDeploy.deploymentService.listAppEnvironments': api.environments,
      'enterprise.appDeploy.deploymentService.listEnvironmentDeployments': api.deployments,
      'enterprise.appDeploy.deploymentService.precheckWorkflowDeployment': async () => ({
        unsupported_nodes: [],
      }),
      'enterprise.appDeploy.deploymentService.getWorkflowDeploymentOptions': async () => ({
        credential_slots: [],
        environment_variable_groups: [],
      }),
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
      'rag.pipelines.datasourcePlugins.get': async () => [],
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.publishToCreatorsPlatform.post': api.marketplace,
      'workspaces.current.toolProvider.workflow.create.post': api.createTool,
    }),
  }
})
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  getUserCanAccess: api.access,
}))

beforeEach(() => {
  api.published
    .mockReset()
    .mockResolvedValue(
      createWorkflowResponseFixture({ marked_name: 'Release 5', marked_comment: 'Initial notes' }),
    )
  api.environments.mockReset().mockResolvedValue({ data: [] })
  api.deployments.mockReset().mockResolvedValue({ environment_deployments: [] })
  api.marketplace
    .mockReset()
    .mockResolvedValue({ redirect_url: 'https://marketplace.example.com/publish?code=abc' })
  api.createTool.mockReset().mockResolvedValue({ result: 'success' })
  api.access.mockReset().mockResolvedValue({ result: true })
  api.patch.mockReset().mockResolvedValue(createWorkflowResponseFixture())
  vi.spyOn(window, 'open').mockImplementation(() => null)
})
afterEach(() => vi.restoreAllMocks())

function renderPublisher({
  props = {},
  app = {},
  queryClient = createConsoleQueryClient(),
  workspacePermissionKeys = ['tool.manage'],
  systemFeatures = {},
}: {
  props?: Partial<ComponentProps<typeof AppPublisher>>
  app?: Parameters<typeof createAppDetailFixture>[0]
  queryClient?: ReturnType<typeof createConsoleQueryClient>
  workspacePermissionKeys?: string[]
  systemFeatures?: NonNullable<Parameters<typeof renderWithConsoleQuery>[1]>['systemFeatures']
} = {}) {
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppDetailFixture({
      id: 'app-1',
      name: 'Demo App',
      mode: 'chat',
      maintainer: 'user-2',
      permission_keys: [],
      access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
      site: createAppSiteFixture({ app_base_url: 'https://example.com', access_token: 'token-1' }),
      ...app,
    }),
  )
  const store = createWorkflowStore({})
  renderWithConsoleQuery(
    <WorkflowContext value={store}>
      <button type="button">Outside control</button>
      <AppPublisher appId="app-1" publishedAt={1_710_000_100_000} {...props} />
    </WorkflowContext>,
    {
      queryClient,
      workspacePermissionKeys,
      systemFeatures: { webapp_auth: { enabled: true }, ...systemFeatures },
    },
  )
  return { queryClient, store }
}
const trigger = () => screen.getByRole('button', { name: 'workflow.common.publish' })
const publishUpdate = () => screen.getByRole('button', { name: 'workflow.common.publishUpdate' })
const environments = [
  {
    description: '',
    display_name: 'Staging',
    id: 'staging',
    in_use: false,
    status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
  },
]

it('checks web app access only when opened and disables the link when access is denied', async () => {
  const user = userEvent.setup()
  const access = createDeferred<{ result: boolean }>()
  api.access.mockReturnValueOnce(access.promise)
  renderPublisher()
  expect(api.access).not.toHaveBeenCalled()
  await user.click(trigger())
  expect(screen.getByRole('button', { name: 'workflow.common.openWebApp' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await act(async () => access.resolve({ result: true }))
  expect(await screen.findByRole('link', { name: 'workflow.common.openWebApp' })).toHaveAttribute(
    'href',
    `https://example.com${basePath}/chat/token-1`,
  )
  await user.click(trigger())
  api.access.mockResolvedValue({ result: false })
  await user.click(trigger())
  expect(await screen.findByRole('button', { name: 'workflow.common.openWebApp' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(api.access).toHaveBeenCalledWith('app-1', true)
})

it('publishes once per open session and permits another update after reopening', async () => {
  const user = userEvent.setup()
  const onPublish = vi.fn().mockResolvedValue(undefined)
  renderPublisher({ props: { onPublish } })
  await user.click(trigger())
  await user.click(publishUpdate())
  expect(await screen.findByRole('button', { name: 'workflow.common.published' })).toBeDisabled()
  expect(onPublish).toHaveBeenCalledOnce()
  await user.click(trigger())
  expect(
    screen.queryByRole('button', { name: 'workflow.common.published' }),
  ).not.toBeInTheDocument()
  await user.click(trigger())
  await user.click(publishUpdate())
  await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(2))
})

it('refreshes workflow and deployment caches after publishing with deployment access', async () => {
  const user = userEvent.setup()
  const { queryClient } = renderPublisher({
    app: { mode: 'workflow', permission_keys: [AppACLPermission.Deploy] },
    props: { onPublish: vi.fn().mockResolvedValue(undefined) },
  })
  const versionsKey = appWorkflowVersionsInfiniteQueryOptions('app-1').queryKey
  const deploymentsKey =
    consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions({
      input: { params: { app_id: 'app-1' } },
    }).queryKey
  queryClient.setQueryData(versionsKey, { pages: [], pageParams: [] })
  queryClient.setQueryData(deploymentsKey, { environment_deployments: [] })
  await user.click(trigger())
  expect(await screen.findByText('Release 5')).toBeInTheDocument()
  const updated = createWorkflowResponseFixture({ marked_name: 'Release 6' })
  api.published.mockResolvedValue(updated)
  await user.click(publishUpdate())
  expect(await screen.findByText('Release 6')).toBeInTheDocument()
  expect(queryClient.getQueryState(versionsKey)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(deploymentsKey)?.isInvalidated).toBe(true)
})

it('edits a published workflow version and shows the saved title and notes when reopened', async () => {
  const user = userEvent.setup()
  const saved = createWorkflowResponseFixture({
    marked_name: 'Release 6',
    marked_comment: 'Updated notes',
  })
  renderPublisher({ app: { mode: 'workflow' } })
  await user.click(trigger())
  await user.click(
    await screen.findByRole('button', { name: 'workflowHistory.versionHistory.editVersionInfo' }),
  )
  const [title, notes] = screen.getAllByRole('textbox')
  await user.clear(title!)
  await user.type(title!, 'Release 6')
  await user.clear(notes!)
  await user.type(notes!, 'Updated notes')
  api.patch.mockResolvedValue(saved)
  api.published.mockResolvedValue(saved)
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith({
      params: { app_id: 'app-1', workflow_id: 'workflow-1' },
      body: { marked_name: 'Release 6', marked_comment: 'Updated notes' },
    }),
  )
  await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  await user.click(trigger())
  expect(await screen.findByText('Release 6')).toBeInTheDocument()
  expect(screen.getByText('Updated notes')).toBeInTheDocument()
})

it.each([
  { mode: 'workflow' as const, permission_keys: [AppACLPermission.Deploy], available: true },
  { mode: 'workflow' as const, permission_keys: [], available: false },
  { mode: 'chat' as const, permission_keys: [AppACLPermission.Deploy], available: false },
])(
  'offers environment deployment for $mode with permissions $permission_keys',
  async ({ mode, permission_keys, available }) => {
    const user = userEvent.setup()
    renderPublisher({
      app: { mode, permission_keys },
      workspacePermissionKeys: [],
      systemFeatures: { enable_app_deploy: false },
    })
    await user.click(trigger())
    if (mode === 'workflow') await screen.findByText('Release 5')
    if (available) {
      expect(screen.getByRole('link', { name: 'common.appMenus.deploy' })).toHaveAttribute(
        'href',
        `${basePath}/app/app-1/deploy`,
      )
      expect(screen.getByRole('group', { name: /studio.environments/ })).toBeInTheDocument()
    } else {
      expect(screen.queryByRole('link', { name: 'common.appMenus.deploy' })).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: /studio.environments/ })).not.toBeInTheDocument()
      expect(api.environments).not.toHaveBeenCalled()
    }
  },
)

it('loads an unused environment without requesting a deployment and enables deploying a published version', async () => {
  const user = userEvent.setup()
  const unexpectedRequest = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network request'))
  const published = createDeferred<WorkflowResponse | null>()
  api.published.mockReturnValueOnce(published.promise)
  api.environments.mockResolvedValue({ data: environments })
  const { queryClient } = renderPublisher({
    app: { mode: 'workflow', permission_keys: [AppACLPermission.Deploy] },
  })
  await user.click(trigger())
  await user.click(
    await screen.findByRole('button', { name: /studio.moreEnvironments|operation.more/ }),
  )
  await user.click(screen.getByRole('menuitem', { name: 'Staging' }))
  expect(await screen.findByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
  await act(async () => published.resolve(null))
  expect(await screen.findByText(/studio.accessPoint.noPublishedTitle/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /studio.accessPoint.goToPublish/ })).toBeEnabled()
  api.published.mockResolvedValue(createWorkflowResponseFixture({ marked_name: 'Release 6' }))
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: appWorkflowQueryOptions('app-1').queryKey })
  })
  expect(await screen.findByText(/studio.publisher.notDeployedYet/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /studio.deployLatest/ })).toBeEnabled()
  expect(screen.getByText(/Release 6/)).toBeInTheDocument()
  expect(unexpectedRequest).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: /nodes.common.memories.builtIn/ }))
  expect(publishUpdate()).toBeEnabled()
})

it('returns to the built-in environment when the publisher is closed and reopened', async () => {
  const user = userEvent.setup()
  api.environments.mockResolvedValue({ data: environments })
  renderPublisher({ app: { mode: 'workflow', permission_keys: [AppACLPermission.Deploy] } })
  await user.click(trigger())
  await user.click(
    await screen.findByRole('button', { name: /studio.moreEnvironments|operation.more/ }),
  )
  await user.click(screen.getByRole('menuitem', { name: 'Staging' }))
  expect(await screen.findByText(/studio.publisher.notDeployedYet/)).toBeInTheDocument()
  await user.click(trigger())
  expect(screen.queryByRole('button', { name: 'Staging' })).not.toBeInTheDocument()
  await user.click(trigger())
  expect(screen.getByRole('button', { name: /nodes.common.memories.builtIn/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
  expect(publishUpdate()).toBeEnabled()
})

it('collects hidden inputs before opening the web app from its config action', async () => {
  const user = userEvent.setup()
  renderPublisher({
    props: {
      inputs: [
        {
          variable: 'secret',
          label: 'Secret',
          type: 'text-input',
          required: true,
          hide: true,
          default: '',
        },
      ],
    },
  })
  await user.click(trigger())
  await user.click(await screen.findByRole('button', { name: 'common.operation.config' }))
  await user.type(screen.getByLabelText('Secret'), 'top-secret')
  await user.click(screen.getByRole('button', { name: 'appOverview.overview.appInfo.launch' }))
  expect(window.open).toHaveBeenCalledWith(
    `https://example.com${basePath}/chat/token-1?secret=top-secret`,
    '_blank',
  )
})

it.each(['publish', 'create'] as const)(
  'keeps the tool form for retry when %s fails',
  async (stage) => {
    const user = userEvent.setup()
    const onPublish = vi.fn().mockResolvedValue(undefined)
    const success = vi.spyOn(toast, 'success')
    const error = vi.spyOn(toast, 'error')
    if (stage === 'publish') onPublish.mockRejectedValueOnce(new Error('publish failed'))
    else api.createTool.mockRejectedValueOnce(new Error('create failed'))
    renderPublisher({ app: { mode: 'workflow' }, props: { onPublish } })
    await user.click(trigger())
    await screen.findByText('Release 5')
    await user.click(screen.getByRole('button', { name: /navigation.common.workflowAsTool/ }))
    const drawer = screen.getByRole('dialog', { name: 'navigation.common.workflowAsTool' })
    expect(
      screen.queryByRole('button', { name: 'workflow.common.publishUpdate' }),
    ).not.toBeInTheDocument()
    await user.type(
      within(drawer).getByRole('textbox', { name: 'tools.createTool.nameForToolCall' }),
      'workflow_tool',
    )
    await user.click(within(drawer).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith(`${stage} failed`))
    expect(success).not.toHaveBeenCalled()
    if (stage === 'publish') expect(api.createTool).not.toHaveBeenCalled()
    expect(
      within(drawer).getByRole('textbox', { name: 'tools.createTool.nameForToolCall' }),
    ).toHaveValue('workflow_tool')
    await user.click(within(drawer).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'navigation.common.workflowAsTool' }),
      ).not.toBeInTheDocument(),
    )
    expect(api.createTool).toHaveBeenCalledWith({
      body: expect.objectContaining({ workflow_app_id: 'app-1', name: 'workflow_tool' }),
    })
    expect(success).toHaveBeenCalledOnce()
  },
)

it('disables configuring a workflow tool without tool.manage', async () => {
  const user = userEvent.setup()
  renderPublisher({ app: { mode: 'workflow' }, workspacePermissionKeys: [] })
  await user.click(trigger())
  await screen.findByText('Release 5')
  expect(screen.getByRole('button', { name: /navigation.common.workflowAsTool/ })).toBeDisabled()
})

it('keeps failed publish and restore actions available for retry', async () => {
  const user = userEvent.setup()
  const onPublish = vi
    .fn()
    .mockRejectedValueOnce(new Error('publish failed'))
    .mockResolvedValue(undefined)
  const onRestore = vi
    .fn()
    .mockRejectedValueOnce(new Error('restore failed'))
    .mockResolvedValue(undefined)
  renderPublisher({ props: { onPublish, onRestore } })
  await user.click(trigger())
  await user.click(publishUpdate())
  await waitFor(() => expect(publishUpdate()).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))
  expect(publishUpdate()).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'workflow.common.publishUpdate' }),
    ).not.toBeInTheDocument(),
  )
  expect(onRestore).toHaveBeenCalledTimes(2)
})

it('opens the marketplace redirect after a successful submission', async () => {
  const user = userEvent.setup()
  renderPublisher({ systemFeatures: { enable_creators_platform: true } })
  await user.click(trigger())
  await user.click(screen.getByRole('button', { name: 'workflow.common.publishToMarketplace' }))
  await waitFor(() =>
    expect(window.open).toHaveBeenCalledWith(
      'https://marketplace.example.com/publish?code=abc',
      '_blank',
    ),
  )
  expect(api.marketplace).toHaveBeenCalledExactlyOnceWith({ params: { app_id: 'app-1' } })
})

it('shows a marketplace error and lets the user retry', async () => {
  const user = userEvent.setup()
  const error = vi.spyOn(toast, 'error')
  api.marketplace.mockRejectedValueOnce(new Error('network error'))
  renderPublisher({ systemFeatures: { enable_creators_platform: true } })
  await user.click(trigger())
  await user.click(screen.getByRole('button', { name: 'workflow.common.publishToMarketplace' }))
  await waitFor(() =>
    expect(error).toHaveBeenCalledWith('workflow.common.publishToMarketplaceFailed'),
  )
  expect(window.open).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'workflow.common.publishToMarketplace' }))
  await waitFor(() => expect(window.open).toHaveBeenCalledOnce())
})

it('disables marketplace submission until a version is published', async () => {
  const user = userEvent.setup()
  renderPublisher({
    props: { publishedAt: undefined },
    systemFeatures: { enable_creators_platform: true },
  })
  await user.click(trigger())
  expect(
    screen.getByRole('button', { name: 'workflow.common.publishToMarketplace' }),
  ).toBeDisabled()
  expect(api.marketplace).not.toHaveBeenCalled()
})

it('hides marketplace submission when the feature is disabled', async () => {
  const user = userEvent.setup()
  renderPublisher()
  await user.click(trigger())
  expect(
    screen.queryByRole('button', { name: 'workflow.common.publishToMarketplace' }),
  ).not.toBeInTheDocument()
})

it('refreshes the visible version and workflow store after receiving a collaborator publication', async () => {
  const user = userEvent.setup()
  // The socket is the network boundary; the collaboration manager and query subscriptions remain real.
  const incoming = new EventEmitter()
  const socket = Object.assign(incoming, {
    id: 'test-socket',
    connected: false,
  }) as unknown as Socket
  vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket)
  vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {})
  const connection = await collaborationManager.connect('app-1')
  try {
    const { store } = renderPublisher({ app: { mode: 'workflow' } })
    await user.click(trigger())
    await screen.findByText('Release 5')
    api.published.mockResolvedValue(
      createWorkflowResponseFixture({
        created_at: 1_710_000_300,
        marked_name: 'Collaborator release',
      }),
    )
    act(() => {
      incoming.emit('collaboration_update', {
        type: 'app_publish_update',
        userId: 'collaborator-1',
        data: { action: 'published' },
        timestamp: 1_710_000_300_000,
      })
    })
    expect(await screen.findByText('Collaborator release')).toBeInTheDocument()
    expect(store.getState().publishedAt).toBe(1_710_000_300_000)
  } finally {
    collaborationManager.disconnect(connection)
  }
})

it('publishes with the shortcut from the action area after opening and reopening, but not while closed', async () => {
  const user = userEvent.setup()
  const onPublish = vi.fn().mockResolvedValue(undefined)
  const modifier = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  const shortcut = `{${modifier}>}{Shift>}P{/Shift}{/${modifier}}`
  renderPublisher({ props: { onPublish } })
  for (let opened = 1; opened <= 2; opened++) {
    await user.click(trigger())
    const link = await screen.findByRole('link', { name: 'workflow.common.openWebApp' })
    act(() => link.focus())
    await user.keyboard(shortcut)
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(opened))
    expect(screen.getByRole('button', { name: 'workflow.common.published' })).toBeDisabled()
    await user.click(trigger())
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'workflow.common.openWebApp' }),
      ).not.toBeInTheDocument(),
    )
    await user.keyboard(shortcut)
    expect(onPublish).toHaveBeenCalledTimes(opened)
  }
})

it('preserves deployment configuration after an outside press and restores dismissal after leaving it', async () => {
  const user = userEvent.setup()
  api.environments.mockResolvedValue({ data: environments })
  renderPublisher({ app: { mode: 'workflow', permission_keys: [AppACLPermission.Deploy] } })
  await user.click(trigger())
  await user.click(
    await screen.findByRole('button', { name: /studio.moreEnvironments|operation.more/ }),
  )
  await user.click(screen.getByRole('menuitem', { name: 'Staging' }))
  await user.click(await screen.findByRole('button', { name: 'deployments.studio.deployLatest' }))
  expect(
    await screen.findByRole('heading', { name: 'deployments.studio.deployConfiguration' }),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Outside control' }))
  expect(
    screen.getByRole('heading', { name: 'deployments.studio.deployConfiguration' }),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(await screen.findByText(/studio.publisher.notDeployedYet/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Outside control' }))
  await waitFor(() =>
    expect(screen.queryByText(/studio.publisher.notDeployedYet/)).not.toBeInTheDocument(),
  )
  await user.click(trigger())
  await user.click(screen.getByRole('button', { name: 'Staging' }))
  await user.click(await screen.findByRole('button', { name: 'deployments.studio.deployLatest' }))
  await screen.findByRole('heading', { name: 'deployments.studio.deployConfiguration' })
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'deployments.studio.deployConfiguration' }),
    ).not.toBeInTheDocument(),
  )
  expect(trigger()).toHaveAttribute('aria-expanded', 'false')
})
