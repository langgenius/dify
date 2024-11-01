import {
  useEffect,
} from 'react'
import {
  useMarketplaceCollectionsAndPlugins,
  useMarketplacePlugins,
} from '@/app/components/plugins/marketplace/hooks'

export const useMarketplace = (searchPluginText: string, filterPluginTags: string[]) => {
  const {
    isLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    queryMarketplaceCollectionsAndPlugins,
  } = useMarketplaceCollectionsAndPlugins()
  const {
    plugins,
    setPlugins,
    queryPlugins,
    queryPluginsWithDebounced,
    isLoading: isPluginsLoading,
  } = useMarketplacePlugins()

  useEffect(() => {
    if (searchPluginText || filterPluginTags.length) {
      if (searchPluginText) {
        queryPluginsWithDebounced({
          query: searchPluginText,
          tags: filterPluginTags,
        })
        return
      }
      queryPlugins({
        query: searchPluginText,
        tags: filterPluginTags,
      })
    }
    else {
      queryMarketplaceCollectionsAndPlugins()
      setPlugins([])
    }
  }, [searchPluginText, filterPluginTags, queryPlugins, queryMarketplaceCollectionsAndPlugins, queryPluginsWithDebounced, setPlugins])

  return {
    isLoading: isLoading || isPluginsLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    plugins,
  }
}
