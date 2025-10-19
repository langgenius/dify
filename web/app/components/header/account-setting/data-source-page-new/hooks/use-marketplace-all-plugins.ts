import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  useMarketplacePlugins,
} from '@/app/components/plugins/marketplace/hooks'
import type { Plugin } from '@/app/components/plugins/types'
import { PluginType } from '@/app/components/plugins/types'
import { getMarketplacePluginsByCollectionId } from '@/app/components/plugins/marketplace/utils'

export const useMarketplaceAllPlugins = (providers: any[], searchText: string) => {
  const exclude = useMemo(() => {
    return providers.map(provider => provider.plugin_id)
  }, [providers])
  const [collectionPlugins, setCollectionPlugins] = useState<Plugin[]>([])

  const {
    plugins,
    queryPlugins,
    queryPluginsWithDebounced,
    isLoading,
  } = useMarketplacePlugins()

  const getCollectionPlugins = useCallback(async () => {
    const collectionPlugins = await getMarketplacePluginsByCollectionId('__datasource-settings-pinned-datasources')

    setCollectionPlugins(collectionPlugins)
  }, [])

  useEffect(() => {
    getCollectionPlugins()
  }, [getCollectionPlugins])

  useEffect(() => {
    if (searchText) {
      queryPluginsWithDebounced({
        query: searchText,
        category: PluginType.datasource,
        exclude,
        type: 'plugin',
        sortBy: 'install_count',
        sortOrder: 'DESC',
      })
    }
    else {
      queryPlugins({
        query: '',
        category: PluginType.datasource,
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
    isLoading,
  }
}
