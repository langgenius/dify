import type { Plugin } from '@/app/components/plugins/types'
import type { Collection } from '@/app/components/tools/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SCROLL_BOTTOM_THRESHOLD } from '@/app/components/plugins/marketplace/constants'
import { getMarketplaceListCondition } from '@/app/components/plugins/marketplace/utils'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { useMarketplace } from '../hooks'

// ==================== Mock Setup ====================

const mockQueryMarketplaceCollectionsAndPlugins = vi.fn()
const mockQueryPlugins = vi.fn()
const mockQueryPluginsWithDebounced = vi.fn()
const mockResetPlugins = vi.fn()
const mockFetchNextPage = vi.fn()

const mockUseMarketplaceCollectionsAndPlugins = vi.fn()
const mockUseMarketplacePlugins = vi.fn()
vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplaceCollectionsAndPlugins: (...args: unknown[]) => mockUseMarketplaceCollectionsAndPlugins(...args),
  useMarketplacePlugins: (...args: unknown[]) => mockUseMarketplacePlugins(...args),
}))

const mockUseAllToolProviders = vi.fn()
vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: (...args: unknown[]) => mockUseAllToolProviders(...args),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: vi.fn(() => 'https://marketplace.test/market'),
}))

// ==================== Test Utilities ====================

const createToolProvider = (overrides: Partial<Collection> = {}): Collection => ({
  id: 'provider-1',
  name: 'Provider 1',
  author: 'Author',
  description: { en_US: 'desc', zh_Hans: '描述' },
  icon: 'icon',
  label: { en_US: 'label', zh_Hans: '标签' },
  type: CollectionType.custom,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  ...overrides,
})

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
    mockUseAllToolProviders.mockReturnValue({
      data: [],
      isSuccess: true,
    })
    setupHookMocks()
  })

  describe('Queries', () => {
    it('should query plugins with debounce when search text is provided', async () => {
      mockUseAllToolProviders.mockReturnValue({
        data: [
          createToolProvider({ plugin_id: 'plugin-a' }),
          createToolProvider({ plugin_id: undefined }),
        ],
        isSuccess: true,
      })

      renderHook(() => useMarketplace('alpha', []))

      await waitFor(() => {
        expect(mockQueryPluginsWithDebounced).toHaveBeenCalledWith({
          category: PluginCategoryEnum.tool,
          query: 'alpha',
          tags: [],
          exclude: ['plugin-a'],
          type: 'plugin',
        })
      })
      expect(mockQueryMarketplaceCollectionsAndPlugins).not.toHaveBeenCalled()
      expect(mockResetPlugins).not.toHaveBeenCalled()
    })

    it('should query plugins immediately when only tags are provided', async () => {
      mockUseAllToolProviders.mockReturnValue({
        data: [createToolProvider({ plugin_id: 'plugin-b' })],
        isSuccess: true,
      })

      renderHook(() => useMarketplace('', ['tag-1']))

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
      mockUseAllToolProviders.mockReturnValue({
        data: [createToolProvider({ plugin_id: 'plugin-c' })],
        isSuccess: true,
      })

      renderHook(() => useMarketplace('', []))

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

      const { result } = renderHook(() => useMarketplace('', []))

      expect(result.current.isLoading).toBe(true)
      expect(result.current.page).toBe(1)
    })
  })

  describe('Scroll', () => {
    it('should fetch next page when scrolling near bottom with filters', () => {
      setupHookMocks({ hasNextPage: true })
      const { result } = renderHook(() => useMarketplace('search', []))
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
      const { result } = renderHook(() => useMarketplace('', []))
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
