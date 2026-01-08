import type { SearchParams } from 'nuqs'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createLoader } from 'nuqs/server'
import { TanstackQueryInitializer } from '@/context/query-client'
import { getQueryClientServer } from '@/context/query-client-server'
import { PLUGIN_CATEGORY_WITH_COLLECTIONS } from './constants'
import Description from './description'
import ListWrapper from './list/list-wrapper'
import { marketplaceKeys } from './query-keys'
import { marketplaceSearchParamsParsers } from './search-params'
import StickySearchAndSwitchWrapper from './sticky-search-and-switch-wrapper'
import { getCollectionsParams, getMarketplaceCollectionsAndPlugins } from './utils'

type MarketplaceProps = {
  showInstallButton?: boolean
  pluginTypeSwitchClassName?: string
  /**
   * Pass the search params from the request to prefetch data on the server
   */
  searchParams?: Promise<SearchParams>
}

/**
 * TODO: The server side logic should move to marketplace's codebase so that we can get rid of Next.js
 */
const Marketplace = async ({
  showInstallButton = true,
  pluginTypeSwitchClassName,
  searchParams,
}: MarketplaceProps) => {
  const dehydratedState = await getDehydratedState(searchParams)

  return (
    <TanstackQueryInitializer>
      <HydrationBoundary state={dehydratedState}>
        <Description />
        <StickySearchAndSwitchWrapper
          pluginTypeSwitchClassName={pluginTypeSwitchClassName}
        />
        <ListWrapper
          showInstallButton={showInstallButton}
        />
      </HydrationBoundary>
    </TanstackQueryInitializer>
  )
}

export default Marketplace

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
    queryKey: marketplaceKeys.collections(getCollectionsParams(params.category)),
    queryFn: () => getMarketplaceCollectionsAndPlugins(getCollectionsParams(params.category)),
  })
  return dehydrate(queryClient)
}
