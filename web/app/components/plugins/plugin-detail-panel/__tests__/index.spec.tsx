import type { ComponentProps, ReactElement } from 'react'
import type { Credential } from '@/app/components/plugins/plugin-auth/types'
import type { PluginDeclaration, PluginDetail } from '@/app/components/plugins/types'
import type { consoleClient } from '@/service/console'
import {
  zToolApiEntity,
  zTriggerProviderApiEntity,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { createDeferred } from '@/test/deferred'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import PluginDetailPanel from '../index'

const api = vi.hoisted(() => ({
  uninstall: vi.fn<typeof consoleClient.workspaces.current.plugin.uninstall.post>(),
  upgrade: vi.fn<typeof consoleClient.workspaces.current.plugin.upgrade.marketplace.post>(),
  tools:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.builtin.byProvider.tools.get
    >(),
  providers:
    vi.fn<typeof import('@/service/console').consoleClient.workspaces.current.toolProviders.get>(),
  trigger:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.triggerProvider.byProvider.info.get
    >(),
  subscriptions:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.triggerProvider.byProvider.subscriptions.list.get
    >(),
  credentials: vi.fn<
    (url: string) => Promise<{
      supported_credential_types: string[]
      credentials: Credential[]
      is_oauth_custom_client_enabled: boolean
    }>
  >(),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: api.credentials,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.uninstall.post': api.uninstall,
      'workspaces.current.toolProviders.get': api.providers,
      'workspaces.current.toolProvider.builtin.byProvider.tools.get': api.tools,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.upgrade.marketplace.post': api.upgrade,
      'workspaces.current.toolProvider.builtin.byProvider.tools.get': api.tools,
      'workspaces.current.triggerProvider.byProvider.info.get': api.trigger,
      'workspaces.current.triggerProvider.byProvider.subscriptions.list.get': api.subscriptions,
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
      'workspaces.current.plugin.autoUpgrade.fetch.get': async () => ({
        auto_upgrade: {
          strategy_setting: 'disabled',
          upgrade_mode: 'all',
          upgrade_time_of_day: 0,
          include_plugins: [],
          exclude_plugins: [],
        },
      }),
    }),
  }
})

const baseDeclaration = createPluginDeclarationFixture()
const identity = {
  author: 'test-author',
  name: 'provider-a',
  icon: 'icon.svg',
  tags: [],
  label: baseDeclaration.label,
  description: baseDeclaration.description,
}
const createPluginDetail = (overrides: Partial<PluginDeclaration> = {}): PluginDetail => ({
  id: 'test-plugin-id',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  name: 'Test Plugin',
  plugin_id: 'test-plugin-id',
  plugin_unique_identifier: 'test-plugin-uid',
  declaration: {
    ...baseDeclaration,
    name: 'test-plugin',
    endpoint: null,
    tool: { identity, credentials_schema: [] },
    trigger: {
      identity,
      events: [],
      subscription_schema: [],
      subscription_constructor: {
        credentials_schema: [],
        oauth_schema: { client_schema: [], credentials_schema: [] },
        parameters: [],
      },
    },
    ...overrides,
  },
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '2.0.0',
  latest_unique_identifier: 'new-plugin-uid',
  source: PluginSource.marketplace,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
})
const tool = zToolApiEntity.parse({
  name: 'search',
  author: 'Team',
  label: { en_US: 'Search' },
  description: { en_US: 'Search documents' },
  parameters: [
    {
      name: 'query',
      type: 'string',
      form: 'llm',
      required: true,
      label: { en_US: 'Query' },
      llm_description: 'Search query',
    },
  ],
})
const provider = createToolProviderFixture({
  name: 'test-plugin-id/provider-a',
  type: 'builtin',
  allow_delete: true,
})
function triggerProvider(name: string) {
  return zTriggerProviderApiEntity.parse({
    name,
    author: 'Team',
    label: { en_US: name },
    description: { en_US: 'Mail events' },
    supported_creation_methods: ['MANUAL'],
    events: [
      {
        name: 'received',
        identity: { author: 'Team', name: 'received', label: { en_US: `Message from ${name}` } },
        description: { en_US: 'A new message has arrived' },
        parameters: [],
        output_schema: { type: 'object', properties: { message: { type: 'string' } } },
      },
    ],
  })
}
const render = createNuqsTestRenderer((ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  return renderWithConsoleQuery(ui, {
    queryClient,
    workspacePermissionKeys: ['credential.use', 'credential.manage'],
    systemFeatures: { enable_marketplace: true },
  })
})
const onUpdate = vi.fn()
function Panel({
  detail: initial = createPluginDetail(),
  ...props
}: Partial<ComponentProps<typeof PluginDetailPanel>>) {
  const [detail, setDetail] = useState<PluginDetail | undefined>(initial)
  return (
    <PluginDetailPanel
      detail={detail}
      onHide={() => setDetail(undefined)}
      onUpdate={onUpdate}
      {...props}
    />
  )
}
async function openRemoval(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }))
  await user.click(
    await screen.findByRole('menuitem', { name: 'plugin.detailPanel.operation.remove' }),
  )
  return screen.findByRole('alertdialog')
}

beforeEach(() => {
  api.uninstall.mockReset().mockResolvedValue({ success: true })
  api.upgrade.mockReset().mockResolvedValue({ all_installed: true, task_id: '' })
  api.tools.mockReset().mockResolvedValue([tool])
  api.providers.mockReset().mockResolvedValue([provider])
  api.trigger.mockReset().mockImplementation(async ({ params }) => triggerProvider(params.provider))
  api.subscriptions.mockReset().mockResolvedValue([])
  api.credentials.mockReset().mockImplementation(async (url) => {
    if (!url.endsWith('/credential/info')) throw new Error(`Unexpected credential request: ${url}`)
    return {
      supported_credential_types: ['api-key'],
      is_oauth_custom_client_enabled: false,
      credentials: [
        {
          id: 'key-1',
          name: 'Workspace key',
          provider: provider.name,
          credential_type: 'api-key',
          is_default: true,
        },
      ],
    }
  })
})

it('loads the selected tool provider, opens its real read-only settings, and preserves the plugin panel on return', async () => {
  const user = userEvent.setup()
  render(<Panel />)
  await user.click(await screen.findByRole('button', { name: /plugin.auth.authorization/ }))
  const credentials = await screen.findByRole('dialog', { name: 'plugin.auth.authorizations' })
  expect(within(credentials).getByText('Workspace key')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /plugin.auth.authorization/ }))
  await waitFor(() => expect(credentials).not.toBeInTheDocument())
  await user.click(await screen.findByRole('button', { name: 'Search' }))
  expect(await screen.findByText('Query')).toBeInTheDocument()
  expect(api.tools).toHaveBeenCalledWith({ params: { provider: provider.name } })
  expect(api.credentials).toHaveBeenCalledWith(
    `/workspaces/current/tool-provider/builtin/${provider.name}/credential/info`,
  )
  expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.back' }))
  await waitFor(() => expect(screen.queryByText('Query')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
})

it('links to the plugin marketplace entry and closes the panel from its header', async () => {
  const user = userEvent.setup()
  render(<Panel />)
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }))
  const link = await screen.findByRole('menuitem', {
    name: 'plugin.detailPanel.operation.viewDetail',
  })
  expect(new URL(link.getAttribute('href')!, 'https://marketplace.example.test').pathname).toBe(
    '/plugins/test-author/test-plugin',
  )
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('upgrades through the confirmation dialog and refreshes its consumer without closing the panel', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<Awaited<ReturnType<typeof api.upgrade>>>()
  api.upgrade.mockReturnValueOnce(pending.promise)
  render(<Panel />)
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }))
  const dialog = await screen.findByRole('dialog', { name: 'plugin.upgrade.title' })
  expect(api.upgrade).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'plugin.upgrade.upgrade' }))
  expect(onUpdate).not.toHaveBeenCalled()
  expect(api.upgrade).toHaveBeenCalledWith({
    body: {
      original_plugin_unique_identifier: 'test-plugin-uid',
      new_plugin_unique_identifier: 'new-plugin-uid',
    },
  })
  await act(async () => pending.resolve({ all_installed: true, task_id: '' }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(onUpdate).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
})

it('allows retrying a failed upgrade without discarding the plugin panel', async () => {
  const user = userEvent.setup()
  api.upgrade.mockRejectedValueOnce(new Error('Upgrade failed'))
  render(<Panel />)
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }))
  const dialog = await screen.findByRole('dialog', { name: 'plugin.upgrade.title' })
  await user.click(within(dialog).getByRole('button', { name: 'plugin.upgrade.upgrade' }))
  expect(onUpdate).not.toHaveBeenCalled()
  await user.click(await within(dialog).findByRole('button', { name: 'plugin.upgrade.upgrade' }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(api.upgrade).toHaveBeenCalledTimes(2)
  expect(onUpdate).toHaveBeenCalledOnce()
})

it('requires confirmation before uninstalling, disables cancellation while pending, and closes after success', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<{ success: boolean }>()
  api.uninstall.mockReturnValueOnce(pending.promise)
  render(<Panel />)
  const dialog = await openRemoval(user)
  expect(api.uninstall).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
  expect(within(dialog).getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
  expect(onUpdate).not.toHaveBeenCalled()
  await act(async () => pending.resolve({ success: true }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(api.uninstall).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_installation_id: 'test-plugin-id', preserve_credentials: false },
  })
  expect(onUpdate).toHaveBeenCalledOnce()
})

it('keeps the uninstall confirmation available when the service declines removal', async () => {
  const user = userEvent.setup()
  api.uninstall.mockResolvedValueOnce({ success: false })
  render(<Panel />)
  const dialog = await openRemoval(user)
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'common.operation.cancel' })).toBeEnabled(),
  )
  expect(onUpdate).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
})

it.each([
  { canUpdatePlugin: false, canDeletePlugin: true },
  { canUpdatePlugin: true, canDeletePlugin: false },
])('respects independent update and deletion capabilities: %j', async (permissions) => {
  const user = userEvent.setup()
  render(<Panel {...permissions} />)
  const update = screen.queryByRole('button', { name: 'plugin.detailPanel.operation.update' })
  if (permissions.canUpdatePlugin) expect(update).toBeInTheDocument()
  else expect(update).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }))
  const menu = await screen.findByRole('menu')
  const remove = within(menu).queryByRole('menuitem', {
    name: 'plugin.detailPanel.operation.remove',
  })
  if (permissions.canDeletePlugin) expect(remove).toBeInTheDocument()
  else expect(remove).not.toBeInTheDocument()
})

it('switches the trigger provider with the selected plugin and opens the matching event details', async () => {
  const user = userEvent.setup()
  const first = createPluginDetail({
    category: PluginCategoryEnum.trigger,
    tool: undefined,
    name: 'mail',
  })
  const second = {
    ...first,
    plugin_id: 'second-plugin',
    declaration: { ...first.declaration, name: 'calendar' },
  }
  const { rerender } = render(
    <PluginDetailPanel detail={first} onUpdate={onUpdate} onHide={vi.fn()} />,
  )
  expect(
    await screen.findByRole('button', { name: 'Message from test-plugin-id/mail' }),
  ).toHaveAccessibleDescription('A new message has arrived')
  expect(api.subscriptions).toHaveBeenCalledWith({ params: { provider: 'test-plugin-id/mail' } })
  rerender(<PluginDetailPanel detail={second} onUpdate={onUpdate} onHide={vi.fn()} />)
  const event = await screen.findByRole('button', { name: 'Message from second-plugin/calendar' })
  expect(
    screen.queryByRole('button', { name: 'Message from test-plugin-id/mail' }),
  ).not.toBeInTheDocument()
  expect(api.trigger).toHaveBeenCalledWith({ params: { provider: 'second-plugin/calendar' } })
  event.focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByText('message')).toBeInTheDocument()
  expect(within(screen.getByRole('dialog')).getByText('calendar')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.back' }))
  await waitFor(() => expect(screen.queryByText('message')).not.toBeInTheDocument())
  expect(event).toBeInTheDocument()
  rerender(<PluginDetailPanel onUpdate={onUpdate} onHide={vi.fn()} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
