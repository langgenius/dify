import type { Plugin } from '@/app/components/plugins/types'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useMarketplacePlugins,
  useMarketplacePluginsByCollectionId,
} from '@/app/components/plugins/marketplace/hooks'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useMarketplaceAllPlugins } from './use-marketplace-all-plugins'

/**
 * Interface for the provider objects passed to the hook.
 */
type MockProvider = {
  plugin_id: string
}

/**
 * Type-safe mock return values for useMarketplacePlugins.
 */
type UseMarketplacePluginsReturn = ReturnType<typeof useMarketplacePlugins>
type UseMarketplacePluginsByCollectionIdReturn = ReturnType<typeof useMarketplacePluginsByCollectionId>

/**
 * Mocking the marketplace hooks to control their return values and monitor calls.
 */
vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: vi.fn(),
  useMarketplacePluginsByCollectionId: vi.fn(),
}))

describe('useMarketplaceAllPlugins', () => {
  // Mock implementations for the functions returned by the hooks
  const mockQueryPlugins = vi.fn()
  const mockQueryPluginsWithDebounced = vi.fn()
  const mockResetPlugins = vi.fn()
  const mockCancelQueryPluginsWithDebounced = vi.fn()
  const mockFetchNextPage = vi.fn()

  /**
   * Helper to create a base mock return object for useMarketplacePlugins.
   */
  const createBasePluginsMock = (overrides: Partial<UseMarketplacePluginsReturn> = {}): UseMarketplacePluginsReturn => ({
    plugins: [],
    total: 0,
    resetPlugins: mockResetPlugins,
    queryPlugins: mockQueryPlugins,
    queryPluginsWithDebounced: mockQueryPluginsWithDebounced,
    cancelQueryPluginsWithDebounced: mockCancelQueryPluginsWithDebounced,
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: mockFetchNextPage,
    page: 1,
    ...overrides,
  } as UseMarketplacePluginsReturn)

  /**
   * Helper to create a base mock return object for useMarketplacePluginsByCollectionId.
   */
  const createBaseCollectionMock = (overrides: Partial<UseMarketplacePluginsByCollectionIdReturn> = {}): UseMarketplacePluginsByCollectionIdReturn => ({
    plugins: [],
    isLoading: false,
    isSuccess: true,
    ...overrides,
  } as UseMarketplacePluginsByCollectionIdReturn)

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default mock values using helpers to avoid 'any'
    vi.mocked(useMarketplacePlugins).mockReturnValue(createBasePluginsMock())
    vi.mocked(useMarketplacePluginsByCollectionId).mockReturnValue(createBaseCollectionMock())
  })

  it('should call queryPlugins when no searchText is provided', () => {
    const providers: MockProvider[] = [{ plugin_id: 'p1' }]
    const searchText = ''

    renderHook(() => useMarketplaceAllPlugins(providers, searchText))

    expect(mockQueryPlugins).toHaveBeenCalledWith({
      query: '',
      category: PluginCategoryEnum.datasource,
      type: 'plugin',
      page_size: 1000,
      exclude: ['p1'],
      sort_by: 'install_count',
      sort_order: 'DESC',
    })
  })

  it('should call queryPluginsWithDebounced when searchText is provided', () => {
    const providers: MockProvider[] = [{ plugin_id: 'p1' }]
    const searchText = 'search term'

    renderHook(() => useMarketplaceAllPlugins(providers, searchText))

    expect(mockQueryPluginsWithDebounced).toHaveBeenCalledWith({
      query: 'search term',
      category: PluginCategoryEnum.datasource,
      exclude: ['p1'],
      type: 'plugin',
      sort_by: 'install_count',
      sort_order: 'DESC',
    })
  })

  it('should combine collection plugins and search results, filtering duplicates and bundles', () => {
    const providers: MockProvider[] = [{ plugin_id: 'p-excluded' }]
    const searchText = ''

    // Define plugins with minimal required fields for filtering logic
    const p1 = { plugin_id: 'p1', type: 'plugin' } as Plugin
    const pExcluded = { plugin_id: 'p-excluded', type: 'plugin' } as Plugin
    const p2 = { plugin_id: 'p2', type: 'plugin' } as Plugin
    const p3Bundle = { plugin_id: 'p3', type: 'bundle' } as Plugin

    const collectionPlugins = [p1, pExcluded]
    // The hook assumes 'plugins' from useMarketplacePlugins already excludes 'exclude' IDs via server-side filtering.
    // However, if the server returned it, the hook's local logic only filters collectionPlugins.
    const searchPlugins = [p1, p2, p3Bundle]

    vi.mocked(useMarketplacePluginsByCollectionId).mockReturnValue(
      createBaseCollectionMock({ plugins: collectionPlugins }),
    )

    vi.mocked(useMarketplacePlugins).mockReturnValue(
      createBasePluginsMock({ plugins: searchPlugins }),
    )

    const { result } = renderHook(() => useMarketplaceAllPlugins(providers, searchText))

    // Expected: [p1, p2]
    // 1. pExcluded is removed from collectionPlugins because it's in 'exclude'.
    // 2. p1 from search is skipped because it's already in allPlugins (from collection).
    // 3. p2 from search is added because it's not a bundle and not already in allPlugins.
    // 4. p3Bundle is skipped because its type is 'bundle'.
    expect(result.current.plugins).toHaveLength(2)
    expect(result.current.plugins.map(p => p.plugin_id)).toEqual(['p1', 'p2'])
  })

  it('should return isLoading true if either hook is loading', () => {
    // Case 1: Collection hook is loading
    vi.mocked(useMarketplacePluginsByCollectionId).mockReturnValue(
      createBaseCollectionMock({ isLoading: true }),
    )
    vi.mocked(useMarketplacePlugins).mockReturnValue(createBasePluginsMock({ isLoading: false }))

    const { result, rerender } = renderHook(
      ({ providers, searchText }) => useMarketplaceAllPlugins(providers, searchText),
      {
        initialProps: { providers: [] as MockProvider[], searchText: '' },
      },
    )

    expect(result.current.isLoading).toBe(true)

    // Case 2: Plugins hook is loading
    vi.mocked(useMarketplacePluginsByCollectionId).mockReturnValue(
      createBaseCollectionMock({ isLoading: false }),
    )
    vi.mocked(useMarketplacePlugins).mockReturnValue(createBasePluginsMock({ isLoading: true }))

    rerender({ providers: [], searchText: '' })
    expect(result.current.isLoading).toBe(true)

    // Case 3: Both hooks are loading
    vi.mocked(useMarketplacePluginsByCollectionId).mockReturnValue(
      createBaseCollectionMock({ isLoading: true }),
    )
    rerender({ providers: [], searchText: '' })
    expect(result.current.isLoading).toBe(true)

    // Case 4: Neither hook is loading
    vi.mocked(useMarketplacePluginsByCollectionId).mockReturnValue(
      createBaseCollectionMock({ isLoading: false }),
    )
    vi.mocked(useMarketplacePlugins).mockReturnValue(createBasePluginsMock({ isLoading: false }))
    rerender({ providers: [], searchText: '' })
    expect(result.current.isLoading).toBe(false)
  })

  it('should handle undefined plugins gracefully', () => {
    // use-marketplace-all-plugins.ts uses 'plugins?.length' and 'plugins' in a for loop
    // If 'plugins' is undefined from useMarketplacePlugins, it should still work.
    vi.mocked(useMarketplacePlugins).mockReturnValue(
      createBasePluginsMock({ plugins: undefined as unknown as Plugin[] }),
    )

    const { result } = renderHook(() => useMarketplaceAllPlugins([], ''))

    // Should return result from collection plugins (which is empty here)
    expect(result.current.plugins).toEqual([])
  })
})
