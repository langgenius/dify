import type { SearchParams } from 'nuqs/server'
import type { MarketplaceSearchParams } from './search-params'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createLoader } from 'nuqs/server'
import { getQueryClient } from '@/app/get-query-client'
import { marketplaceQuery } from '@/service/client'
import { PLUGIN_CATEGORY_WITH_COLLECTIONS } from './constants'
import { getMarketplacePluginsInfiniteQueryOptions } from './query-options'
import {
  getMarketplacePluginsSearchParams,
  marketplaceSearchParamsParsers,
  shouldSearchMarketplacePlugins,
} from './search-params'
import { withinServerBudget } from './server-budget'
import { getCollectionsParams, getMarketplaceCollectionsAndPlugins } from './utils'

// The server side logic should move to marketplace's codebase so that we can get rid of Next.js

async function getDehydratedState(searchParams?: Promise<SearchParams>) {
  if (!searchParams) {
    return
  }
  const loadSearchParams = createLoader(marketplaceSearchParamsParsers)
  const params: MarketplaceSearchParams = await loadSearchParams(searchParams)

  const queryClient = getQueryClient()

  if (shouldSearchMarketplacePlugins(params)) {
    await withinServerBudget(
      queryClient.prefetchInfiniteQuery(
        getMarketplacePluginsInfiniteQueryOptions(getMarketplacePluginsSearchParams(params)),
      ),
    )
    return dehydrate(queryClient)
  }

  if (!PLUGIN_CATEGORY_WITH_COLLECTIONS.has(params.category)) return

  await withinServerBudget(
    queryClient.prefetchQuery({
      queryKey: marketplaceQuery.collections.queryKey({
        input: { query: getCollectionsParams(params.category) },
      }),
      queryFn: () => getMarketplaceCollectionsAndPlugins(getCollectionsParams(params.category)),
    }),
  )
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
  return <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>
}
