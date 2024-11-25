import {
  useEffect,
} from 'react'
import {
  useMarketplaceCollectionsAndPlugins,
  useMarketplacePlugins,
} from '@/app/components/plugins/marketplace/hooks'
import { PluginType } from '@/app/components/plugins/types'
import { getMarketplaceListCondition } from '@/app/components/plugins/marketplace/utils'

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
          category: PluginType.tool,
          query: searchPluginText,
          tags: filterPluginTags,
        })
        return
      }
      queryPlugins({
        category: PluginType.tool,
        query: searchPluginText,
        tags: filterPluginTags,
      })
    }
    else {
      queryMarketplaceCollectionsAndPlugins({
        category: PluginType.tool,
        condition: getMarketplaceListCondition(PluginType.tool),
      })
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
