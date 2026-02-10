import type { SearchParams } from 'nuqs'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createLoader } from 'nuqs/server'
import { getQueryClientServer } from '@/context/query-client-server'
import { marketplaceQuery } from '@/service/client'
import { getValidatedPluginCategory, PLUGIN_CATEGORY_WITH_COLLECTIONS } from './constants'
import { CREATION_TYPE, marketplaceSearchParamsParsers } from './search-params'
import { getCollectionsParams, getMarketplaceCollectionsAndPlugins, getMarketplaceTemplateCollectionsAndTemplates } from './utils'

// The server side logic should move to marketplace's codebase so that we can get rid of Next.js

async function getDehydratedState(searchParams?: Promise<SearchParams>) {
  if (!searchParams) {
    return
  }
  const loadSearchParams = createLoader(marketplaceSearchParamsParsers)
  const params = await loadSearchParams(searchParams)
  const queryClient = getQueryClientServer()

  if (params.creationType === CREATION_TYPE.templates) {
    await queryClient.prefetchQuery({
      queryKey: marketplaceQuery.templateCollections.list.queryKey({ input: { query: undefined } }),
      queryFn: () => getMarketplaceTemplateCollectionsAndTemplates(),
    })
    return dehydrate(queryClient)
  }

  const pluginCategory = getValidatedPluginCategory(params.category)

  if (!PLUGIN_CATEGORY_WITH_COLLECTIONS.has(pluginCategory)) {
    return
  }

  const collectionsParams = getCollectionsParams(pluginCategory)
  await queryClient.prefetchQuery({
    queryKey: marketplaceQuery.plugins.collections.queryKey({ input: { query: collectionsParams } }),
    queryFn: () => getMarketplaceCollectionsAndPlugins(collectionsParams),
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
