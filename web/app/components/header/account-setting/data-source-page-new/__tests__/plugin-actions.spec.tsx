import type { PluginDetail } from '@/app/components/plugins/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReadmePanelStore } from '@/app/components/plugins/readme-panel/store'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import DataSourcePluginActions from '../plugin-actions'

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'plugin-installation-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Data Source Plugin',
  plugin_id: 'datasource-plugin',
  plugin_unique_identifier: 'datasource-plugin:1.0.0@checksum',
  declaration: {
    author: 'acme',
    category: PluginCategoryEnum.datasource,
    name: 'datasource-provider',
    label: { en_US: 'Data Source Plugin' },
    description: { en_US: 'Data Source description' },
    icon: 'icon.png',
    tags: [],
    datasource: {
      provider_type: 'online_document',
      identity: {
        author: 'acme',
        name: 'datasource-provider',
        label: { en_US: 'Data Source Plugin' },
        description: { en_US: 'Data Source description' },
        icon: 'icon.png',
        tags: [],
      },
      credentials_schema: [],
    },
  } as unknown as PluginDetail['declaration'],
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'datasource-plugin:1.0.0@checksum',
  source: PluginSource.marketplace,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

const renderActions: typeof renderWithConsoleQuery = (ui, options) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(['plugins', 'referenceSettings', 'permission'], {
    install_permission: 'everyone',
    debug_permission: 'everyone',
  })
  queryClient.setQueryData(
    ['plugins', 'referenceSettings', 'autoUpgrade', PluginCategoryEnum.datasource],
    {
      category: PluginCategoryEnum.datasource,
      auto_upgrade: {
        strategy_setting: 'disabled',
        upgrade_mode: 'all',
        upgrade_time_of_day: 0,
        include_plugins: [],
        exclude_plugins: [],
      },
    },
  )
  for (const model_type of ['llm', 'text-embedding', 'rerank', 'speech2text', 'tts'] as const) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type } },
      }),
      { data: [] },
    )
  }
  return renderWithConsoleQuery(ui, { ...options, queryClient })
}

describe('DataSourcePluginActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the plugin README from the actions menu', async () => {
    const user = userEvent.setup()
    const detail = createPluginDetail()

    renderActions(<DataSourcePluginActions detail={detail} />, {
      systemFeatures: { enable_marketplace: true },
    })
    await user.click(
      screen.getByRole('button', {
        name: 'common.operation.moreActionsFor:{"name":"Data Source Plugin"}',
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'plugin.detailPanel.operation.viewReadme' }),
    )

    expect(useReadmePanelStore.getState().currentPanel).toEqual(
      expect.objectContaining({
        detail,
        presentation: 'drawer',
        triggerId: expect.any(String),
      }),
    )
  })

  it('identifies the plugin and current version in the version action', () => {
    renderActions(<DataSourcePluginActions detail={createPluginDetail()} />, {
      systemFeatures: { enable_marketplace: true },
    })

    expect(
      screen.getByRole('button', {
        name: 'plugin.detailPanel.switchVersion Data Source Plugin 1.0.0',
      }),
    ).toBeInTheDocument()
  })
})
