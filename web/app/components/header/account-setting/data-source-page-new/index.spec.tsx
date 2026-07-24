import type { UseQueryResult } from '@tanstack/react-query'
import type { DataSourceAuth } from './types'
import { render, screen } from '@testing-library/react'
import { useTheme } from 'next-themes'
import { usePluginAuthAction } from '@/app/components/plugins/plugin-auth'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { useGetDataSourceListAuth, useGetDataSourceOAuthUrl } from '@/service/use-datasource'
import { defaultSystemFeatures } from '@/types/feature'
import { useDataSourceAuthUpdate, useMarketplaceAllPlugins } from './hooks'
import DataSourcePage from './index'

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

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceListAuth: vi.fn(),
  useGetDataSourceOAuthUrl: vi.fn(),
}))

vi.mock('./hooks', () => ({
  useDataSourceAuthUpdate: vi.fn(),
  useMarketplaceAllPlugins: vi.fn(),
}))

vi.mock('@/app/components/plugins/plugin-auth', () => ({
  usePluginAuthAction: vi.fn(),
  ApiKeyModal: () => <div data-testid="mock-api-key-modal" />,
  AuthCategory: { datasource: 'datasource' },
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

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useTheme).mockReturnValue({ theme: 'light' } as unknown as ReturnType<typeof useTheme>)
    vi.mocked(useRenderI18nObject).mockReturnValue((obj: Record<string, string>) => obj?.en_US || '')
    vi.mocked(useGetDataSourceOAuthUrl).mockReturnValue({ mutateAsync: vi.fn() } as unknown as ReturnType<typeof useGetDataSourceOAuthUrl>)
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
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useGlobalPublicStore).mockImplementation((selector: any) =>
        selector({
          systemFeatures: { ...defaultSystemFeatures, enable_marketplace: false },
        }),
      )
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: undefined,
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      render(<DataSourcePage />)

      // Assert
      expect(screen.queryByText('Dify Source')).not.toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.installDataSourceProvider')).not.toBeInTheDocument()
    })
  })

  describe('Data Source List Rendering', () => {
    it('should render Card components for each data source returned from the API', () => {
      // Arrange
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useGlobalPublicStore).mockImplementation((selector: any) =>
        selector({
          systemFeatures: { ...defaultSystemFeatures, enable_marketplace: false },
        }),
      )
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: { result: mockProviders },
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      render(<DataSourcePage />)

      // Assert
      expect(screen.getByText('Dify Source')).toBeInTheDocument()
      expect(screen.getByText('Partner Source')).toBeInTheDocument()
    })
  })

  describe('Marketplace Integration', () => {
    it('should render the InstallFromMarketplace component when enable_marketplace feature is enabled', () => {
      // Arrange
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useGlobalPublicStore).mockImplementation((selector: any) =>
        selector({
          systemFeatures: { ...defaultSystemFeatures, enable_marketplace: true },
        }),
      )
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: { result: mockProviders },
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      render(<DataSourcePage />)

      // Assert
      expect(screen.getByText('common.modelProvider.installDataSourceProvider')).toBeInTheDocument()
      expect(screen.getByText('common.modelProvider.discoverMore')).toBeInTheDocument()
    })

    it('should pass an empty array to InstallFromMarketplace if data result is missing but marketplace is enabled', () => {
      // Arrange
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useGlobalPublicStore).mockImplementation((selector: any) =>
        selector({
          systemFeatures: { ...defaultSystemFeatures, enable_marketplace: true },
        }),
      )
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: undefined,
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      render(<DataSourcePage />)

      // Assert
      expect(screen.getByText('common.modelProvider.installDataSourceProvider')).toBeInTheDocument()
    })

    it('should handle the case where data exists but result is an empty array', () => {
      // Arrange
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useGlobalPublicStore).mockImplementation((selector: any) =>
        selector({
          systemFeatures: { ...defaultSystemFeatures, enable_marketplace: true },
        }),
      )
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: { result: [] },
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      render(<DataSourcePage />)

      // Assert
      expect(screen.queryByText('Dify Source')).not.toBeInTheDocument()
      expect(screen.getByText('common.modelProvider.installDataSourceProvider')).toBeInTheDocument()
    })

    it('should handle the case where systemFeatures is missing (edge case for coverage)', () => {
      // Arrange
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useGlobalPublicStore).mockImplementation((selector: any) =>
        selector({
          systemFeatures: {},
        }),
      )
      vi.mocked(useGetDataSourceListAuth).mockReturnValue({
        data: { result: [] },
      } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

      // Act
      render(<DataSourcePage />)

      // Assert
      expect(screen.queryByText('common.modelProvider.installDataSourceProvider')).not.toBeInTheDocument()
    })
  })
})
