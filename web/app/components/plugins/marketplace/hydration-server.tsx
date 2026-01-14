import type { SearchParams } from 'nuqs'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createLoader } from 'nuqs/server'
import { getQueryClientServer } from '@/context/query-client-server'
import { marketplaceQuery } from '@/service/client'
import { PLUGIN_CATEGORY_WITH_COLLECTIONS } from './constants'
import { marketplaceSearchParamsParsers } from './search-params'
import { getCollectionsParams, getMarketplaceCollectionsAndPlugins } from './utils'

// The server side logic should move to marketplace's codebase so that we can get rid of Next.js

async function getDehydratedState(searchParams?: Promise<SearchParams>) {
  if (!searchParams) {
    return
  }
  const loadSearchParams = createLoader(marketplaceSearchParamsParsers)
  const params = await loadSearchParams(searchParams)

  if (!PLUGIN_CATEGORY_WITH_COLLECTIONS.has(params.category)) {
    return
  }

  const queryClient = getQueryClientServer()

  await queryClient.prefetchQuery({
    queryKey: marketplaceQuery.collections.queryKey({ input: { query: getCollectionsParams(params.category) } }),
    queryFn: () => getMarketplaceCollectionsAndPlugins(getCollectionsParams(params.category)),
  })
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
