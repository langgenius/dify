import {
  useEffect,
  useMemo,
} from 'react'
import {
  useMarketplaceCollectionsAndPlugins,
  useMarketplacePlugins,
} from '@/app/components/plugins/marketplace/hooks'
import { PluginType } from '@/app/components/plugins/types'
import { getMarketplaceListCondition } from '@/app/components/plugins/marketplace/utils'
import { useAllToolProviders } from '@/service/use-tools'

export const useMarketplace = (searchPluginText: string, filterPluginTags: string[]) => {
  const { data: toolProvidersData, isSuccess } = useAllToolProviders()
  const exclude = useMemo(() => {
    if (isSuccess)
      return toolProvidersData?.filter(toolProvider => !!toolProvider.plugin_id).map(toolProvider => toolProvider.plugin_id!)
  }, [isSuccess, toolProvidersData])
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
    if ((searchPluginText || filterPluginTags.length) && isSuccess) {
      if (searchPluginText) {
        queryPluginsWithDebounced({
          category: PluginType.tool,
          query: searchPluginText,
          tags: filterPluginTags,
          exclude,
        })
        return
      }
      queryPlugins({
        category: PluginType.tool,
        query: searchPluginText,
        tags: filterPluginTags,
        exclude,
      })
    }
    else {
      if (isSuccess) {
        queryMarketplaceCollectionsAndPlugins({
          category: PluginType.tool,
          condition: getMarketplaceListCondition(PluginType.tool),
          exclude,
        })
        resetPlugins()
      }
    }
  }, [searchPluginText, filterPluginTags, queryPlugins, queryMarketplaceCollectionsAndPlugins, queryPluginsWithDebounced, resetPlugins, exclude, isSuccess])

  return {
    isLoading: isLoading || isPluginsLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    plugins,
  }
}
