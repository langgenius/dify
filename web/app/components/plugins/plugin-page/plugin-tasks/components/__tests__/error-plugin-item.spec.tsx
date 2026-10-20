import type { PluginInfoFromMarketPlace } from '@dify/contracts/marketplace'
import type { PluginStatus } from '@/app/components/plugins/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  PermissionType,
  PluginCategoryEnum,
  PluginSource,
  TaskStatus,
} from '@/app/components/plugins/types'
import { fetchPluginInfoFromMarketPlace } from '@/service/plugins'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import ErrorPluginItem from '../error-plugin-item'

const { install, refresh } = vi.hoisted(() => ({ install: vi.fn(), refresh: vi.fn() }))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  fetchPluginInfoFromMarketPlace: vi.fn(),
}))
vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: refresh }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: PermissionType.everyone,
        debug_permission: PermissionType.everyone,
      }),
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.marketplace.pkg.get': async () => ({
        manifest: createPluginDeclarationFixture(),
      }),
      'workspaces.current.plugin.install.marketplace.post': install,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
    }),
  }
})

vi.mock(
  '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission',
  () => ({
    default: () => ({
      canInstallPlugin: true,
      currentDifyVersion: '1.0.0',
    }),
  }),
)

const mockFetch = vi.mocked(fetchPluginInfoFromMarketPlace)
const mockGetIconUrl = vi.fn((icon: string) => `https://icons/${icon}`)

function createMarketplaceResponse(identifier: string, version: string) {
  return {
    data: {
      plugin: {
        category: PluginCategoryEnum.tool,
        latest_package_identifier: identifier,
        latest_version: version,
      } satisfies PluginInfoFromMarketPlace,
      version: { version },
    },
  }
}

const createPlugin = (overrides: Partial<PluginStatus> = {}): PluginStatus => ({
  plugin_unique_identifier: 'org/plugin:1.0.0',
  plugin_id: 'org/plugin',
  source: PluginSource.marketplace,
  status: TaskStatus.failed,
  message: '',
  icon: 'icon.png',
  labels: { en_US: 'Test Plugin' } as PluginStatus['labels'],
  taskId: 'task-1',
  ...overrides,
})

describe('ErrorPluginItem', () => {
  const renderError = (overrides: Partial<PluginStatus> = {}) => {
    const onClear = vi.fn()
    renderWithConsoleQuery(
      <ErrorPluginItem
        plugin={createPlugin(overrides)}
        getIconUrl={mockGetIconUrl}
        language="en_US"
        onClear={onClear}
      />,
      { systemFeatures: { enable_marketplace: true } },
    )
    return { onClear }
  }
  const retry = () => screen.getByRole('button', { name: 'plugin.task.installFromMarketplace' })

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue(createMarketplaceResponse('org/plugin:2.0.0', '2.0.0'))
    install.mockResolvedValue({ all_installed: true, task_id: '' })
  })

  it.each([
    [PluginSource.marketplace, 'org/plugin', 'marketplace', 'plugin.task.installFromMarketplace'],
    [PluginSource.github, 'org/plugin', 'github', 'plugin.task.installFromGithub'],
    [
      PluginSource.github,
      'https://github.com/user/repo',
      'github',
      'plugin.task.installFromGithub',
    ],
    [PluginSource.local, 'my-github-plugin', 'unknown', null],
    [PluginSource.debugging, 'remote-plugin', 'unknown', null],
  ] as const)(
    'derives the error and retry action from %s, not the id %s',
    (source, plugin_id, message, action) => {
      renderError({ source, plugin_id })
      expect(screen.getByText('Test Plugin')).toBeInTheDocument()
      expect(screen.getByText(`plugin.task.errorMsg.${message}`)).toBeInTheDocument()
      if (action) expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
      else
        expect(
          screen.queryByRole('button', { name: /plugin.task.installFrom/ }),
        ).not.toBeInTheDocument()
    },
  )

  it('shows the server error and lets the user clear the failed task', async () => {
    const user = userEvent.setup()
    const { onClear } = renderError({ message: 'Custom error occurred' })
    expect(screen.getByText('Custom error occurred')).toBeInTheDocument()
    expect(screen.queryByText('plugin.task.errorMsg.marketplace')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear Test Plugin' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('opens the latest marketplace version and cancels without clearing the error', async () => {
    const user = userEvent.setup()
    const { onClear } = renderError()
    await user.click(retry())
    await screen.findByRole('dialog', { name: 'plugin.installModal.installPlugin' })
    expect(mockFetch).toHaveBeenCalledExactlyOnceWith({ org: 'org', name: 'plugin' })
    expect(screen.getByText('2.0.0')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onClear).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
  })

  it('installs the latest version before clearing the completed error item', async () => {
    const user = userEvent.setup()
    const { onClear } = renderError()
    await user.click(retry())
    await user.click(await screen.findByRole('button', { name: 'plugin.installModal.install' }))
    await screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' })
    expect(install).toHaveBeenCalledExactlyOnceWith({
      body: { plugin_unique_identifiers: ['org/plugin:2.0.0'] },
    })
    expect(onClear).not.toHaveBeenCalled()
    await user.click(screen.getByText('common.operation.close'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('keeps the failed task retryable after a marketplace lookup failure', async () => {
    const user = userEvent.setup()
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    const { onClear } = renderError()
    await user.click(retry())
    await waitFor(() => expect(retry()).toBeEnabled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onClear).not.toHaveBeenCalled()
    await user.click(retry())
    await screen.findByRole('dialog', { name: 'plugin.installModal.installPlugin' })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('does not request an invalid marketplace identifier', async () => {
    const user = userEvent.setup()
    renderError({ plugin_id: 'single-part' })
    await user.click(retry())
    expect(mockFetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
