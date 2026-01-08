import { dehydrate } from '@tanstack/react-query'
import { getQueryClient } from '@/context/query-client-server'
import { MarketplaceClient } from './marketplace-client'
import { marketplaceKeys } from './query-keys'
import { getCollectionsParams, getMarketplaceCollectionsAndPlugins } from './utils'

type MarketplaceProps = {
  showInstallButton?: boolean
  pluginTypeSwitchClassName?: string
}

async function Marketplace({
  showInstallButton = true,
  pluginTypeSwitchClassName,
}: MarketplaceProps) {
  const queryClient = getQueryClient()

  await queryClient.prefetchQuery({
    queryKey: marketplaceKeys.collections(getCollectionsParams('all')),
    queryFn: () => getMarketplaceCollectionsAndPlugins(getCollectionsParams('all')),
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
