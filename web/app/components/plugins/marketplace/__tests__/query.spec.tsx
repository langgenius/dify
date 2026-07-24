import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/config', () => ({
  API_PREFIX: '/api',
  APP_VERSION: '1.0.0',
  IS_MARKETPLACE: false,
  MARKETPLACE_API_PREFIX: 'https://marketplace.dify.ai/api/v1',
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (path: string) => `https://marketplace.dify.ai${path}`,
}))

const mockCollections = vi.fn()
const mockCollectionPlugins = vi.fn()
const mockSearchAdvanced = vi.fn()

vi.mock('@/service/client', () => ({
  marketplaceClient: {
    collections: (...args: unknown[]) => mockCollections(...args),
    collectionPlugins: (...args: unknown[]) => mockCollectionPlugins(...args),
    searchAdvanced: (...args: unknown[]) => mockSearchAdvanced(...args),
  },
  marketplaceQuery: {
    collections: {
      queryKey: (params: unknown) => ['marketplace', 'collections', params],
    },
    searchAdvanced: {
      queryKey: (params: unknown) => ['marketplace', 'searchAdvanced', params],
    },
  },
}))

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })

const createWrapper = () => {
  const queryClient = createTestQueryClient()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
  return { Wrapper, queryClient }
}

describe('useMarketplaceCollectionsAndPlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch collections and plugins data', async () => {
    const mockCollectionData = [
      { name: 'col-1', label: {}, description: {}, rule: '', created_at: '', updated_at: '' },
    ]
    const mockPluginData = [
      { type: 'plugin', org: 'test', name: 'plugin1', tags: [] },
    ]

    mockCollections.mockResolvedValue({ data: { collections: mockCollectionData } })
    mockCollectionPlugins.mockResolvedValue({ data: { plugins: mockPluginData } })

    const { useMarketplaceCollectionsAndPlugins } = await import('../query')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplaceCollectionsAndPlugins({ condition: 'category=tool', type: 'plugin' }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })

    expect(result.current.data?.marketplaceCollections).toBeDefined()
    expect(result.current.data?.marketplaceCollectionPluginsMap).toBeDefined()
  })

  it('should handle empty collections params', async () => {
    mockCollections.mockResolvedValue({ data: { collections: [] } })

    const { useMarketplaceCollectionsAndPlugins } = await import('../query')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplaceCollectionsAndPlugins({}),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
  })
})

describe('useMarketplacePlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not fetch when queryParams is undefined', async () => {
    const { useMarketplacePlugins } = await import('../query')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePlugins(undefined),
      { wrapper: Wrapper },
    )

    // enabled is false, so should not fetch
    expect(result.current.data).toBeUndefined()
    expect(mockSearchAdvanced).not.toHaveBeenCalled()
  })

  it('should fetch plugins when queryParams is provided', async () => {
    mockSearchAdvanced.mockResolvedValue({
      data: {
        plugins: [{ type: 'plugin', org: 'test', name: 'p1', tags: [] }],
        total: 1,
      },
    })

    const { useMarketplacePlugins } = await import('../query')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePlugins({
        query: 'test',
        sort_by: 'install_count',
        sort_order: 'DESC',
        category: 'tool',
        tags: [],
        type: 'plugin',
      }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })

    expect(result.current.data?.pages).toHaveLength(1)
    expect(result.current.data?.pages[0].plugins).toHaveLength(1)
  })

  it('should handle bundle type in query params', async () => {
    mockSearchAdvanced.mockResolvedValue({
      data: {
        bundles: [{ type: 'bundle', org: 'test', name: 'b1', tags: [] }],
        total: 1,
      },
    })

    const { useMarketplacePlugins } = await import('../query')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePlugins({
        query: 'bundle',
        type: 'bundle',
      }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
  })

  it('should handle API error gracefully', async () => {
    mockSearchAdvanced.mockRejectedValue(new Error('Network error'))

    const { useMarketplacePlugins } = await import('../query')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePlugins({
        query: 'fail',
      }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })

    expect(result.current.data?.pages[0].plugins).toEqual([])
    expect(result.current.data?.pages[0].total).toBe(0)
  })

  it('should determine next page correctly via getNextPageParam', async () => {
    // Return enough data that there would be a next page
    mockSearchAdvanced.mockResolvedValue({
      data: {
        plugins: Array.from({ length: 40 }, (_, i) => ({
          type: 'plugin',
          org: 'test',
          name: `p${i}`,
          tags: [],
        })),
        total: 100,
      },
    })

    const { useMarketplacePlugins } = await import('../query')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePlugins({
        query: 'paginated',
        page_size: 40,
      }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true)
    })
  })
})
