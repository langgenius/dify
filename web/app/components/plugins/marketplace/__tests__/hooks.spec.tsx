import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'

const getMarketplacePluginsByCollectionId = vi.hoisted(() => vi.fn())
const getMarketplaceCollectionsAndPlugins = vi.hoisted(() => vi.fn())

vi.mock('@/service/base', () => ({
  postMarketplace: vi.fn(),
}))

vi.mock('../utils', () => ({
  getFormattedPlugin: (plugin: unknown) => plugin,
  getMarketplaceCollectionsAndPlugins,
  getMarketplacePluginsByCollectionId,
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  return { Wrapper, queryClient }
}

describe('useMarketplacePluginsByCollectionId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show loading while the first collection request is pending', async () => {
    getMarketplacePluginsByCollectionId.mockImplementation(() => new Promise(() => {}))
    const { useMarketplacePluginsByCollectionId } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePluginsByCollectionId('__model-settings-pinned-models'),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(getMarketplacePluginsByCollectionId).toHaveBeenCalledTimes(1)
    })

    expect(result.current.isLoading).toBe(true)
  })

  it('should retain collection results while refreshing cached data', async () => {
    let resolveRefresh: (() => void) | undefined
    getMarketplacePluginsByCollectionId
      .mockResolvedValueOnce([{ plugin_id: 'cached-plugin', type: 'plugin' }])
      .mockImplementationOnce(
        () =>
          new Promise<{ plugin_id: string; type: string }[]>((resolve) => {
            resolveRefresh = () => resolve([{ plugin_id: 'refreshed-plugin', type: 'plugin' }])
          }),
      )

    const { useMarketplacePluginsByCollectionId } = await import('../hooks')
    const { Wrapper, queryClient } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePluginsByCollectionId('__model-settings-pinned-models'),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.plugins).toEqual([{ plugin_id: 'cached-plugin', type: 'plugin' }])
    })

    act(() => {
      void queryClient.invalidateQueries({ queryKey: ['marketplaceCollectionPlugins'] })
    })

    await waitFor(() => {
      expect(getMarketplacePluginsByCollectionId).toHaveBeenCalledTimes(2)
    })

    expect(result.current.plugins).toEqual([{ plugin_id: 'cached-plugin', type: 'plugin' }])
    expect(result.current.isLoading).toBe(false)

    await act(async () => {
      resolveRefresh?.()
    })

    await waitFor(() => {
      expect(result.current.plugins).toEqual([{ plugin_id: 'refreshed-plugin', type: 'plugin' }])
    })
  })
})

describe('useMarketplaceCollectionsAndPlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should retain collection results while refreshing cached data', async () => {
    let resolveRefresh: (() => void) | undefined
    getMarketplaceCollectionsAndPlugins
      .mockResolvedValueOnce({
        marketplaceCollections: [{ id: 'cached-collection' }],
        marketplaceCollectionPluginsMap: {},
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = () =>
              resolve({
                marketplaceCollections: [{ id: 'refreshed-collection' }],
                marketplaceCollectionPluginsMap: {},
              })
          }),
      )

    const { useMarketplaceCollectionsAndPlugins } = await import('../hooks')
    const { Wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useMarketplaceCollectionsAndPlugins(), {
      wrapper: Wrapper,
    })

    act(() => {
      result.current.queryMarketplaceCollectionsAndPlugins()
    })

    await waitFor(() => {
      expect(result.current.marketplaceCollections).toEqual([{ id: 'cached-collection' }])
    })

    act(() => {
      void queryClient.invalidateQueries({ queryKey: ['marketplaceCollectionsAndPlugins'] })
    })

    await waitFor(() => {
      expect(getMarketplaceCollectionsAndPlugins).toHaveBeenCalledTimes(2)
    })

    expect(result.current.marketplaceCollections).toEqual([{ id: 'cached-collection' }])
    expect(result.current.isLoading).toBe(false)

    await act(async () => {
      resolveRefresh?.()
    })

    await waitFor(() => {
      expect(result.current.marketplaceCollections).toEqual([{ id: 'refreshed-collection' }])
    })
  })
})
