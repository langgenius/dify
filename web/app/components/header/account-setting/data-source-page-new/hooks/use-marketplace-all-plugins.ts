import {
  useEffect,
  useMemo,
} from 'react'
import {
  useMarketplacePlugins,
  useMarketplacePluginsByCollectionId,
} from '@/app/components/plugins/marketplace/hooks'
import { PluginCategoryEnum } from '@/app/components/plugins/types'

export const useMarketplaceAllPlugins = (providers: any[], searchText: string) => {
  const exclude = useMemo(() => {
    return providers.map(provider => provider.plugin_id)
  }, [providers])
  const {
    plugins: collectionPlugins = [],
    isLoading: isCollectionLoading,
  } = useMarketplacePluginsByCollectionId('__datasource-settings-pinned-datasources')
  const {
    plugins,
    queryPlugins,
    queryPluginsWithDebounced,
    isLoading: isPluginsLoading,
  } = useMarketplacePlugins()

  useEffect(() => {
    if (searchText) {
      queryPluginsWithDebounced({
        query: searchText,
        category: PluginCategoryEnum.datasource,
        exclude,
        type: 'plugin',
        sortBy: 'install_count',
        sortOrder: 'DESC',
      })
    }
    else {
      queryPlugins({
        query: '',
        category: PluginCategoryEnum.datasource,
        type: 'plugin',
        pageSize: 1000,
        exclude,
        sortBy: 'install_count',
        sortOrder: 'DESC',
      })
    }
  }, [queryPlugins, queryPluginsWithDebounced, searchText, exclude])

  const allPlugins = useMemo(() => {
    const allPlugins = collectionPlugins.filter(plugin => !exclude.includes(plugin.plugin_id))

    if (plugins?.length) {
      for (let i = 0; i < plugins.length; i++) {
        const plugin = plugins[i]

        if (plugin.type !== 'bundle' && !allPlugins.find(p => p.plugin_id === plugin.plugin_id))
          allPlugins.push(plugin)
      }
    }

    return allPlugins
  }, [plugins, collectionPlugins, exclude])

  return {
    plugins: allPlugins,
    isLoading: isCollectionLoading || isPluginsLoading,
  }
}
