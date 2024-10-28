import type { Plugin } from '../types'
import { MarketplaceContextProvider } from './context'
import Description from './description'
import IntersectionLine from './intersection-line'
import SearchBox from './search-box'
import PluginTypeSwitch from './plugin-type-switch'
import ListWrapper from './list/list-wrapper'
import type { MarketplaceCollection } from './types'

const Marketplace = async () => {
  const marketplaceCollectionsData = await globalThis.fetch('https://marketplace.dify.dev/api/v1/collections')
  const marketplaceCollectionsDataJson = await marketplaceCollectionsData.json()
  const marketplaceCollections = marketplaceCollectionsDataJson.data.collections
  const marketplaceCollectionPluginsMap = {} as Record<string, Plugin[]>
  await Promise.all(marketplaceCollections.map(async (collection: MarketplaceCollection) => {
    const marketplaceCollectionPluginsData = await globalThis.fetch(`https://marketplace.dify.dev/api/v1/collections/${collection.name}/plugins`)
    const marketplaceCollectionPluginsDataJson = await marketplaceCollectionPluginsData.json()
    const plugins = marketplaceCollectionPluginsDataJson.data.plugins

    marketplaceCollectionPluginsMap[collection.name] = plugins
  }))

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
