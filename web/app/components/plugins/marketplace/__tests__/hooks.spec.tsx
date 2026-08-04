import type { ReactNode } from 'react'
import type { Plugin } from '@/app/components/plugins/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useMarketplacePlugins } from '../hooks'

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

const createWrapper = (queryClient: QueryClient) =>
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

    const { result } = renderHook(() => useMarketplacePlugins(), {
      wrapper: createWrapper(queryClient),
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
