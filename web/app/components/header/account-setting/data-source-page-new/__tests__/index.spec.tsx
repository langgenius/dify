import type { DatasourceProviderAuthResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { PluginDetail } from '@/app/components/plugins/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTheme } from 'next-themes'
import { usePluginsWithLatestVersion } from '@/app/components/plugins/hooks'
import { usePluginAuthAction } from '@/app/components/plugins/plugin-auth'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { consoleQuery } from '@/service/console'
import {
  useCheckInstalled,
  useInstalledPluginList,
  useInvalidateInstalledPluginList,
} from '@/service/use-plugins'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { useDataSourceAuthUpdate, useMarketplaceAllPlugins } from '../hooks'
import DataSourcePage from '../index'

vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: vi.fn(),
}))

const { mockDataSourceListAuth } = vi.hoisted(() => ({ mockDataSourceListAuth: vi.fn() }))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'auth.plugin.datasource.list.get': () => mockDataSourceListAuth(),
    }),
  }
})

vi.mock('@/service/use-plugins', () => ({
  useCheckInstalled: vi.fn(),
  useInstalledPluginList: vi.fn(),
  useInvalidateInstalledPluginList: vi.fn(),
}))

vi.mock('@/app/components/plugins/hooks', () => ({
  usePluginsWithLatestVersion: vi.fn(),
}))

vi.mock('../plugin-actions', () => ({
  default: ({ detail, onUpdate }: { detail: { plugin_id: string }; onUpdate?: () => void }) => (
    <button data-testid={`plugin-actions-${detail.plugin_id}`} onClick={onUpdate}>
      Actions
    </button>
  ),
}))

vi.mock('../hooks', () => ({
  useDataSourceAuthUpdate: vi.fn(),
  useMarketplaceAllPlugins: vi.fn(),
}))

vi.mock('@/app/components/plugins/plugin-auth', () => ({
  usePluginAuthAction: vi.fn(),
  ApiKeyModal: () => <div data-testid="mock-api-key-modal" />,
  AuthCategory: { datasource: 'datasource' },
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  useCanSetPluginSettings: () => ({
    canSetPermissions: true,
    canSetPluginPreferences: true,
  }),
  usePluginSettingsAccess: () => ({
    canSetPermissions: true,
    canSetPluginPreferences: true,
  }),
  default: () => ({
    canSetPermissions: true,
    canSetPluginPreferences: true,
  }),
}))

vi.mock('@/app/components/header/account-setting/update-setting-dialog', () => ({
  UpdateSettingDialog: () => (
    <button type="button" aria-label="plugin.autoUpdate.autoUpdate">
      plugin.autoUpdate.autoUpdate
    </button>
  ),
}))

describe('DataSourcePage Component', () => {
  const mockProviders: DatasourceProviderAuthResponse[] = [
    {
      author: 'Dify',
      provider: 'dify',
      plugin_id: 'plugin-1',
      plugin_unique_identifier: 'unique-1',
      icon: 'icon-1',
      name: 'Dify Source',
      label: { en_US: 'Dify Source', zh_Hans: 'zh_hans_dify_source' },
      description: { en_US: 'Dify Description', zh_Hans: 'zh_hans_dify_description' },
      credential_schema: [],
      oauth_schema: null,
      credentials_list: [],
    },
    {
      author: 'Partner',
      provider: 'partner',
      plugin_id: 'plugin-2',
      plugin_unique_identifier: 'unique-2',
      icon: 'icon-2',
      name: 'Partner Source',
      label: { en_US: 'Partner Source', zh_Hans: 'zh_hans_partner_source' },
      description: { en_US: 'Partner Description', zh_Hans: 'zh_hans_partner_description' },
      credential_schema: [],
      oauth_schema: null,
      credentials_list: [],
    },
  ]
  const mockPluginDetail = {
    id: 'installation-id-1',
    created_at: '',
    updated_at: '',
    name: 'Dify Source',
    plugin_id: 'plugin-1',
    plugin_unique_identifier: 'unique-1',
    declaration: {
      plugin_unique_identifier: 'unique-1',
      version: '1.0.0',
      author: 'Dify',
      icon: 'icon-1',
      name: 'Dify Source',
      category: 'datasource',
      label: { en_US: 'Dify Source', zh_Hans: 'zh_hans_dify_source' },
      description: { en_US: 'Dify Description', zh_Hans: 'zh_hans_dify_description' },
      created_at: '',
      resource: {},
      plugins: {},
      verified: false,
      endpoint: undefined,
      model: undefined,
      tags: [],
      agent_strategy: undefined,
      trigger: undefined,
      datasource: {
        provider_type: 'online_document',
        identity: {
          author: 'Dify',
          name: 'Dify Source',
          description: { en_US: 'Dify Description', zh_Hans: 'zh_hans_dify_description' },
          icon: 'icon-1',
          label: { en_US: 'Dify Source', zh_Hans: 'zh_hans_dify_source' },
          tags: [],
        },
        credentials_schema: [],
      },
      meta: {
        version: '1.0.0',
      },
    },
    installation_id: 'installation-id-1',
    tenant_id: 'tenant-id',
    endpoints_setups: 0,
    endpoints_active: 0,
    version: '1.0.0',
    latest_version: '1.2.0',
    latest_unique_identifier: 'unique-1-new',
    source: 'marketplace',
    status: 'active',
    deprecated_reason: '',
    alternative_plugin_id: '',
  } as unknown as PluginDetail

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useTheme).mockReturnValue({ theme: 'light' } as unknown as ReturnType<
      typeof useTheme
    >)
    vi.mocked(useRenderI18nObject).mockReturnValue((obj) => obj?.en_US || '')
    vi.mocked(useInstalledPluginList).mockReturnValue({
      data: { plugins: [], total: 0 },
    } as unknown as ReturnType<typeof useInstalledPluginList>)
    vi.mocked(useCheckInstalled).mockReturnValue({
      data: { plugins: [] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useCheckInstalled>)
    vi.mocked(usePluginsWithLatestVersion).mockImplementation((plugins = []) => plugins)
    vi.mocked(useInvalidateInstalledPluginList).mockReturnValue(vi.fn())
    vi.mocked(useDataSourceAuthUpdate).mockReturnValue({ handleAuthUpdate: vi.fn() })
    vi.mocked(useMarketplaceAllPlugins).mockReturnValue({ plugins: [], isLoading: false })
    vi.mocked(usePluginAuthAction).mockReturnValue({
      deleteCredentialId: null,
      doingAction: false,
      handleConfirm: vi.fn(),
      handleEdit: vi.fn(),
      handleRemove: vi.fn(),
      handleRename: vi.fn(),
      handleSetDefault: vi.fn(),
      editValues: null,
      setEditValues: vi.fn(),
      openConfirm: vi.fn(),
      closeConfirm: vi.fn(),
      pendingOperationCredentialId: { current: null },
    } as unknown as ReturnType<typeof usePluginAuthAction>)
  })

  describe('Initial View Rendering', () => {
    it('should render an empty view when no data is available and marketplace is disabled', async () => {
      mockDataSourceListAuth.mockResolvedValue({ result: [] })

      renderWithConsoleQuery(<DataSourcePage stickyToolbar />, {
        systemFeatures: { enable_marketplace: false },
      })

      expect(await screen.findByText('common.dataSourcePage.installFirst')).toBeInTheDocument()

      expect(screen.getByPlaceholderText('common.operation.search')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'plugin.autoUpdate.autoUpdate' }),
      ).toBeInTheDocument()
      expect(screen.queryByText('Dify Source')).not.toBeInTheDocument()
      expect(screen.getByText('common.dataSourcePage.notSetUpTitle')).toBeInTheDocument()
      expect(screen.getByText('common.dataSourcePage.installFirst')).toBeInTheDocument()
      expect(
        screen.queryByText('modelProvider.modelProvider.installDataSource'),
      ).not.toBeInTheDocument()
    })

    it('should show data source placeholders while the list is loading', () => {
      mockDataSourceListAuth.mockReturnValue(new Promise(() => {}))

      renderWithConsoleQuery(<DataSourcePage stickyToolbar />, {
        systemFeatures: { enable_marketplace: true },
      })

      expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
      expect(screen.queryByText('common.dataSourcePage.notSetUpTitle')).not.toBeInTheDocument()
      expect(
        screen.queryByText('modelProvider.modelProvider.installDataSource'),
      ).not.toBeInTheDocument()
    })
  })

  describe('Data Source List Rendering', () => {
    it('should map installed plugin operations onto the data source card header', async () => {
      mockDataSourceListAuth.mockResolvedValue({ result: mockProviders })
      vi.mocked(useInstalledPluginList).mockReturnValue({
        data: { plugins: [mockPluginDetail], total: 1 },
      } as unknown as ReturnType<typeof useInstalledPluginList>)

      const { queryClient } = renderWithConsoleQuery(<DataSourcePage />, {
        systemFeatures: { enable_marketplace: false },
      })

      expect(await screen.findByText('Dify Source')).toBeInTheDocument()

      const catalogKey = consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey()
      queryClient.setQueryData(catalogKey, [])
      await userEvent.setup().click(screen.getByTestId('plugin-actions-plugin-1'))
      expect(queryClient.getQueryState(catalogKey)?.isInvalidated).toBe(true)

      expect(screen.getByTestId('plugin-actions-plugin-1')).toBeInTheDocument()
      expect(useInstalledPluginList).toHaveBeenLastCalledWith({
        category: PluginCategoryEnum.datasource,
      })
    })

    it('should filter installed data sources and pass search text to marketplace', async () => {
      mockDataSourceListAuth.mockResolvedValue({ result: mockProviders })

      renderWithConsoleQuery(<DataSourcePage />, {
        systemFeatures: { enable_marketplace: true },
      })

      expect(await screen.findByText('Dify Source')).toBeInTheDocument()
      await userEvent.setup().type(screen.getByRole('searchbox'), 'partner')

      expect(screen.queryByText('Dify Source')).not.toBeInTheDocument()
      expect(screen.getByText('Partner Source')).toBeInTheDocument()
      expect(useMarketplaceAllPlugins).toHaveBeenLastCalledWith(mockProviders, 'partner')
    })

    it('announces the filtered installed data source count while searching', async () => {
      mockDataSourceListAuth.mockResolvedValue({ result: mockProviders })
      const user = userEvent.setup()
      renderWithConsoleQuery(<DataSourcePage />, {
        systemFeatures: { enable_marketplace: false },
      })

      expect(await screen.findByText('Dify Source')).toBeInTheDocument()

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      await user.type(screen.getByRole('searchbox'), 'partner')
      expect(screen.getByRole('status')).toHaveTextContent(
        'plugin.category.datasources: plugin.marketplace.pluginsResult:{"num":1}',
      )
      await user.clear(screen.getByRole('searchbox'))
      await user.type(screen.getByRole('searchbox'), 'missing')
      expect(screen.getByRole('status')).toHaveTextContent(
        'plugin.category.datasources: plugin.marketplace.pluginsResult:{"num":0}',
      )
    })
  })

  describe('Marketplace Integration', () => {
    it('should render the InstallFromMarketplace component when enable_marketplace feature is enabled', async () => {
      mockDataSourceListAuth.mockResolvedValue({ result: mockProviders })

      renderWithConsoleQuery(<DataSourcePage />, {
        systemFeatures: { enable_marketplace: true },
      })

      expect(await screen.findByText('Dify Source')).toBeInTheDocument()

      expect(screen.getByText('modelProvider.modelProvider.installDataSource')).toBeInTheDocument()
      expect(screen.getByText('modelProvider.modelProvider.discoverMore')).toBeInTheDocument()
    })

    it('should handle the case where data exists but result is an empty array', async () => {
      mockDataSourceListAuth.mockResolvedValue({ result: [] })

      renderWithConsoleQuery(<DataSourcePage />, {
        systemFeatures: { enable_marketplace: true },
      })

      expect(await screen.findByText('common.dataSourcePage.installFirst')).toBeInTheDocument()

      expect(screen.queryByText('Dify Source')).not.toBeInTheDocument()
      expect(screen.getByText('modelProvider.modelProvider.installDataSource')).toBeInTheDocument()
    })
  })
})
