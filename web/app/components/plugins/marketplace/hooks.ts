import {
  useCallback,
  useState,
} from 'react'
import { useDebounceFn } from 'ahooks'
import type { Plugin } from '../types'
import type {
  CollectionsAndPluginsSearchParams,
  MarketplaceCollection,
  PluginsSearchParams,
} from './types'
import {
  getMarketplaceCollectionsAndPlugins,
  getMarketplacePlugins,
} from './utils'

export const useMarketplaceCollectionsAndPlugins = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [marketplaceCollections, setMarketplaceCollections] = useState<MarketplaceCollection[]>()
  const [marketplaceCollectionPluginsMap, setMarketplaceCollectionPluginsMap] = useState<Record<string, Plugin[]>>()

  const queryMarketplaceCollectionsAndPlugins = useCallback(async (query?: CollectionsAndPluginsSearchParams) => {
    setIsLoading(true)
    const { marketplaceCollections, marketplaceCollectionPluginsMap } = await getMarketplaceCollectionsAndPlugins(query)
    setIsLoading(false)

    setMarketplaceCollections(marketplaceCollections)
    setMarketplaceCollectionPluginsMap(marketplaceCollectionPluginsMap)
  }, [])

  return {
    marketplaceCollections,
    setMarketplaceCollections,
    marketplaceCollectionPluginsMap,
    setMarketplaceCollectionPluginsMap,
    queryMarketplaceCollectionsAndPlugins,
    isLoading,
  }
}

export const useMarketplacePlugins = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [plugins, setPlugins] = useState<Plugin[]>()

  const queryPlugins = useCallback(async (query: PluginsSearchParams) => {
    setIsLoading(true)
    const { marketplacePlugins } = await getMarketplacePlugins(query)
    setIsLoading(false)

    setPlugins(marketplacePlugins)
  }, [])

  const { run: queryPluginsWithDebounced } = useDebounceFn(queryPlugins, {
    wait: 500,
  })

  return {
    plugins,
    setPlugins,
    queryPlugins,
    queryPluginsWithDebounced,
    isLoading,
    setIsLoading,
  }
}
