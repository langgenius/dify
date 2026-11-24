import type { ReactNode } from 'react'
import type { Plugin } from '@/app/components/plugins/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { marketplaceQuery } from '@/service/marketplace'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'

const collectionPlugins = vi.hoisted(() => vi.fn())
const getMarketplaceCollectionsAndPlugins = vi.hoisted(() => vi.fn())

vi.mock('@/service/marketplace', async (importOriginal) => {
  const { withMarketplaceResponses } = await import('@/test/marketplace-service')
  return withMarketplaceResponses(await importOriginal(), { collectionPlugins })
})

vi.mock('../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils')>()),
  getMarketplaceCollectionsAndPlugins,
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

const collectionPluginsResponse = (pluginId: string) => ({
  data: { plugins: [createMarketplacePluginFixture({ plugin_id: pluginId })] },
})

describe('useMarketplacePluginsByCollectionId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show loading while the first collection request is pending', async () => {
    collectionPlugins.mockImplementation(() => new Promise(() => {}))
    const { useMarketplacePluginsByCollectionId } = await import('../hooks')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePluginsByCollectionId('__model-settings-pinned-models'),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(collectionPlugins).toHaveBeenCalledTimes(1)
    })

    expect(collectionPlugins).toHaveBeenCalledWith(
      { params: { collectionId: '__model-settings-pinned-models' }, body: {} },
      expect.anything(),
    )
    expect(result.current.isLoading).toBe(true)
  })

  it('should retain collection results while refreshing cached data', async () => {
    let resolveRefresh: (() => void) | undefined
    collectionPlugins
      .mockResolvedValueOnce(collectionPluginsResponse('cached-plugin'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = () => resolve(collectionPluginsResponse('refreshed-plugin'))
          }),
      )

    const { useMarketplacePluginsByCollectionId } = await import('../hooks')
    const { Wrapper, queryClient } = createWrapper()
    const { result } = renderHook(
      () => useMarketplacePluginsByCollectionId('__model-settings-pinned-models'),
      { wrapper: Wrapper },
    )
    const pluginIds = () => result.current.plugins.map((plugin) => plugin.plugin_id)

    await waitFor(() => {
      expect(pluginIds()).toEqual(['cached-plugin'])
    })

    act(() => {
      void queryClient.invalidateQueries({ queryKey: marketplaceQuery.collectionPlugins.key() })
    })

    await waitFor(() => {
      expect(collectionPlugins).toHaveBeenCalledTimes(2)
    })

    expect(pluginIds()).toEqual(['cached-plugin'])
    expect(result.current.isLoading).toBe(false)

    await act(async () => {
      resolveRefresh?.()
    })

    await waitFor(() => {
      expect(pluginIds()).toEqual(['refreshed-plugin'])
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
      void queryClient.invalidateQueries({ queryKey: marketplaceQuery.collections.key() })
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
    name: pluginID,
    org: 'dify',
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
    const searchKey = (params: typeof toolParams | typeof modelParams) =>
      marketplaceQuery.searchAdvanced.key({
        type: 'infinite',
        input: {
          params: { kind: 'plugins' },
          body: {
            page: 1,
            page_size: params.page_size,
            query: params.query,
            category: params.category,
          },
        },
      })
    const toolQueryKey = searchKey(toolParams)
    const modelQueryKey = searchKey(modelParams)
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
