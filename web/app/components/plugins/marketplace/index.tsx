import type { SearchParams } from 'nuqs'
import { dehydrate } from '@tanstack/react-query'
import { createLoader } from 'nuqs/server'
import { getQueryClient } from '@/context/query-client-server'
import { marketplaceSearchParams } from './constants'
import { MarketplaceClient } from './marketplace-client'
import { marketplaceKeys } from './query-keys'
import { getCollectionsParams, getMarketplaceCollectionsAndPlugins } from './utils'

type MarketplaceProps = {
  showInstallButton?: boolean
  pluginTypeSwitchClassName?: string
  searchParams: Promise<SearchParams>
}

const loadSearchParams = createLoader(marketplaceSearchParams)

async function Marketplace({
  showInstallButton = true,
  pluginTypeSwitchClassName,
  searchParams,
}: MarketplaceProps) {
  const params = await loadSearchParams(searchParams)
  const queryClient = getQueryClient()

  await queryClient.prefetchQuery({
    queryKey: marketplaceKeys.collections(getCollectionsParams(params.category)),
    queryFn: () => getMarketplaceCollectionsAndPlugins(getCollectionsParams(params.category)),
  })

  return (
    <MarketplaceClient
      showInstallButton={showInstallButton}
      pluginTypeSwitchClassName={pluginTypeSwitchClassName}
      dehydratedState={dehydrate(queryClient)}
    />
  )
}

export default Marketplace
