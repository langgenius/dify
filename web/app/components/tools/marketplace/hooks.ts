import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import type { Plugin } from '@/app/components/plugins/types'
import type { MarketplaceCollection } from '@/app/components/plugins/marketplace/types'

export const useMarketplace = () => {
  const [marketplaceCollections, setMarketplaceCollections] = useState<MarketplaceCollection[]>([])
  const [marketplaceCollectionPluginsMap, setMarketplaceCollectionPluginsMap] = useState<Record<string, Plugin[]>>({})
  const getMarketplaceCollections = useCallback(async () => {
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
    setMarketplaceCollections(marketplaceCollections)
    setMarketplaceCollectionPluginsMap(marketplaceCollectionPluginsMap)
  }, [])
  useEffect(() => {
    getMarketplaceCollections()
  }, [getMarketplaceCollections])

  return {
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
  }
}
