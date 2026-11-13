import type { Dependency } from '@/app/components/plugins/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PermissionType } from '@/app/components/plugins/types'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import PluginDependency from '../index'
import { useStore } from '../store'

const marketplace = vi.hoisted(() => vi.fn())
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  postMarketplace: marketplace,
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
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
    }),
  }
})
// Catalog refresh is outside cancellation of the dependency installation dialog.
vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: vi.fn() }),
}))

const dependency: Dependency = {
  type: 'marketplace',
  value: { marketplace_plugin_unique_identifier: 'langgenius/sample-plugin:1.0.0' },
}

describe('plugin-dependency', () => {
  beforeEach(() => {
    useStore.setState({ dependencies: [] })
    marketplace.mockReset().mockReturnValue(new Promise(() => {}))
  })

  it('opens for new dependencies and clears them when the installation is cancelled', async () => {
    const user = userEvent.setup()
    const onInstallComplete = vi.fn()
    renderWithConsoleQuery(<PluginDependency onInstallComplete={onInstallComplete} />, {
      workspacePermissionKeys: ['plugin.install'],
      systemFeatures: {
        enable_marketplace: true,
        rbac_enabled: true,
        plugin_installation_permission: {
          plugin_installation_scope: 'all',
          restrict_to_marketplace_only: false,
        },
      },
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => useStore.getState().setDependencies([dependency]))
    expect(
      await screen.findByRole('dialog', { name: 'plugin.installModal.installPlugin' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useStore.getState().dependencies).toEqual([])
    expect(onInstallComplete).not.toHaveBeenCalled()
  })
})
