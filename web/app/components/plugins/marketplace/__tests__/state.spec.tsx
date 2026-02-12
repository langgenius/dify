import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
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

const createWrapper = (searchParams = '') => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <NuqsTestingAdapter searchParams={searchParams}>
          {children}
        </NuqsTestingAdapter>
      </QueryClientProvider>
    </JotaiProvider>
  )
  return { Wrapper, queryClient }
}

describe('useMarketplaceData', () => {
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
    mockSearchAdvanced.mockResolvedValue({
      data: {
        plugins: [{ type: 'plugin', org: 'test', name: 'p2', tags: [] }],
        total: 1,
      },
    })
  })

  it('should return initial state with loading and collections data', async () => {
    const { useMarketplaceData } = await import('../state')
    const { Wrapper } = createWrapper('?category=all')

    // Create a mock container for scroll
    const container = document.createElement('div')
    container.id = 'marketplace-container'
    document.body.appendChild(container)

    const { result } = renderHook(() => useMarketplaceData(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.marketplaceCollections).toBeDefined()
    expect(result.current.marketplaceCollectionPluginsMap).toBeDefined()
    expect(result.current.page).toBeDefined()
    expect(result.current.isFetchingNextPage).toBe(false)

    document.body.removeChild(container)
  })

  it('should return search mode data when search text is present', async () => {
    const { useMarketplaceData } = await import('../state')
    const { Wrapper } = createWrapper('?category=all&q=test')

    const container = document.createElement('div')
    container.id = 'marketplace-container'
    document.body.appendChild(container)

    const { result } = renderHook(() => useMarketplaceData(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.plugins).toBeDefined()
    expect(result.current.pluginsTotal).toBeDefined()

    document.body.removeChild(container)
  })

  it('should return plugins undefined in collection mode (not search mode)', async () => {
    const { useMarketplaceData } = await import('../state')
    // "all" category with no search → collection mode
    const { Wrapper } = createWrapper('?category=all')

    const container = document.createElement('div')
    container.id = 'marketplace-container'
    document.body.appendChild(container)

    const { result } = renderHook(() => useMarketplaceData(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // In non-search mode, plugins should be undefined since useMarketplacePlugins is disabled
    expect(result.current.plugins).toBeUndefined()

    document.body.removeChild(container)
  })

  it('should enable search for category without collections (e.g. model)', async () => {
    const { useMarketplaceData } = await import('../state')
    const { Wrapper } = createWrapper('?category=model')

    const container = document.createElement('div')
    container.id = 'marketplace-container'
    document.body.appendChild(container)

    const { result } = renderHook(() => useMarketplaceData(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // "model" triggers search mode automatically
    expect(result.current.plugins).toBeDefined()

    document.body.removeChild(container)
  })

  it('should trigger scroll pagination via handlePageChange callback', async () => {
    // Return enough data to indicate hasNextPage (40 of 200 total)
    mockSearchAdvanced.mockResolvedValue({
      data: {
        plugins: Array.from({ length: 40 }, (_, i) => ({
          type: 'plugin',
          org: 'test',
          name: `p${i}`,
          tags: [],
        })),
        total: 200,
      },
    })

    const { useMarketplaceData } = await import('../state')
    // Use "model" to force search mode
    const { Wrapper } = createWrapper('?category=model')

    const container = document.createElement('div')
    container.id = 'marketplace-container'
    document.body.appendChild(container)

    Object.defineProperty(container, 'scrollTop', { value: 900, writable: true, configurable: true })
    Object.defineProperty(container, 'scrollHeight', { value: 1000, writable: true, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 200, writable: true, configurable: true })

    const { result } = renderHook(() => useMarketplaceData(), { wrapper: Wrapper })

    // Wait for data to fully load (isFetching becomes false, plugins become available)
    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
      expect(result.current.plugins!.length).toBeGreaterThan(0)
    })

    // Trigger scroll event to invoke handlePageChange
    const scrollEvent = new Event('scroll')
    Object.defineProperty(scrollEvent, 'target', { value: container })
    container.dispatchEvent(scrollEvent)

    document.body.removeChild(container)
  })

  it('should handle tags filter in search mode', async () => {
    const { useMarketplaceData } = await import('../state')
    // tags in URL triggers search mode
    const { Wrapper } = createWrapper('?category=all&tags=search')

    const container = document.createElement('div')
    container.id = 'marketplace-container'
    document.body.appendChild(container)

    const { result } = renderHook(() => useMarketplaceData(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Tags triggers search mode even with "all" category
    expect(result.current.plugins).toBeDefined()

    document.body.removeChild(container)
  })

  it('should not fetch next page when scroll fires but no more data', async () => {
    // Return only 2 items with total=2 → no more pages
    mockSearchAdvanced.mockResolvedValue({
      data: {
        plugins: [
          { type: 'plugin', org: 'test', name: 'p1', tags: [] },
          { type: 'plugin', org: 'test', name: 'p2', tags: [] },
        ],
        total: 2,
      },
    })

    const { useMarketplaceData } = await import('../state')
    const { Wrapper } = createWrapper('?category=model')

    const container = document.createElement('div')
    container.id = 'marketplace-container'
    document.body.appendChild(container)

    Object.defineProperty(container, 'scrollTop', { value: 900, writable: true, configurable: true })
    Object.defineProperty(container, 'scrollHeight', { value: 1000, writable: true, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 200, writable: true, configurable: true })

    const { result } = renderHook(() => useMarketplaceData(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.plugins).toBeDefined()
    })

    // Scroll fires but hasNextPage is false → handlePageChange does nothing
    const scrollEvent = new Event('scroll')
    Object.defineProperty(scrollEvent, 'target', { value: container })
    container.dispatchEvent(scrollEvent)

    // isFetchingNextPage should remain false
    expect(result.current.isFetchingNextPage).toBe(false)

    document.body.removeChild(container)
  })
})
