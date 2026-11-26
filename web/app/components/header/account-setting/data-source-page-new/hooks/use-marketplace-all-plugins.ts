import type { PluginsSearchParams } from '@dify/contracts/marketplace'
import { useDebounce } from 'ahooks'
import { useMemo } from 'react'
import { useMarketplacePluginsByCollectionId } from '@/app/components/plugins/marketplace/hooks'
import {
  MARKETPLACE_PANEL_CACHE_OPTIONS,
  useMarketplacePlugins,
} from '@/app/components/plugins/marketplace/query'
import { PluginCategoryEnum } from '@/app/components/plugins/types'

export const useMarketplaceAllPlugins = (providers: any[], searchText: string) => {
  const exclude = useMemo(() => {
    return providers.map((provider) => provider.plugin_id)
  }, [providers])
  const { plugins: collectionPlugins = [], isLoading: isCollectionLoading } =
    useMarketplacePluginsByCollectionId('__datasource-settings-pinned-datasources')
  // Typing waits 500 ms before searching; clearing the search lists the whole category at once.
  const debouncedSearchText = useDebounce(searchText, { wait: 500 })
  const marketplaceSearchParams = useMemo<PluginsSearchParams>(() => {
    if (searchText && debouncedSearchText) {
      return {
        query: debouncedSearchText,
        category: PluginCategoryEnum.datasource,
        exclude,
        type: 'plugin',
        sort_by: 'install_count',
        sort_order: 'DESC',
      }
    }
    return {
      query: '',
      category: PluginCategoryEnum.datasource,
      type: 'plugin',
      page_size: 1000,
      exclude,
      sort_by: 'install_count',
      sort_order: 'DESC',
    }
  }, [debouncedSearchText, exclude, searchText])
  const pluginsQuery = useMarketplacePlugins(marketplaceSearchParams, {
    keepPreviousResults: false,
    ...MARKETPLACE_PANEL_CACHE_OPTIONS,
  })
  const plugins = pluginsQuery.data?.pages.flatMap((page) => page.plugins)

  const allPlugins = useMemo(() => {
    const allPlugins = collectionPlugins.filter((plugin) => !exclude.includes(plugin.plugin_id))

    if (plugins?.length) {
      for (let i = 0; i < plugins.length; i++) {
        const plugin = plugins[i]

        if (plugin!.type !== 'bundle' && !allPlugins.find((p) => p.plugin_id === plugin!.plugin_id))
          allPlugins.push(plugin!)
      }
    }

    return allPlugins
  }, [plugins, collectionPlugins, exclude])

  return {
    plugins: allPlugins,
    isLoading: isCollectionLoading || pluginsQuery.isLoading,
  }
}
