import type { UseQueryResult } from '@tanstack/react-query'
import type { DataSourceAuth } from './types'
import type { SystemFeatures } from '@/types/feature'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useGetDataSourceListAuth } from '@/service/use-datasource'
import { defaultSystemFeatures } from '@/types/feature'
import DataSourcePage from './index'

/**
 * Mocking sub-components to isolate the DataSourcePage test.
 * This ensures we are testing the logic of DataSourcePage rather than its children.
 */
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
      {searchText}
    </div>
  )),
}))

/**
 * Mocking external hooks. We use global vitest mocks for zustand and query hooks.
 */
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceListAuth: vi.fn(),
}))

/**
 * Type-safe state for mocking useGlobalPublicStore selectors.
 */
type GlobalPublicState = {
  systemFeatures: SystemFeatures
  setSystemFeatures: (systemFeatures: SystemFeatures) => void
}

describe('DataSourcePage Component', () => {
  // Mock data satisfying the TypeWithI18N requirement (en_US and zh_Hans)
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

  it('should render an empty view when no data is available and marketplace is disabled', () => {
    // Marketplace disabled
    vi.mocked(useGlobalPublicStore).mockImplementation(<T,>(selector: (state: GlobalPublicState) => T) =>
      selector({
        systemFeatures: { ...defaultSystemFeatures, enable_marketplace: false },
        setSystemFeatures: vi.fn(),
      }),
    )

    // Data is undefined (loading or no response)
    vi.mocked(useGetDataSourceListAuth).mockReturnValue({
      data: undefined,
    } as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

    render(<DataSourcePage />)

    // No Cards or Marketplace should be found
    expect(screen.queryByTestId(/mock-card-/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('mock-marketplace')).not.toBeInTheDocument()
  })

  it('should render Card components for each data source returned from the API', () => {
    vi.mocked(useGlobalPublicStore).mockImplementation(<T,>(selector: (state: GlobalPublicState) => T) =>
      selector({
        systemFeatures: { ...defaultSystemFeatures, enable_marketplace: false },
        setSystemFeatures: vi.fn(),
      }),
    )

    // Mock successful data fetch
    vi.mocked(useGetDataSourceListAuth).mockReturnValue({
      data: { result: mockProviders },
    } as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

    render(<DataSourcePage />)

    // Check for card rendering
    expect(screen.getByTestId('mock-card-unique-1')).toBeInTheDocument()
    expect(screen.getByTestId('mock-card-unique-2')).toBeInTheDocument()
    expect(screen.getByText('Dify Source')).toBeInTheDocument()
    expect(screen.getByText('Partner Source')).toBeInTheDocument()
  })

  it('should render the InstallFromMarketplace component when enable_marketplace is true', () => {
    // Enable marketplace feature
    vi.mocked(useGlobalPublicStore).mockImplementation(<T,>(selector: (state: GlobalPublicState) => T) =>
      selector({
        systemFeatures: { ...defaultSystemFeatures, enable_marketplace: true },
        setSystemFeatures: vi.fn(),
      }),
    )

    vi.mocked(useGetDataSourceListAuth).mockReturnValue({
      data: { result: mockProviders },
    } as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

    render(<DataSourcePage />)

    // Marketplace component should be present
    const marketplace = screen.getByTestId('mock-marketplace')
    expect(marketplace).toBeInTheDocument()
    // Verify it received the providers list
    expect(marketplace).toHaveTextContent('Marketplace - 2 providers')
  })

  it('should pass an empty array to InstallFromMarketplace if data is missing but marketplace is enabled', () => {
    vi.mocked(useGlobalPublicStore).mockImplementation(<T,>(selector: (state: GlobalPublicState) => T) =>
      selector({
        systemFeatures: { ...defaultSystemFeatures, enable_marketplace: true },
        setSystemFeatures: vi.fn(),
      }),
    )

    // Data result is undefined
    vi.mocked(useGetDataSourceListAuth).mockReturnValue({
      data: undefined,
    } as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

    render(<DataSourcePage />)

    // Marketplace component should handle the empty array fallback
    const marketplace = screen.getByTestId('mock-marketplace')
    expect(marketplace).toBeInTheDocument()
    expect(marketplace).toHaveTextContent('Marketplace - 0 providers')
  })
})
