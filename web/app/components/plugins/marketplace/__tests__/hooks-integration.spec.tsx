import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Integration tests for hooks.ts using real @tanstack/react-query
 * instead of mocking it, to get proper V8 coverage of queryFn closures.
 */

let mockPostMarketplaceShouldFail = false
const mockPostMarketplaceResponse = {
  data: {
    plugins: [
      { type: 'plugin', org: 'test', name: 'plugin1', tags: [] },
    ],
    total: 1,
  },
}

vi.mock('@/service/base', () => ({
  postMarketplace: vi.fn(async () => {
    if (mockPostMarketplaceShouldFail)
      throw new Error('Mock API error')
    return mockPostMarketplaceResponse
  }),
}))

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

vi.mock('@/service/client', () => ({
  marketplaceClient: {
    collections: (...args: unknown[]) => mockCollections(...args),
    collectionPlugins: (...args: unknown[]) => mockCollectionPlugins(...args),
  },
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
  return { Wrapper, queryClient }
}

describe('useMarketplaceCollectionsAndPlugins (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCollections.mockResolvedValue({
      data: {
        collections: [
          { name: 'col-1', label: {}, description: {}, rule: '', created_at: '', updated_at: '' },
        ],
      },
    })
    mockCollectionPlugins.mockResolvedValue({
      data: {
        plugins: [{ type: 'plugin', org: 'test', name: 'p1', tags: [] }],
      },
    })
  })

  it('should fetch collections with real QueryClient when query is triggered', async () => {
    const { useMarketplaceCollectionsAndPlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins(), { wrapper: Wrapper })

    // Trigger query
    result.current.queryMarketplaceCollectionsAndPlugins({ condition: 'category=tool' })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.marketplaceCollections).toBeDefined()
    expect(result.current.marketplaceCollectionPluginsMap).toBeDefined()
  })

  it('should handle query with empty params (truthy)', async () => {
    const { useMarketplaceCollectionsAndPlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins(), { wrapper: Wrapper })

    result.current.queryMarketplaceCollectionsAndPlugins({})

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
  })

  it('should handle query without arguments (falsy branch)', async () => {
    const { useMarketplaceCollectionsAndPlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins(), { wrapper: Wrapper })

    // Call without arguments → query is undefined → falsy branch
    result.current.queryMarketplaceCollectionsAndPlugins()

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
  })
})

describe('useMarketplacePluginsByCollectionId (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCollectionPlugins.mockResolvedValue({
      data: {
        plugins: [{ type: 'plugin', org: 'test', name: 'p1', tags: [] }],
      },
    })
  })

  it('should return empty when collectionId is undefined', async () => {
    const { useMarketplacePluginsByCollectionId } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePluginsByCollectionId(undefined),
      { wrapper: Wrapper },
    )

    expect(result.current.plugins).toEqual([])
  })

  it('should fetch plugins when collectionId is provided', async () => {
    const { useMarketplacePluginsByCollectionId } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePluginsByCollectionId('collection-1'),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.plugins.length).toBeGreaterThan(0)
  })
})

describe('useMarketplacePlugins (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPostMarketplaceShouldFail = false
  })

  it('should return initial state without query', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    expect(result.current.plugins).toBeUndefined()
    expect(result.current.total).toBeUndefined()
    expect(result.current.page).toBe(0)
    expect(result.current.isLoading).toBe(false)
  })

  it('should show isLoading during initial fetch', async () => {
    // Delay the response so we can observe the loading state
    const { postMarketplace } = await import('@/service/base')
    vi.mocked(postMarketplace).mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({
        data: { plugins: [], total: 0 },
      }), 200)
    }))

    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({ query: 'loading-test' })

    // The isLoading should be true while fetching with no data
    // (isPending || (isFetching && !data))
    await waitFor(() => {
      expect(result.current.isLoading).toBe(true)
    })

    // Eventually completes
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
  })

  it('should fetch plugins when queryPlugins is called', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({
      query: 'test',
      category: 'tool',
      sort_by: 'install_count',
      sort_order: 'DESC',
      page_size: 40,
    })

    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })

    expect(result.current.plugins!.length).toBeGreaterThan(0)
    expect(result.current.total).toBe(1)
    expect(result.current.page).toBe(1)
  })

  it('should handle bundle type query', async () => {
    mockPostMarketplaceShouldFail = false
    const bundleResponse = {
      data: {
        plugins: [],
        bundles: [{ type: 'bundle', org: 'test', name: 'b1', tags: [], description: 'desc', labels: {} }],
        total: 1,
      },
    }
    const { postMarketplace } = await import('@/service/base')
    vi.mocked(postMarketplace).mockResolvedValueOnce(bundleResponse)

    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({
      query: 'test',
      type: 'bundle',
      page_size: 40,
    })

    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })
  })

  it('should handle API error gracefully', async () => {
    mockPostMarketplaceShouldFail = true

    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({
      query: 'failing',
    })

    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })

    expect(result.current.plugins).toEqual([])
    expect(result.current.total).toBe(0)
  })

  it('should reset plugins state', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({ query: 'test' })

    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })

    result.current.resetPlugins()

    await waitFor(() => {
      expect(result.current.plugins).toBeUndefined()
    })
  })

  it('should use default page_size of 40 when not provided', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({
      query: 'test',
      category: 'all',
    })

    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })
  })

  it('should handle queryPluginsWithDebounced', async () => {
    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPluginsWithDebounced({
      query: 'debounced',
    })

    // Real useDebounceFn has 500ms wait, so increase timeout
    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    }, { timeout: 3000 })
  })

  it('should handle response with bundles field (bundles || plugins fallback)', async () => {
    const { postMarketplace } = await import('@/service/base')
    vi.mocked(postMarketplace).mockResolvedValueOnce({
      data: {
        bundles: [{ type: 'bundle', org: 'test', name: 'b1', tags: [], description: 'desc', labels: {} }],
        plugins: [{ type: 'plugin', org: 'test', name: 'p1', tags: [] }],
        total: 2,
      },
    })

    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({
      query: 'test-bundles-fallback',
      type: 'bundle',
    })

    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })

    // Should use bundles (truthy first in || chain)
    expect(result.current.plugins!.length).toBeGreaterThan(0)
  })

  it('should handle response with no bundles and no plugins (empty fallback)', async () => {
    const { postMarketplace } = await import('@/service/base')
    vi.mocked(postMarketplace).mockResolvedValueOnce({
      data: {
        total: 0,
      },
    })

    const { useMarketplacePlugins } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(), { wrapper: Wrapper })

    result.current.queryPlugins({
      query: 'test-empty-fallback',
    })

    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })

    expect(result.current.plugins).toEqual([])
  })
})
