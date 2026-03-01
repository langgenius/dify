import type { SearchParams } from 'nuqs'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDehydrate,
  mockGetCollectionsParams,
  mockGetMarketplaceCollectionsAndPlugins,
  mockGetMarketplaceListFilterType,
  mockGetMarketplacePlugins,
  mockPrefetchInfiniteQuery,
  mockPrefetchQuery,
} = vi.hoisted(() => ({
  mockDehydrate: vi.fn(() => ({ dehydrated: true })),
  mockGetCollectionsParams: vi.fn((category: string) => ({ category })),
  mockGetMarketplaceCollectionsAndPlugins: vi.fn(async () => ({ marketplaceCollections: [], marketplaceCollectionPluginsMap: {} })),
  mockGetMarketplaceListFilterType: vi.fn((category: string) => (category === 'bundle' ? 'bundle' : undefined)),
  mockGetMarketplacePlugins: vi.fn(async () => ({ plugins: [], total: 0, page: 1, page_size: 40 })),
  mockPrefetchInfiniteQuery: vi.fn(async (options: {
    queryFn: (context: { pageParam: number, signal: AbortSignal }) => Promise<unknown>
  }) => options.queryFn({ pageParam: 1, signal: new AbortController().signal })),
  mockPrefetchQuery: vi.fn(async (options: { queryFn: () => Promise<unknown> }) => options.queryFn()),
}))

vi.mock('@tanstack/react-query', () => ({
  dehydrate: mockDehydrate,
  HydrationBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/context/query-client-server', () => ({
  getQueryClientServer: () => ({
    prefetchQuery: mockPrefetchQuery,
    prefetchInfiniteQuery: mockPrefetchInfiniteQuery,
  }),
}))

vi.mock('@/service/client', () => ({
  marketplaceQuery: {
    collections: {
      queryKey: vi.fn((input: unknown) => ['collections', input]),
    },
    searchAdvanced: {
      queryKey: vi.fn((input: unknown) => ['searchAdvanced', input]),
    },
  },
}))

vi.mock('./utils', () => ({
  getCollectionsParams: mockGetCollectionsParams,
  getMarketplaceCollectionsAndPlugins: mockGetMarketplaceCollectionsAndPlugins,
  getMarketplaceListFilterType: mockGetMarketplaceListFilterType,
  getMarketplacePlugins: mockGetMarketplacePlugins,
}))

const renderHydration = async (searchParams?: SearchParams) => {
  const { HydrateQueryClient } = await import('./hydration-server')
  return HydrateQueryClient({
    searchParams: searchParams ? Promise.resolve(searchParams) : undefined,
    children: <div>children</div>,
  })
}

describe('HydrateQueryClient', () => {
  beforeEach(() => {
    mockDehydrate.mockClear()
    mockGetCollectionsParams.mockClear()
    mockGetMarketplaceCollectionsAndPlugins.mockClear()
    mockGetMarketplaceListFilterType.mockClear()
    mockGetMarketplacePlugins.mockClear()
    mockPrefetchInfiniteQuery.mockClear()
    mockPrefetchQuery.mockClear()
  })

  it('should prefetch collections query for default non-search mode', async () => {
    await renderHydration({ category: 'all' })

    expect(mockPrefetchQuery).toHaveBeenCalledTimes(1)
    expect(mockPrefetchInfiniteQuery).not.toHaveBeenCalled()
    expect(mockGetCollectionsParams).toHaveBeenCalledWith('all')
    expect(mockGetMarketplaceCollectionsAndPlugins).toHaveBeenCalledTimes(1)
    expect(mockGetMarketplacePlugins).not.toHaveBeenCalled()
    expect(mockDehydrate).toHaveBeenCalledTimes(1)
  })

  it('should prefetch searchAdvanced query when query text exists', async () => {
    await renderHydration({ category: 'all', q: 'search-term' })

    expect(mockPrefetchQuery).not.toHaveBeenCalled()
    expect(mockPrefetchInfiniteQuery).toHaveBeenCalledTimes(1)
    expect(mockGetMarketplaceCollectionsAndPlugins).not.toHaveBeenCalled()
    expect(mockGetMarketplacePlugins).toHaveBeenCalledWith(
      {
        query: 'search-term',
        category: undefined,
        tags: [],
        sort_by: 'install_count',
        sort_order: 'DESC',
        type: undefined,
      },
      1,
      expect.any(AbortSignal),
    )
    expect(mockDehydrate).toHaveBeenCalledTimes(1)
  })

  it('should prefetch searchAdvanced query for non-collection category', async () => {
    await renderHydration({ category: 'model' })

    expect(mockPrefetchQuery).not.toHaveBeenCalled()
    expect(mockPrefetchInfiniteQuery).toHaveBeenCalledTimes(1)
    expect(mockGetMarketplaceCollectionsAndPlugins).not.toHaveBeenCalled()
    expect(mockGetMarketplaceListFilterType).toHaveBeenCalledWith('model')
    expect(mockGetMarketplacePlugins).toHaveBeenCalledWith(
      {
        query: '',
        category: 'model',
        tags: [],
        sort_by: 'install_count',
        sort_order: 'DESC',
        type: undefined,
      },
      1,
      expect.any(AbortSignal),
    )
  })

  it('should skip prefetch when search params are missing', async () => {
    await renderHydration()

    expect(mockPrefetchQuery).not.toHaveBeenCalled()
    expect(mockPrefetchInfiniteQuery).not.toHaveBeenCalled()
    expect(mockDehydrate).not.toHaveBeenCalled()
  })
})
