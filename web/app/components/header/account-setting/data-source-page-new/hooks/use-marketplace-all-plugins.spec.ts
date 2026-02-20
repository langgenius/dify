import type { Plugin } from '@/app/components/plugins/types'
import { renderHook } from '@testing-library/react'
import {
  useMarketplacePlugins,
  useMarketplacePluginsByCollectionId,
} from '@/app/components/plugins/marketplace/hooks'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useMarketplaceAllPlugins } from './use-marketplace-all-plugins'

/**
 * useMarketplaceAllPlugins Hook Tests
 * This hook combines search results and collection-specific plugins from the marketplace.
 */

type UseMarketplacePluginsReturn = ReturnType<typeof useMarketplacePlugins>
type UseMarketplacePluginsByCollectionIdReturn = ReturnType<typeof useMarketplacePluginsByCollectionId>

vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: vi.fn(),
  useMarketplacePluginsByCollectionId: vi.fn(),
}))

describe('useMarketplaceAllPlugins', () => {
  const mockQueryPlugins = vi.fn()
  const mockQueryPluginsWithDebounced = vi.fn()
  const mockResetPlugins = vi.fn()
  const mockCancelQueryPluginsWithDebounced = vi.fn()
  const mockFetchNextPage = vi.fn()

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

  const createBaseCollectionMock = (overrides: Partial<UseMarketplacePluginsByCollectionIdReturn> = {}): UseMarketplacePluginsByCollectionIdReturn => ({
    plugins: [],
    isLoading: false,
    isSuccess: true,
    ...overrides,
  } as UseMarketplacePluginsByCollectionIdReturn)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useMarketplacePlugins).mockReturnValue(createBasePluginsMock())
    vi.mocked(useMarketplacePluginsByCollectionId).mockReturnValue(createBaseCollectionMock())
  })

  describe('Search Interactions', () => {
    it('should call queryPlugins when no searchText is provided', () => {
      // Arrange
      const providers = [{ plugin_id: 'p1' }]
      const searchText = ''

      // Act
      renderHook(() => useMarketplaceAllPlugins(providers, searchText))

      // Assert
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
      // Arrange
      const providers = [{ plugin_id: 'p1' }]
      const searchText = 'search term'

      // Act
      renderHook(() => useMarketplaceAllPlugins(providers, searchText))

      // Assert
      expect(mockQueryPluginsWithDebounced).toHaveBeenCalledWith({
        query: 'search term',
        category: PluginCategoryEnum.datasource,
        exclude: ['p1'],
        type: 'plugin',
        sort_by: 'install_count',
        sort_order: 'DESC',
      })
    })
  })

  describe('Plugin Filtering and Combination', () => {
    it('should combine collection plugins and search results, filtering duplicates and bundles', () => {
      // Arrange
      const providers = [{ plugin_id: 'p-excluded' }]
      const searchText = ''
      const p1 = { plugin_id: 'p1', type: 'plugin' } as Plugin
      const pExcluded = { plugin_id: 'p-excluded', type: 'plugin' } as Plugin
      const p2 = { plugin_id: 'p2', type: 'plugin' } as Plugin
      const p3Bundle = { plugin_id: 'p3', type: 'bundle' } as Plugin

      const collectionPlugins = [p1, pExcluded]
      const searchPlugins = [p1, p2, p3Bundle]

      vi.mocked(useMarketplacePluginsByCollectionId).mockReturnValue(
        createBaseCollectionMock({ plugins: collectionPlugins }),
      )
      vi.mocked(useMarketplacePlugins).mockReturnValue(
        createBasePluginsMock({ plugins: searchPlugins }),
      )

      // Act
      const { result } = renderHook(() => useMarketplaceAllPlugins(providers, searchText))

      // Assert: pExcluded is removed, p1 is duplicated (so kept once), p2 is added, p3 is bundle (skipped)
      expect(result.current.plugins).toHaveLength(2)
      expect(result.current.plugins.map(p => p.plugin_id)).toEqual(['p1', 'p2'])
    })

    it('should handle undefined plugins gracefully', () => {
      // Arrange
      vi.mocked(useMarketplacePlugins).mockReturnValue(
        createBasePluginsMock({ plugins: undefined as unknown as Plugin[] }),
      )

      // Act
      const { result } = renderHook(() => useMarketplaceAllPlugins([], ''))

      // Assert
      expect(result.current.plugins).toEqual([])
    })
  })

  describe('Loading State Management', () => {
    it('should return isLoading true if either hook is loading', () => {
      // Case 1: Collection hook is loading
      vi.mocked(useMarketplacePluginsByCollectionId).mockReturnValue(
        createBaseCollectionMock({ isLoading: true }),
      )
      vi.mocked(useMarketplacePlugins).mockReturnValue(createBasePluginsMock({ isLoading: false }))

      const { result, rerender } = renderHook(
        ({ providers, searchText }) => useMarketplaceAllPlugins(providers, searchText),
        {
          initialProps: { providers: [] as { plugin_id: string }[], searchText: '' },
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
  })
})
