import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import type { Plugin } from '@/app/components/plugins/types'
import type { MarketplaceCollection } from '@/app/components/plugins/marketplace/types'
import { getMarketplaceCollectionsAndPlugins } from '@/app/components/plugins/marketplace/utils'

export const useMarketplace = () => {
  const [marketplaceCollections, setMarketplaceCollections] = useState<MarketplaceCollection[]>([])
  const [marketplaceCollectionPluginsMap, setMarketplaceCollectionPluginsMap] = useState<Record<string, Plugin[]>>({})
  const [isLoading, setIsLoading] = useState(true)
  const getMarketplaceCollections = useCallback(async () => {
    setIsLoading(true)
    const { marketplaceCollections, marketplaceCollectionPluginsMap } = await getMarketplaceCollectionsAndPlugins()
    setIsLoading(false)
    setMarketplaceCollections(marketplaceCollections)
    setMarketplaceCollectionPluginsMap(marketplaceCollectionPluginsMap)
  }, [])
  useEffect(() => {
    getMarketplaceCollections()
  }, [getMarketplaceCollections])

  return {
    isLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
  }
}
