import type { ReactNode } from 'react'
import type { Plugin } from '@/app/components/plugins/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { PluginCategoryEnum } from '@/app/components/plugins/types'

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

const createPlugin = (pluginID: string, category: PluginCategoryEnum) =>
  ({
    plugin_id: pluginID,
    type: 'plugin',
    category,
  }) as Plugin

const createInfiniteData = (plugin: Plugin, pageSize: number) => ({
  pages: [
    {
      plugins: [plugin],
      total: 1,
      page: 1,
      page_size: pageSize,
    },
  ],
  pageParams: [1],
})

const createWrapperWithQueryClient = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

describe('useMarketplacePlugins', () => {
  it('should reset local query params without removing marketplace plugin caches', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
      },
    })
    const toolPlugin = createPlugin('tool-plugin', PluginCategoryEnum.tool)
    const modelPlugin = createPlugin('model-plugin', PluginCategoryEnum.model)
    const toolParams = {
      query: 'search',
      category: PluginCategoryEnum.tool,
      type: 'plugin' as const,
      page_size: 40,
    }
    const modelParams = {
      query: '',
      category: PluginCategoryEnum.model,
      type: 'plugin' as const,
      page_size: 1000,
    }
    const toolQueryKey = ['marketplacePlugins', toolParams]
    const modelQueryKey = ['marketplacePlugins', modelParams]
    const toolQueryData = createInfiniteData(toolPlugin, toolParams.page_size)
    const modelQueryData = createInfiniteData(modelPlugin, modelParams.page_size)

    queryClient.setQueryData(toolQueryKey, toolQueryData)
    queryClient.setQueryData(modelQueryKey, modelQueryData)

    const { useMarketplacePlugins } = await import('../hooks')
    const { result } = renderHook(() => useMarketplacePlugins(), {
      wrapper: createWrapperWithQueryClient(queryClient),
    })

    act(() => {
      result.current.queryPlugins(toolParams)
    })

    await waitFor(() => {
      expect(result.current.plugins).toEqual([toolPlugin])
    })

    act(() => {
      result.current.resetQueryParams()
    })

    expect(result.current.plugins).toBeUndefined()
    expect(queryClient.getQueryData(toolQueryKey)).toEqual(toolQueryData)
    expect(queryClient.getQueryData(modelQueryKey)).toEqual(modelQueryData)
  })
})
