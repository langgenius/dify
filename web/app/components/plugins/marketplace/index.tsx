import { MarketplaceContextProvider } from './context'
import Description from './description'
import IntersectionLine from './intersection-line'
import SearchBox from './search-box'
import PluginTypeSwitch from './plugin-type-switch'
import ListWrapper from './list/list-wrapper'
import { getMarketplaceCollectionsAndPlugins } from './utils'

type MarketplaceProps = {
  showInstallButton?: boolean
}
const Marketplace = async ({
  showInstallButton = true,
}: MarketplaceProps) => {
  const { marketplaceCollections, marketplaceCollectionPluginsMap } = await getMarketplaceCollectionsAndPlugins()

  return (
    <MarketplaceContextProvider>
      <Description />
      <IntersectionLine />
      <SearchBox />
      <PluginTypeSwitch />
      <ListWrapper
        marketplaceCollections={marketplaceCollections}
        marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap}
        showInstallButton={showInstallButton}
      />
    </MarketplaceContextProvider>
  )
}

export default Marketplace
