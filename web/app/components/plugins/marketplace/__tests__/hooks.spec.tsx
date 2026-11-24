import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { marketplaceQuery } from '@/service/marketplace'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'

const collectionPlugins = vi.hoisted(() => vi.fn())

vi.mock('@/service/marketplace', async (importOriginal) => {
  const { withMarketplaceResponses } = await import('@/test/marketplace-service')
  return withMarketplaceResponses(await importOriginal(), { collectionPlugins })
})

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
