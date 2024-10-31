import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useDebounceFn } from 'ahooks'
import type { Plugin } from '@/app/components/plugins/types'
import type {
  MarketplaceCollection,
  PluginsSearchParams,
} from '@/app/components/plugins/marketplace/types'
import {
  getMarketplaceCollectionsAndPlugins,
  getMarketplacePlugins,
} from '@/app/components/plugins/marketplace/utils'

export const useMarketplace = (searchPluginText: string, filterPluginTags: string[]) => {
  const [marketplaceCollections, setMarketplaceCollections] = useState<MarketplaceCollection[]>([])
  const [marketplaceCollectionPluginsMap, setMarketplaceCollectionPluginsMap] = useState<Record<string, Plugin[]>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [plugins, setPlugins] = useState<Plugin[]>()

  const handleUpldateMarketplaceCollections = useCallback(async () => {
    setIsLoading(true)
    const { marketplaceCollections, marketplaceCollectionPluginsMap } = await getMarketplaceCollectionsAndPlugins()
    setIsLoading(false)

    setMarketplaceCollections(marketplaceCollections)
    setMarketplaceCollectionPluginsMap(marketplaceCollectionPluginsMap)
    setPlugins(undefined)
  }, [])

  const handleUpdatePlugins = async (query: PluginsSearchParams) => {
    setIsLoading(true)
    const { marketplacePlugins } = await getMarketplacePlugins(query)
    setIsLoading(false)

    setPlugins(marketplacePlugins)
  }

  const { run: handleUpdatePluginsWithDebounced } = useDebounceFn(handleUpdatePlugins, {
    wait: 500,
  })

  useEffect(() => {
    if (searchPluginText || filterPluginTags.length) {
      if (searchPluginText) {
        handleUpdatePluginsWithDebounced({
          query: searchPluginText,
          tags: filterPluginTags,
        })
        return
      }
      handleUpdatePlugins({
        query: searchPluginText,
        tags: filterPluginTags,
      })
    }
    else {
      handleUpldateMarketplaceCollections()
    }
  }, [searchPluginText, filterPluginTags, handleUpdatePluginsWithDebounced, handleUpldateMarketplaceCollections])

  return {
    isLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    plugins,
  }
}
