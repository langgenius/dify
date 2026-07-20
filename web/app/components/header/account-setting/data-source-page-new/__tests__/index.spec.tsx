import type { UseQueryResult } from '@tanstack/react-query'
import type { DataSourceAuth } from '../types'
import type { PluginDetail } from '@/app/components/plugins/types'
import { fireEvent, screen } from '@testing-library/react'
import { useTheme } from 'next-themes'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { usePluginsWithLatestVersion } from '@/app/components/plugins/hooks'
import { usePluginAuthAction } from '@/app/components/plugins/plugin-auth'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import {
  useGetDataSourceListAuth,
  useGetDataSourceOAuthUrl,
  useInvalidDataSourceListAuth,
} from '@/service/use-datasource'
import { useInvalidDataSourceList } from '@/service/use-pipeline'
import {
  useCheckInstalled,
  useInstalledPluginList,
  useInvalidateInstalledPluginList,
} from '@/service/use-plugins'
import { useDataSourceAuthUpdate, useMarketplaceAllPlugins } from '../hooks'
import DataSourcePage from '../index'

/**
 * DataSourcePage Component Tests
 * Using Unit approach to focus on page-level layout and conditional rendering.
 */

// Mock external dependencies
vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: vi.fn(),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceListAuth: vi.fn(),
  useGetDataSourceOAuthUrl: vi.fn(),
  useInvalidDataSourceListAuth: vi.fn(),
}))

vi.mock('@/service/use-pipeline', () => ({
  useInvalidDataSourceList: vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  useCheckInstalled: vi.fn(),
  useInstalledPluginList: vi.fn(),
  useInvalidateInstalledPluginList: vi.fn(),
}))

vi.mock('@/app/components/plugins/hooks', () => ({
  usePluginsWithLatestVersion: vi.fn(),
}))

vi.mock('../plugin-actions', () => ({
  default: ({ detail }: { detail: { plugin_id: string } }) => (
    <button data-testid={`plugin-actions-${detail.plugin_id}`}>Actions</button>
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
  __esModule: true,
  default: () => (
    <button type="button">
      plugin.autoUpdate.autoUpdate
      <span>plugin.autoUpdate.strategy.fixOnly.name</span>
    </button>
  ),
}))

describe('DataSourcePage Component', () => {
  const mockProviders: DataSourceAuth[] = [
    {
      author: 'Dify',
      provider: 'dify',
      plugin_id: 'plugin-1',
      plugin_unique_identifier: 'unique-1',
      icon: 'icon-1',
      name: 'Dify Source',
      label: { en_US: 'Dify Source', zh_Hans: 'zh_hans_dify_source' },
      description: { en_US: 'Dify Description', zh_Hans: 'zh_hans_dify_description' },
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
    vi.mocked(useRenderI18nObject).mockReturnValue(
      (obj: Record<string, string>) => obj?.en_US || '',
    )
    vi.mocked(useGetDataSourceOAuthUrl).mockReturnValue({
      mutateAsync: vi.fn(),
    } as unknown as ReturnType<typeof useGetDataSourceOAuthUrl>)
    vi.mocked(useInvalidDataSourceListAuth).mockReturnValue(vi.fn())
    vi.mocked(useInvalidDataSourceList).mockReturnValue(vi.fn())
    vi.mocked(useInstalledPluginList).mockReturnValue({
      data: { plugins: [], total: 0 },
    } as unknown as ReturnType<typeof useInstalledPluginList>)
    vi.mocked(useCheckInstalled).mockReturnValue({
      data: { plugins: [] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useCheckInstalled>)
    vi.mocked(usePluginsWithLatestVersion).mockImplementation(
      (plugins = []) => plugins as PluginDetail[],
    )
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
    it('should render an empty view when no data is available and marketplace is disabled', () => {
      // Arrange
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: { result: [] },
        isLoading: false,
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      renderWithSystemFeatures(<DataSourcePage stickyToolbar />, {
        systemFeatures: { enable_marketplace: false },
      })

      // Assert
      expect(screen.getByPlaceholderText('common.operation.search')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('common.operation.search').closest('.sticky')).toHaveClass(
        'top-0',
        'z-10',
        '-mx-6',
        'bg-components-panel-bg',
        'px-6',
        'pb-2',
      )
      expect(screen.getByText('plugin.autoUpdate.autoUpdate')).toBeInTheDocument()
      expect(screen.getAllByText('plugin.autoUpdate.strategy.fixOnly.name')[0]).toBeInTheDocument()
      expect(screen.queryByText('Dify Source')).not.toBeInTheDocument()
      expect(screen.getByText('common.dataSourcePage.notSetUpTitle')).toBeInTheDocument()
      expect(screen.getByText('common.dataSourcePage.installFirst')).toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.installDataSource')).not.toBeInTheDocument()
    })

    it('should show data source placeholders while the list is loading', () => {
      // Arrange
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      renderWithSystemFeatures(<DataSourcePage stickyToolbar />, {
        systemFeatures: { enable_marketplace: true },
      })

      // Assert
      expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
      expect(screen.queryByText('dataSourcePage.notSetUpTitle')).not.toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.installDataSource')).not.toBeInTheDocument()
    })
  })

  describe('Data Source List Rendering', () => {
    it('should render Card components for each data source returned from the API', () => {
      // Arrange
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: { result: mockProviders },
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      renderWithSystemFeatures(<DataSourcePage />, {
        systemFeatures: { enable_marketplace: false },
      })

      // Assert
      expect(screen.getByPlaceholderText('common.operation.search')).toBeInTheDocument()
      expect(screen.getByText('Dify Source')).toBeInTheDocument()
      expect(screen.getByText('Partner Source')).toBeInTheDocument()
    })

    it('should map installed plugin operations onto the data source card header', () => {
      // Arrange
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: { result: mockProviders },
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)
      vi.mocked(useInstalledPluginList).mockReturnValue({
        data: { plugins: [mockPluginDetail], total: 1 },
      } as unknown as ReturnType<typeof useInstalledPluginList>)

      // Act
      renderWithSystemFeatures(<DataSourcePage />, {
        systemFeatures: { enable_marketplace: false },
      })

      // Assert
      expect(screen.getByTestId('plugin-actions-plugin-1')).toBeInTheDocument()
    })

    it('should filter installed data sources and pass search text to marketplace', () => {
      // Arrange
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: { result: mockProviders },
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      renderWithSystemFeatures(<DataSourcePage />, {
        systemFeatures: { enable_marketplace: true },
      })
      fireEvent.change(screen.getByPlaceholderText('common.operation.search'), {
        target: { value: 'partner' },
      })

      // Assert
      expect(screen.queryByText('Dify Source')).not.toBeInTheDocument()
      expect(screen.getByText('Partner Source')).toBeInTheDocument()
      expect(useMarketplaceAllPlugins).toHaveBeenLastCalledWith(mockProviders, 'partner')
    })
  })

  describe('Marketplace Integration', () => {
    it('should render the InstallFromMarketplace component when enable_marketplace feature is enabled', () => {
      // Arrange
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: { result: mockProviders },
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      renderWithSystemFeatures(<DataSourcePage />, {
        systemFeatures: { enable_marketplace: true },
      })

      // Assert
      expect(screen.getByText('common.modelProvider.installDataSource')).toBeInTheDocument()
      expect(screen.getByText('common.modelProvider.discoverMore')).toBeInTheDocument()
    })

    it('should pass an empty array to InstallFromMarketplace if data result is missing but marketplace is enabled', () => {
      // Arrange
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: undefined,
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      renderWithSystemFeatures(<DataSourcePage />, {
        systemFeatures: { enable_marketplace: true },
      })

      // Assert
      expect(screen.getByText('common.modelProvider.installDataSource')).toBeInTheDocument()
    })

    it('should handle the case where data exists but result is an empty array', () => {
      // Arrange
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: { result: [] },
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      renderWithSystemFeatures(<DataSourcePage />, {
        systemFeatures: { enable_marketplace: true },
      })

      // Assert
      expect(screen.queryByText('Dify Source')).not.toBeInTheDocument()
      expect(screen.getByText('common.modelProvider.installDataSource')).toBeInTheDocument()
    })

    it('should handle the case where enable_marketplace is false (edge case for coverage)', () => {
      // Arrange
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: { result: [] },
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      renderWithSystemFeatures(<DataSourcePage />, {
        systemFeatures: { enable_marketplace: false },
      })

      // Assert
      expect(screen.queryByText('common.modelProvider.installDataSource')).not.toBeInTheDocument()
    })
  })
})
