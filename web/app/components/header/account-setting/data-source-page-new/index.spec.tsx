import type { UseQueryResult } from '@tanstack/react-query'
import type { DataSourceAuth } from './types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useGetDataSourceListAuth } from '@/service/use-datasource'
import { defaultSystemFeatures } from '@/types/feature'
import DataSourcePage from './index'

/**
 * DataSourcePage Component Tests
 * Using Unit approach to focus on page-level layout and conditional rendering.
 */

// Mock sub-components
vi.mock('./card', () => ({
  default: vi.fn(({ item }: { item: DataSourceAuth }) => (
    <div data-testid={`mock-card-${item.plugin_unique_identifier}`}>
      {item.name}
    </div>
  )),
}))

vi.mock('./install-from-marketplace', () => ({
  default: vi.fn(({ providers, searchText }: { providers: DataSourceAuth[], searchText: string }) => (
    <div data-testid="mock-marketplace">
      Marketplace -
      {' '}
      {providers.length}
      {' '}
      providers, Search:
      {' '}
      {searchText}
    </div>
  )),
}))

// Mock external hooks
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceListAuth: vi.fn(),
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
      expect(screen.queryByTestId(/mock-card-/)).not.toBeInTheDocument()
      expect(screen.queryByTestId('mock-marketplace')).not.toBeInTheDocument()
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
      expect(screen.getByTestId('mock-card-unique-1')).toBeInTheDocument()
      expect(screen.getByTestId('mock-card-unique-2')).toBeInTheDocument()
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
      const marketplace = screen.getByTestId('mock-marketplace')
      expect(marketplace).toBeInTheDocument()
      expect(marketplace).toHaveTextContent('Marketplace - 2 providers')
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
      const marketplace = screen.getByTestId('mock-marketplace')
      expect(marketplace).toBeInTheDocument()
      expect(marketplace).toHaveTextContent('Marketplace - 0 providers')
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
      expect(screen.queryByTestId(/mock-card-/)).not.toBeInTheDocument()
      const marketplace = screen.getByTestId('mock-marketplace')
      expect(marketplace).toBeInTheDocument()
      expect(marketplace).toHaveTextContent('Marketplace - 0 providers')
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
      expect(screen.queryByTestId('mock-marketplace')).not.toBeInTheDocument()
    })
  })
})
