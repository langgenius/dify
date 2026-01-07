import { dehydrate } from '@tanstack/react-query'
import { getQueryClient } from '@/context/query-client-server'
import { MarketplaceClient } from './marketplace-client'
import { marketplaceKeys } from './query-keys'
import { getMarketplaceCollectionsAndPlugins } from './utils'

type MarketplaceProps = {
  showInstallButton?: boolean
  pluginTypeSwitchClassName?: string
}

async function Marketplace({
  showInstallButton = true,
  pluginTypeSwitchClassName,
}: MarketplaceProps) {
  // const queryClient = getQueryClient()

  // // Prefetch collections and plugins for the default view (all categories)
  // await queryClient.prefetchQuery({
  //   queryKey: marketplaceKeys.collections({}),
  //   queryFn: () => getMarketplaceCollectionsAndPlugins({}),
  // })

  return (
    <MarketplaceClient
      showInstallButton={showInstallButton}
      pluginTypeSwitchClassName={pluginTypeSwitchClassName}
      // dehydratedState={dehydrate(queryClient)}
    />
  )
}

export default Marketplace
