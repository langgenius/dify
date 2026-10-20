import type { ReactNode } from 'react'
import type { marketplaceClient } from '@/service/marketplace'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { createTestQueryClient } from '@/test/query-client'
import { useMarketplaceCollectionsAndPlugins, useMarketplacePlugins } from '../query'

const { mockCollections, mockCollectionPlugins, mockSearchAdvanced } = vi.hoisted(() => ({
  mockCollections: vi.fn<typeof marketplaceClient.collections>(),
  mockCollectionPlugins: vi.fn<typeof marketplaceClient.collectionPlugins>(),
  mockSearchAdvanced: vi.fn<typeof marketplaceClient.searchAdvanced>(),
}))

vi.mock('@/service/marketplace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/marketplace')>()),
  marketplaceClient: {
    collections: mockCollections,
    collectionPlugins: mockCollectionPlugins,
    searchAdvanced: mockSearchAdvanced,
  },
}))

const createWrapper = () => {
  const queryClient = createTestQueryClient()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { Wrapper, queryClient }
}

beforeEach(() => {
  mockCollections.mockReset()
  mockCollectionPlugins.mockReset()
  mockSearchAdvanced.mockReset()
})

describe('useMarketplaceCollectionsAndPlugins', () => {
  it('should fetch collections and plugins data', async () => {
    const mockCollectionData = [
      {
        name: 'col-1',
        label: { en_US: 'Featured' },
        description: {},
        rule: '',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-01T00:00:00Z',
      },
    ]
    const mockPluginData = [createMarketplacePluginFixture({ org: 'test', name: 'plugin1' })]

    mockCollections.mockResolvedValue({ data: { collections: mockCollectionData } })
    mockCollectionPlugins.mockResolvedValue({ data: { plugins: mockPluginData } })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplaceCollectionsAndPlugins({ condition: 'category=tool', type: 'plugin' }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })

    expect(result.current.data?.marketplaceCollections).toEqual(mockCollectionData)
    expect(result.current.data?.marketplaceCollectionPluginsMap['col-1']).toEqual([
      expect.objectContaining({
        name: 'plugin1',
        icon: `${MARKETPLACE_API_PREFIX}/plugins/test/plugin1/icon`,
      }),
    ])
  })
})

describe('useMarketplacePlugins', () => {
  it('should not fetch when queryParams is undefined', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMarketplacePlugins(undefined), { wrapper: Wrapper })

    // enabled is false, so should not fetch
    expect(result.current.data).toBeUndefined()
    expect(mockSearchAdvanced).not.toHaveBeenCalled()
  })

  it('should fetch plugins when queryParams is provided', async () => {
    mockSearchAdvanced.mockResolvedValue({
      data: {
        plugins: [createMarketplacePluginFixture({ org: 'test', name: 'p1' })],
        total: 1,
      },
    })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () =>
        useMarketplacePlugins({
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
    expect(result.current.data?.pages[0]?.plugins).toEqual([
      expect.objectContaining({
        name: 'p1',
        icon: `${MARKETPLACE_API_PREFIX}/plugins/test/p1/icon`,
      }),
    ])
    expect(mockSearchAdvanced).toHaveBeenCalledExactlyOnceWith(
      {
        params: { kind: 'plugins' },
        body: {
          page: 1,
          page_size: 40,
          query: 'test',
          sort_by: 'install_count',
          sort_order: 'DESC',
          category: 'tool',
          tags: [],
        },
      },
      { signal: expect.any(AbortSignal) },
    )
  })

  it('should handle bundle type in query params', async () => {
    mockSearchAdvanced.mockResolvedValue({
      data: {
        plugins: [],
        bundles: [createMarketplacePluginFixture({ type: 'bundle', org: 'test', name: 'b1' })],
        total: 1,
      },
    })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () =>
        useMarketplacePlugins({
          query: 'bundle',
          type: 'bundle',
        }),
      { wrapper: Wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.pages[0]?.plugins).toEqual([
      expect.objectContaining({ name: 'b1', type: 'bundle' }),
    ])
    expect(mockSearchAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({ params: { kind: 'bundles' } }),
      expect.any(Object),
    )
  })

  it('should surface API errors instead of an empty success', async () => {
    mockSearchAdvanced.mockRejectedValue(new Error('Network error'))

    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () =>
        useMarketplacePlugins({
          query: 'fail',
        }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    // No synthesized page: an empty success let a backend outage render as
    // "no plugins found", suppressed retries, and permanently disabled
    // getNextPageParam for this key.
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toEqual(new Error('Network error'))
  })

  it('requests the next page and stops when the reported total is reached', async () => {
    const plugin = (name: string) => createMarketplacePluginFixture({ org: 'test', name })
    mockSearchAdvanced
      .mockResolvedValueOnce({ data: { plugins: [plugin('p1'), plugin('p2')], total: 3 } })
      .mockResolvedValueOnce({ data: { plugins: [plugin('p3')], total: 3 } })
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePlugins({ query: 'paginated', page_size: 2 }),
      { wrapper: Wrapper },
    )
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.hasNextPage).toBe(false))
    expect(
      result.current.data?.pages.flatMap((page) => page.plugins.map((item) => item.name)),
    ).toEqual(['p1', 'p2', 'p3'])
    expect(mockSearchAdvanced).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ page: 2, page_size: 2, query: 'paginated' }),
      }),
      expect.any(Object),
    )
  })
})
