import type { UseQueryResult } from '@tanstack/react-query'
import type { DataSourceAuth } from './types'
import type { SystemFeatures } from '@/types/feature'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useGetDataSourceListAuth } from '@/service/use-datasource'
import DataSourcePage from './index'

// Type definition for the store state matching the implementation in @/context/global-public-context
type GlobalPublicStore = {
  systemFeatures: SystemFeatures
  setSystemFeatures: (systemFeatures: SystemFeatures) => void
}

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceListAuth: vi.fn(),
}))

vi.mock('./card', () => ({
  default: ({ item }: { item: { plugin_unique_identifier: string, name: string } }) => <div data-testid={`card-${item.plugin_unique_identifier}`}>{item.name}</div>,
}))

vi.mock('./install-from-marketplace', () => ({
  default: () => <div data-testid="install-from-marketplace">Install Component</div>,
}))

describe('DataSourcePage', () => {
  const mockData = {
    result: [
      { plugin_unique_identifier: 'id-1', name: 'Source 1' },
      { plugin_unique_identifier: 'id-2', name: 'Source 2' },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render cards and marketplace component when enabled', () => {
    // Mock the store selector to return state with marketplace enabled
    vi.mocked(useGlobalPublicStore).mockImplementation((selector: (state: GlobalPublicStore) => unknown) => selector({
      systemFeatures: { enable_marketplace: true } as unknown as SystemFeatures,
      setSystemFeatures: vi.fn(),
    }))

    // Mock the data source list query result
    vi.mocked(useGetDataSourceListAuth).mockReturnValue({
      data: mockData as unknown as { result: DataSourceAuth[] },
    } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

    render(<DataSourcePage />)

    expect(screen.getByTestId('card-id-1')).toBeInTheDocument()
    expect(screen.getByTestId('card-id-2')).toBeInTheDocument()
    expect(screen.getByTestId('install-from-marketplace')).toBeInTheDocument()
  })

  it('should not render marketplace component when disabled', () => {
    // Mock the store selector to return state with marketplace disabled
    vi.mocked(useGlobalPublicStore).mockImplementation((selector: (state: GlobalPublicStore) => unknown) => selector({
      systemFeatures: { enable_marketplace: false } as unknown as SystemFeatures,
      setSystemFeatures: vi.fn(),
    }))

    // Mock the data source list query result
    vi.mocked(useGetDataSourceListAuth).mockReturnValue({
      data: mockData as unknown as { result: DataSourceAuth[] },
    } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

    render(<DataSourcePage />)

    expect(screen.getByTestId('card-id-1')).toBeInTheDocument()
    expect(screen.getByTestId('card-id-2')).toBeInTheDocument()
    expect(screen.queryByTestId('install-from-marketplace')).not.toBeInTheDocument()
  })

  it('should handle undefined data gracefully', () => {
    // Mock the store selector to return state with marketplace enabled
    vi.mocked(useGlobalPublicStore).mockImplementation((selector: (state: GlobalPublicStore) => unknown) => selector({
      systemFeatures: { enable_marketplace: true } as unknown as SystemFeatures,
      setSystemFeatures: vi.fn(),
    }))

    // Mock the data source list query result with undefined data
    vi.mocked(useGetDataSourceListAuth).mockReturnValue({
      data: undefined,
    } as unknown as UseQueryResult<{ result: DataSourceAuth[] }, Error>)

    render(<DataSourcePage />)

    expect(screen.queryByTestId(/card-/)).not.toBeInTheDocument()
    expect(screen.getByTestId('install-from-marketplace')).toBeInTheDocument()
  })
})
