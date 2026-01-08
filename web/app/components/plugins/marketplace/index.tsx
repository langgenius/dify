import { dehydrate } from '@tanstack/react-query'
import { getQueryClient } from '@/context/query-client-server'
import { MarketplaceClient } from './marketplace-client'
import { marketplaceKeys } from './query-keys'
import { getCollectionsParams, getMarketplaceCollectionsAndPlugins } from './utils'

type MarketplaceProps = {
  showInstallButton?: boolean
  pluginTypeSwitchClassName?: string
  params: {
    q: string
    category: string
    tags: string[]
  }
}

async function Marketplace({
  showInstallButton = true,
  pluginTypeSwitchClassName,
  params,
}: MarketplaceProps) {
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
