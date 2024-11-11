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
    resetPlugins,
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
      resetPlugins()
    }
  }, [searchPluginText, filterPluginTags, queryPlugins, queryMarketplaceCollectionsAndPlugins, queryPluginsWithDebounced, resetPlugins])

  return {
    isLoading: isLoading || isPluginsLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    plugins,
  }
}
