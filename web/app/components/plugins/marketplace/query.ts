import type { PluginsSearchParams, TemplateSearchParams } from './types'
import type { MarketPlaceInputs } from '@/contract/router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { marketplaceQuery } from '@/service/client'
import { getMarketplaceCollectionsAndPlugins, getMarketplacePlugins, getMarketplaceTemplateCollectionsAndTemplates, getMarketplaceTemplates } from './utils'

export function useMarketplaceCollectionsAndPlugins(
  collectionsParams: MarketPlaceInputs['collections']['query'],
) {
  return useQuery({
    queryKey: marketplaceQuery.collections.queryKey({ input: { query: collectionsParams } }),
    queryFn: ({ signal }) => getMarketplaceCollectionsAndPlugins(collectionsParams, { signal }),
  })
}

export function useMarketplaceTemplateCollectionsAndTemplates(
  query?: { page?: number, page_size?: number, condition?: string },
) {
  return useQuery({
    queryKey: marketplaceQuery.templateCollections.list.queryKey({ input: { query } }),
    queryFn: ({ signal }) => getMarketplaceTemplateCollectionsAndTemplates(query, { signal }),
  })
}

export function useMarketplacePlugins(
  queryParams: PluginsSearchParams | undefined,
) {
  return useInfiniteQuery({
    queryKey: marketplaceQuery.searchAdvanced.queryKey({
      input: {
        body: queryParams!,
        params: { kind: queryParams?.type === 'bundle' ? 'bundles' : 'plugins' },
      },
    }),
    queryFn: ({ pageParam = 1, signal }) => getMarketplacePlugins(queryParams, pageParam, signal),
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1
      const loaded = lastPage.page * lastPage.page_size
      return loaded < (lastPage.total || 0) ? nextPage : undefined
    },
    initialPageParam: 1,
    enabled: queryParams !== undefined,
  })
}

export function useMarketplaceTemplates(
  queryParams: TemplateSearchParams | undefined,
) {
  return useInfiniteQuery({
    queryKey: marketplaceQuery.templates.searchAdvanced.queryKey({
      input: {
        body: queryParams!,
      },
    }),
    queryFn: ({ pageParam = 1, signal }) => getMarketplaceTemplates(queryParams, pageParam, signal),
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1
      const loaded = lastPage.page * lastPage.page_size
      return loaded < (lastPage.total || 0) ? nextPage : undefined
    },
    initialPageParam: 1,
    enabled: queryParams !== undefined,
  })
}
