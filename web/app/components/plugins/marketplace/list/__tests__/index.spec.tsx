import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { ReactElement } from 'react'
import { screen } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { describe, expect, it, vi } from 'vite-plus/test'
import {
  createPluginInstallPermissionStore,
  PluginInstallPermissionContext,
} from '@/app/components/plugins/install-plugin/hooks/use-plugin-install-permission'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createMarketplacePluginFixture, createPluginEntity } from '@/test/fixtures/plugin'
import List from '../index'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': async () => ({
        plugins: [
          createPluginEntity({
            id: 'installed-plugin-id',
            plugin_id: 'dify/installed-plugin',
            plugin_unique_identifier: 'dify/installed-plugin:1.0.0@test',
          }),
        ],
      }),
    }),
  }
})

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

function renderList(ui: ReactElement) {
  const permissionStore = createPluginInstallPermissionStore({ canInstallPlugin: true })
  return renderWithConsoleQuery(
    <PluginInstallPermissionContext value={permissionStore}>
      <NuqsTestingAdapter>{ui}</NuqsTestingAdapter>
    </PluginInstallPermissionContext>,
    { systemFeatures: { deployment_edition: 'CLOUD' } },
  )
}

describe('List', () => {
  it('renders a real collection and its plugin card when search results are absent', () => {
    renderList(<List {...baseProps} />)

    expect(screen.getByText('Featured plugins')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Featured plugin' })).toBeInTheDocument()
  })

  it('renders the marketplace empty state for an empty search result', () => {
    renderList(<List {...baseProps} plugins={[]} />)

    expect(screen.getByText('plugin.marketplace.noPluginFound')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Featured plugin' })).not.toBeInTheDocument()
  })

  it('distinguishes an installed plugin from one that can be installed', async () => {
    const installedPlugin = createMarketplacePluginFixture({
      plugin_id: 'dify/installed-plugin',
      name: 'installed-plugin',
      label: { en_US: 'Installed plugin' },
    })
    const availablePlugin = createMarketplacePluginFixture({
      plugin_id: 'dify/available-plugin',
      name: 'available-plugin',
      label: { en_US: 'Available plugin' },
    })

    renderList(
      <List {...baseProps} plugins={[installedPlugin, availablePlugin]} showInstallButton />,
    )

    expect(await screen.findByRole('button', { name: 'plugin.task.installed' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'plugin.detailPanel.operation.install' }),
    ).toBeEnabled()
  })
})
