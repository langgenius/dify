import type { DehydratedState } from '@tanstack/react-query'
import type { SearchParams } from 'nuqs'
import { dehydrate } from '@tanstack/react-query'
import { createLoader } from 'nuqs/server'
import { getQueryClient } from '@/context/query-client-server'
import { MarketplaceClient } from './marketplace-client'
import { marketplaceKeys } from './query-keys'
import { marketplaceSearchParamsParsers } from './search-params'
import { getCollectionsParams, getMarketplaceCollectionsAndPlugins } from './utils'

type MarketplaceProps = {
  showInstallButton?: boolean
  pluginTypeSwitchClassName?: string
  /**
   * Pass the search params from the request to prefetch data on the server
   */
  searchParams?: Promise<SearchParams>
}

async function Marketplace({
  showInstallButton = true,
  pluginTypeSwitchClassName,
  searchParams,
}: MarketplaceProps) {
  let dehydratedState: DehydratedState | undefined

  if (searchParams) {
    const loadSearchParams = createLoader(marketplaceSearchParamsParsers)
    const params = await loadSearchParams(searchParams)
    const queryClient = getQueryClient()

    await queryClient.prefetchQuery({
      queryKey: marketplaceKeys.collections(getCollectionsParams(params.category)),
      queryFn: () => getMarketplaceCollectionsAndPlugins(getCollectionsParams(params.category)),
    })
    dehydratedState = dehydrate(queryClient)
  }

  return (
    <MarketplaceClient
      showInstallButton={showInstallButton}
      pluginTypeSwitchClassName={pluginTypeSwitchClassName}
      dehydratedState={dehydratedState}
    />
  )
}

export default Marketplace
