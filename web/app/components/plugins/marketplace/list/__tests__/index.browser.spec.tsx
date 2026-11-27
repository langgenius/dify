import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  createPluginInstallPermissionStore,
  PluginInstallPermissionContext,
} from '@/app/components/plugins/install-plugin/hooks/use-plugin-install-permission'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { installFakeApi } from '@/test/fake-api'
import { createMarketplacePluginFixture, createPluginEntity } from '@/test/fixtures/plugin'
import List from '../index'

// A contract-valid manifest for the marketplace package the installer reads.
const manifest = {
  author: 'Dify',
  category: 'tool' as const,
  created_at: '2026-06-01T00:00:00Z',
  description: { en_US: 'Plugin description' },
  icon: 'icon.svg',
  label: { en_US: 'Plugin label' },
  meta: { version: '1.0.0' },
  name: 'plugin-entity',
  plugins: {},
  resource: { memory: 0 },
  tags: [],
  version: '1.0.0',
}
const collection: MarketplaceCollection = {
  name: 'featured',
  label: { en_US: 'Featured plugins' },
  description: { en_US: 'A curated collection' },
  rule: 'featured',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  searchable: false,
  search_params: {},
}
const featuredPlugin = createMarketplacePluginFixture({
  plugin_id: 'dify/featured-plugin',
  name: 'featured-plugin',
  label: { en_US: 'Featured plugin' },
})
const baseProps = {
  marketplaceCollections: [collection],
  marketplaceCollectionPluginsMap: { featured: [featuredPlugin] },
}

async function renderList(
  plugins?: ReturnType<typeof createMarketplacePluginFixture>[],
  showInstallButton = false,
) {
  await page.viewport(1280, 900)
  onTestFinished(
    installFakeApi({
      console: {
        workspaces: {
          current: {
            plugin: {
              list: {
                installations: {
                  ids: {
                    post: () => ({
                      plugins: [
                        createPluginEntity({
                          id: 'installed-plugin-id',
                          plugin_id: 'dify/installed-plugin',
                          plugin_unique_identifier: 'dify/installed-plugin:1.0.0@test',
                        }),
                      ],
                    }),
                  },
                },
              },
              marketplace: {
                pkg: {
                  get: () => ({ manifest }),
                },
              },
              tasks: { get: () => ({ tasks: [] }) },
              permission: {
                fetch: {
                  get: () => ({ install_permission: 'everyone', debug_permission: 'everyone' }),
                },
              },
            },
          },
        },
      },
    }),
  )
  const { queryClient, wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  seedModelProviderQueries(queryClient)
  const permissions = createPluginInstallPermissionStore({ canInstallPlugin: true })
  return render(
    <ConsoleProvider>
      <PluginInstallPermissionContext value={permissions}>
        <NuqsTestingAdapter>
          <List {...baseProps} plugins={plugins} showInstallButton={showInstallButton} />
        </NuqsTestingAdapter>
      </PluginInstallPermissionContext>
    </ConsoleProvider>,
  )
}

it('replaces collection cards with the empty state when a search has no matches', async () => {
  const screen = await renderList([])
  await expect.element(screen.getByText('plugin.marketplace.noPluginFound')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Featured plugin' }))
    .not.toBeInTheDocument()
})

it('uses the installed-plugin response to prevent reinstallation while an available plugin opens the real installer', async () => {
  const screen = await renderList(
    [
      createMarketplacePluginFixture({
        plugin_id: 'dify/installed-plugin',
        name: 'installed-plugin',
        label: { en_US: 'Installed plugin' },
      }),
      createMarketplacePluginFixture({
        plugin_id: 'dify/available-plugin',
        name: 'available-plugin',
        label: { en_US: 'Available plugin' },
      }),
    ],
    true,
  )
  await screen
    .getByRole('button', { name: 'Installed plugin', exact: true })
    .hover({ position: { x: 20, y: 20 } })
  await expect
    .element(screen.getByRole('button', { name: 'plugin.task.installed', exact: true }))
    .toBeDisabled()
  await screen
    .getByRole('button', { name: 'Available plugin', exact: true })
    .hover({ position: { x: 20, y: 20 } })
  await screen
    .getByRole('button', { name: 'plugin.detailPanel.operation.install', exact: true })
    .click()
  await expect
    .element(screen.getByRole('dialog', { name: 'plugin.installModal.installPlugin' }))
    .toBeVisible()
})
