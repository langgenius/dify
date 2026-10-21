import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { PLUGIN_TYPE_SEARCH_MAP } from '../constants'

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

vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceClient: {
      ...actual.marketplaceClient,
      collections: (...args: unknown[]) => mockCollections(...args),
      collectionPlugins: (...args: unknown[]) => mockCollectionPlugins(...args),
      searchAdvanced: (...args: unknown[]) => mockSearchAdvanced(...args),
    },
  }
})

const createWrapper = (searchParams = '') => {
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper({ searchParams })
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <NuqsWrapper>{children}</NuqsWrapper>
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

  afterEach(() => document.getElementById('marketplace-container')?.remove())

  it('loads collection contents without issuing a search', async () => {
    const { useMarketplaceData } = await import('../state')
    const { Wrapper } = createWrapper('?category=all')
    const { result } = renderHook(() => useMarketplaceData(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.marketplaceCollections).toEqual([
      expect.objectContaining({ name: 'col-1' }),
    ])
    expect(result.current.marketplaceCollectionPluginsMap).toMatchObject({
      'col-1': [{ name: 'p1' }],
    })
    expect(result.current.plugins).toBeUndefined()
    expect(mockSearchAdvanced).not.toHaveBeenCalled()
  })

  it.each([
    ['?category=all&q=test', { query: 'test' }],
    ['?category=model', { category: 'model' }],
    ['?category=all&tags=search', { tags: ['search'] }],
  ])('loads search results for %s without fetching collections', async (searchParams, body) => {
    const { useMarketplaceData } = await import('../state')
    const { Wrapper } = createWrapper(searchParams)
    const { result } = renderHook(() => useMarketplaceData(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.plugins).toEqual([expect.objectContaining({ name: 'p2' })])
    expect(result.current.pluginsTotal).toBe(1)
    expect(mockSearchAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining(body) }),
      expect.any(Object),
    )
    expect(mockCollections).not.toHaveBeenCalled()
  })

  it('restores collections and clears pending results when switching Models back to All', async () => {
    const { useMarketplaceData } = await import('../state')
    const { useActivePluginType } = await import('../atoms')
    const { Wrapper } = createWrapper('?category=model')
    const { result } = renderHook(
      () => ({
        data: useMarketplaceData(),
        setCategory: useActivePluginType()[1],
      }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.data.plugins).toHaveLength(1)
    })

    await act(async () => {
      await result.current.setCategory(PLUGIN_TYPE_SEARCH_MAP.all)
    })

    await waitFor(() => {
      expect(result.current.data.marketplaceCollections).toHaveLength(1)
      expect(result.current.data.plugins).toBeUndefined()
      expect(result.current.data.pluginsTotal).toBeUndefined()
      expect(result.current.data.isRefreshing).toBe(false)
    })
  })

  it('should use the server route category for hydrated standalone search', async () => {
    const { useMarketplaceData } = await import('../state')
    const { Wrapper } = createWrapper('?q=openai')

    const { result } = renderHook(() => useMarketplaceData(PLUGIN_TYPE_SEARCH_MAP.model), {
      wrapper: Wrapper,
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(mockSearchAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          category: 'model',
          query: 'openai',
        }),
      }),
      expect.any(Object),
    )
  })

  it('appends a scrolled page, deduplicates overlapping results and stops at the total', async () => {
    const plugin = (index: number) => ({ type: 'plugin', org: 'test', name: `p${index}`, tags: [] })
    mockSearchAdvanced
      .mockResolvedValueOnce({
        data: { plugins: Array.from({ length: 40 }, (_, index) => plugin(index)), total: 42 },
      })
      .mockResolvedValueOnce({ data: { plugins: [plugin(39), plugin(40)], total: 42 } })
    const { useMarketplaceData } = await import('../state')
    const { Wrapper } = createWrapper('?category=model')
    const container = document.createElement('div')
    container.id = 'marketplace-container'
    document.body.appendChild(container)
    Object.defineProperties(container, {
      scrollTop: { value: 900, configurable: true },
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 200, configurable: true },
    })
    const { result } = renderHook(() => useMarketplaceData(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.plugins).toHaveLength(40))
    fireEvent.scroll(container)
    await waitFor(() => expect(result.current.page).toBe(2))
    expect(result.current.plugins?.map((item) => item.name)).toEqual(
      Array.from({ length: 41 }, (_, index) => `p${index}`),
    )
    expect(mockSearchAdvanced).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ page: 2 }) }),
      expect.any(Object),
    )
    await act(async () => {
      fireEvent.scroll(container)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(mockSearchAdvanced).toHaveBeenCalledTimes(2)
    expect(result.current.isFetchingNextPage).toBe(false)
  })

  // Regression: `isSearchMode` was derived from the raw URL value while the
  // request body used the 500ms-debounced one. Keystroke #1 therefore flipped
  // the hook into search mode with an empty query, firing a full search for ''
  // whose generic top-plugins results rendered until the real ones replaced
  // them — the wrong-results flash at the start of every search session.
  it('should never issue an empty-query search when typing starts', async () => {
    const { useMarketplaceData } = await import('../state')
    const { useSearchPluginText } = await import('../atoms')
    const { Wrapper } = createWrapper('?category=all')

    const { result } = renderHook(
      () => ({
        data: useMarketplaceData(),
        setSearch: useSearchPluginText()[1],
      }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.data.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.setSearch('openai')
    })

    await waitFor(
      () => {
        expect(mockSearchAdvanced).toHaveBeenCalled()
      },
      { timeout: 3000 },
    )

    expect(mockSearchAdvanced).not.toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ query: '' }) }),
      expect.anything(),
    )
    expect(mockSearchAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ query: 'openai' }) }),
      expect.anything(),
    )
  })
})
