import type { SearchParams } from 'nuqs'
import type { PluginsSearchParams } from './types'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createLoader } from 'nuqs/server'
import { getQueryClientServer } from '@/context/query-client-server'
import { marketplaceQuery } from '@/service/client'
import { DEFAULT_SORT, PLUGIN_CATEGORY_WITH_COLLECTIONS, PLUGIN_TYPE_SEARCH_MAP } from './constants'
import { marketplaceSearchParamsParsers } from './search-params'
import {
  getCollectionsParams,
  getMarketplaceCollectionsAndPlugins,
  getMarketplaceListFilterType,
  getMarketplacePlugins,
} from './utils'

// The server side logic should move to marketplace's codebase so that we can get rid of Next.js

async function getDehydratedState(searchParams?: Promise<SearchParams>) {
  if (!searchParams) {
    return
  }

  const loadSearchParams = createLoader(marketplaceSearchParamsParsers)
  const params = await loadSearchParams(searchParams)
  const queryClient = getQueryClientServer()
  const isSearchMode = !!params.q
    || params.tags.length > 0
    || !PLUGIN_CATEGORY_WITH_COLLECTIONS.has(params.category)
  const prefetchTasks: Array<Promise<unknown>> = []

  if (!isSearchMode && PLUGIN_CATEGORY_WITH_COLLECTIONS.has(params.category)) {
    prefetchTasks.push(queryClient.prefetchQuery({
      queryKey: marketplaceQuery.collections.queryKey({ input: { query: getCollectionsParams(params.category) } }),
      queryFn: () => getMarketplaceCollectionsAndPlugins(getCollectionsParams(params.category)),
    }))
  }

  if (isSearchMode) {
    const queryParams: PluginsSearchParams = {
      query: params.q,
      category: params.category === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : params.category,
      tags: params.tags,
      sort_by: DEFAULT_SORT.sortBy,
      sort_order: DEFAULT_SORT.sortOrder,
      type: getMarketplaceListFilterType(params.category),
    }

    prefetchTasks.push(queryClient.prefetchInfiniteQuery({
      queryKey: marketplaceQuery.searchAdvanced.queryKey({
        input: {
          body: queryParams,
          params: { kind: queryParams.type === 'bundle' ? 'bundles' : 'plugins' },
        },
      }),
      queryFn: ({ pageParam = 1, signal }) => getMarketplacePlugins(queryParams, Number(pageParam), signal),
      initialPageParam: 1,
    }))
  }

  if (!prefetchTasks.length) {
    return
  }

  await Promise.all(prefetchTasks)
  return dehydrate(queryClient)
}

export async function HydrateQueryClient({
  searchParams,
  children,
}: {
  searchParams: Promise<SearchParams> | undefined
  children: React.ReactNode
}) {
  const dehydratedState = await getDehydratedState(searchParams)
  return (
    <HydrationBoundary state={dehydratedState}>
      {children}
    </HydrationBoundary>
  )
}
