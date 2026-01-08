import type { DehydratedState } from '@tanstack/react-query'
import type { SearchParams } from 'nuqs'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createLoader } from 'nuqs/server'
import { TanstackQueryInitializer } from '@/context/query-client'
import { getQueryClientServer } from '@/context/query-client-server'
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
 * TODO: This server component should move to marketplace's codebase so that we can get rid of Next.js
 */
const Marketplace = async ({
  showInstallButton = true,
  pluginTypeSwitchClassName,
  searchParams,
}: MarketplaceProps) => {
  let dehydratedState: DehydratedState | undefined

  if (searchParams) {
    const loadSearchParams = createLoader(marketplaceSearchParamsParsers)
    const params = await loadSearchParams(searchParams)
    const queryClient = getQueryClientServer()

    await queryClient.prefetchQuery({
      queryKey: marketplaceKeys.collections(getCollectionsParams(params.category)),
      queryFn: () => getMarketplaceCollectionsAndPlugins(getCollectionsParams(params.category)),
    })
    dehydratedState = dehydrate(queryClient)
  }

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
