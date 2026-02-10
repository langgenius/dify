import type { CreatorSearchParams, PluginsSearchParams, TemplateSearchParams, UnifiedSearchParams } from './types'
import type { MarketPlaceInputs } from '@/contract/router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { marketplaceQuery } from '@/service/client'
import { getMarketplaceCollectionsAndPlugins, getMarketplaceCreators, getMarketplacePlugins, getMarketplaceTemplateCollectionsAndTemplates, getMarketplaceTemplates, getMarketplaceUnifiedSearch } from './utils'

export function useMarketplaceCollectionsAndPlugins(
  collectionsParams: MarketPlaceInputs['plugins']['collections']['query'],
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: marketplaceQuery.plugins.collections.queryKey({ input: { query: collectionsParams } }),
    queryFn: ({ signal }) => getMarketplaceCollectionsAndPlugins(collectionsParams, { signal }),
    enabled: options?.enabled !== false,
  })
}

export function useMarketplaceTemplateCollectionsAndTemplates(
  query?: { page?: number, page_size?: number, condition?: string },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: marketplaceQuery.templateCollections.list.queryKey({ input: { query } }),
    queryFn: ({ signal }) => getMarketplaceTemplateCollectionsAndTemplates(query, { signal }),
    enabled: options?.enabled !== false,
  })
}

export function useMarketplacePlugins(
  queryParams: PluginsSearchParams | undefined,
  options?: { enabled?: boolean },
) {
  return useInfiniteQuery({
    queryKey: marketplaceQuery.plugins.searchAdvanced.queryKey({
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
    enabled: options?.enabled !== false && queryParams !== undefined,
  })
}

export function useMarketplaceTemplates(
  queryParams: TemplateSearchParams | undefined,
  options?: { enabled?: boolean },
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
    enabled: options?.enabled !== false && queryParams !== undefined,
  })
}

export function useMarketplaceCreators(
  queryParams: CreatorSearchParams | undefined,
) {
  return useInfiniteQuery({
    queryKey: marketplaceQuery.creators.searchAdvanced.queryKey({
      input: {
        body: queryParams!,
      },
    }),
    queryFn: ({ pageParam = 1, signal }) => getMarketplaceCreators(queryParams, pageParam, signal),
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1
      const loaded = lastPage.page * lastPage.page_size
      return loaded < (lastPage.total || 0) ? nextPage : undefined
    },
    initialPageParam: 1,
    enabled: queryParams !== undefined,
  })
}

export function useMarketplaceUnifiedSearch(
  queryParams: UnifiedSearchParams | undefined,
) {
  return useQuery({
    queryKey: marketplaceQuery.searchUnified.queryKey({
      input: { body: queryParams! },
    }),
    queryFn: ({ signal }) => getMarketplaceUnifiedSearch(queryParams, signal),
    enabled: queryParams !== undefined,
  })
}
