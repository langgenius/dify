import { MarketplaceContextProvider } from './context'
import Description from './description'
import IntersectionLine from './intersection-line'
import SearchBox from './search-box'
import PluginTypeSwitch from './plugin-type-switch'
import ListWrapper from './list/list-wrapper'
import { getMarketplaceCollectionsAndPlugins } from './utils'

const Marketplace = async () => {
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
      />
    </MarketplaceContextProvider>
  )
}

export default Marketplace
