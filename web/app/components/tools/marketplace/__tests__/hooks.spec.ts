import type { ReactNode } from 'react'
import type { Plugin } from '@/app/components/plugins/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SCROLL_BOTTOM_THRESHOLD } from '@/app/components/plugins/marketplace/constants'
import { getMarketplaceListCondition } from '@/app/components/plugins/marketplace/utils'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useMarketplace } from '../hooks'

// ==================== Mock Setup ====================

const mockQueryMarketplaceCollectionsAndPlugins = vi.fn()
const mockQueryPlugins = vi.fn()
const mockQueryPluginsWithDebounced = vi.fn()
const mockResetPlugins = vi.fn()
const mockFetchNextPage = vi.fn()

const mockUseMarketplaceCollectionsAndPlugins = vi.fn()
const mockUseMarketplacePlugins = vi.fn()
const mockInstalledIdsQueryOptions = vi.fn()
vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplaceCollectionsAndPlugins: (...args: unknown[]) =>
    mockUseMarketplaceCollectionsAndPlugins(...args),
  useMarketplacePlugins: (...args: unknown[]) => mockUseMarketplacePlugins(...args),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        plugin: {
          installedIds: {
            get: {
              queryOptions: (...args: unknown[]) => mockInstalledIdsQueryOptions(...args),
            },
          },
        },
      },
    },
  },
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: vi.fn(() => 'https://marketplace.test/market'),
}))

// ==================== Test Utilities ====================

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const setupHookMocks = (overrides?: {
  isLoading?: boolean
  isPluginsLoading?: boolean
  pluginsPage?: number
  hasNextPage?: boolean
  plugins?: Plugin[] | undefined
}) => {
  mockUseMarketplaceCollectionsAndPlugins.mockReturnValue({
    isLoading: overrides?.isLoading ?? false,
    marketplaceCollections: [],
    marketplaceCollectionPluginsMap: {},
    queryMarketplaceCollectionsAndPlugins: mockQueryMarketplaceCollectionsAndPlugins,
  })
  mockUseMarketplacePlugins.mockReturnValue({
    plugins: overrides?.plugins,
    resetPlugins: mockResetPlugins,
    queryPlugins: mockQueryPlugins,
    queryPluginsWithDebounced: mockQueryPluginsWithDebounced,
    isLoading: overrides?.isPluginsLoading ?? false,
    fetchNextPage: mockFetchNextPage,
    hasNextPage: overrides?.hasNextPage ?? false,
    page: overrides?.pluginsPage,
  })
}

// ==================== Tests ====================

describe('useMarketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInstalledIdsQueryOptions.mockReturnValue({
      queryKey: ['installed-plugin-ids', 'tool'],
      queryFn: () => Promise.resolve({ plugin_ids: [] }),
    })
    setupHookMocks()
  })

  describe('Queries', () => {
    it('should query plugins when the debounced page filter provides search text', async () => {
      mockInstalledIdsQueryOptions.mockReturnValue({
        queryKey: ['installed-plugin-ids', 'tool'],
        queryFn: () => Promise.resolve({ plugin_ids: ['plugin-a'] }),
      })

      renderHook(() => useMarketplace('alpha', []), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(mockQueryPlugins).toHaveBeenCalledWith({
          category: PluginCategoryEnum.tool,
          query: 'alpha',
          tags: [],
          exclude: ['plugin-a'],
          type: 'plugin',
        })
      })
      expect(mockQueryPluginsWithDebounced).not.toHaveBeenCalled()
      expect(mockQueryMarketplaceCollectionsAndPlugins).not.toHaveBeenCalled()
      expect(mockResetPlugins).not.toHaveBeenCalled()
    })

    it('should query plugins immediately when only tags are provided', async () => {
      mockInstalledIdsQueryOptions.mockReturnValue({
        queryKey: ['installed-plugin-ids', 'tool'],
        queryFn: () => Promise.resolve({ plugin_ids: ['plugin-b'] }),
      })

      renderHook(() => useMarketplace('', ['tag-1']), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(mockQueryPlugins).toHaveBeenCalledWith({
          category: PluginCategoryEnum.tool,
          query: '',
          tags: ['tag-1'],
          exclude: ['plugin-b'],
          type: 'plugin',
        })
      })
    })

    it('should query collections and reset plugins when no filters are provided', async () => {
      mockInstalledIdsQueryOptions.mockReturnValue({
        queryKey: ['installed-plugin-ids', 'tool'],
        queryFn: () => Promise.resolve({ plugin_ids: ['plugin-c'] }),
      })

      renderHook(() => useMarketplace('', []), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(mockQueryMarketplaceCollectionsAndPlugins).toHaveBeenCalledWith({
          category: PluginCategoryEnum.tool,
          condition: getMarketplaceListCondition(PluginCategoryEnum.tool),
          exclude: ['plugin-c'],
          type: 'plugin',
        })
      })
      expect(mockResetPlugins).toHaveBeenCalledTimes(1)
    })
  })

  describe('State', () => {
    it('should expose combined loading state and fallback page value', () => {
      setupHookMocks({ isLoading: true, isPluginsLoading: false, pluginsPage: undefined })

      const { result } = renderHook(() => useMarketplace('', []), { wrapper: createWrapper() })

      expect(result.current.isLoading).toBe(true)
      expect(result.current.page).toBe(1)
    })
  })

  describe('Scroll', () => {
    it('should fetch next page when scrolling near bottom with filters', () => {
      setupHookMocks({ hasNextPage: true })
      const { result } = renderHook(() => useMarketplace('search', []), {
        wrapper: createWrapper(),
      })
      const event = {
        target: {
          scrollTop: 100,
          scrollHeight: 200,
          clientHeight: 100 + SCROLL_BOTTOM_THRESHOLD,
        },
      } as unknown as Event

      act(() => {
        result.current.handleScroll(event)
      })

      expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
    })

    it('should not fetch next page when no filters are applied', () => {
      setupHookMocks({ hasNextPage: true })
      const { result } = renderHook(() => useMarketplace('', []), { wrapper: createWrapper() })
      const event = {
        target: {
          scrollTop: 100,
          scrollHeight: 200,
          clientHeight: 100 + SCROLL_BOTTOM_THRESHOLD,
        },
      } as unknown as Event

      act(() => {
        result.current.handleScroll(event)
      })

      expect(mockFetchNextPage).not.toHaveBeenCalled()
    })
  })
})
