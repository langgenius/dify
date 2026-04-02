import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { SCROLL_BOTTOM_THRESHOLD } from '@/app/components/plugins/marketplace/constants'
import {
  useMarketplaceCollectionsAndPlugins,
  useMarketplacePlugins,
} from '@/app/components/plugins/marketplace/hooks'
import { getPluginCondition } from '@/app/components/plugins/marketplace/utils'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useAllToolProviders } from '@/service/use-tools'

export const useMarketplace = (searchText: string, filterPluginTags: string[]) => {
  const { data: toolProvidersData, isSuccess } = useAllToolProviders()
  const exclude = useMemo(() => {
    if (isSuccess)
      return toolProvidersData?.filter(toolProvider => !!toolProvider.plugin_id).map(toolProvider => toolProvider.plugin_id!)
  }, [isSuccess, toolProvidersData])
  const {
    isLoading,
    pluginCollections,
    pluginCollectionPluginsMap,
    queryMarketplaceCollectionsAndPlugins,
  } = useMarketplaceCollectionsAndPlugins()
  const {
    plugins,
    resetPlugins,
    queryPlugins,
    queryPluginsWithDebounced,
    isLoading: isPluginsLoading,
    fetchNextPage,
    hasNextPage,
    page: pluginsPage,
  } = useMarketplacePlugins()
  const searchTextRef = useRef(searchText)
  const filterPluginTagsRef = useRef(filterPluginTags)

  useEffect(() => {
    searchTextRef.current = searchText
    filterPluginTagsRef.current = filterPluginTags
  }, [searchText, filterPluginTags])
  useEffect(() => {
    if ((searchText || filterPluginTags.length) && isSuccess) {
      if (searchText) {
        queryPluginsWithDebounced({
          category: PluginCategoryEnum.tool,
          query: searchText,
          tags: filterPluginTags,
          exclude,
          type: 'plugin',
        })
        return
      }
      queryPlugins({
        category: PluginCategoryEnum.tool,
        query: searchText,
        tags: filterPluginTags,
        exclude,
        type: 'plugin',
      })
    }
    else {
      if (isSuccess) {
        queryMarketplaceCollectionsAndPlugins({
          category: PluginCategoryEnum.tool,
          condition: getPluginCondition(PluginCategoryEnum.tool),
          exclude,
          type: 'plugin',
        })
        resetPlugins()
      }
    }
  }, [searchText, filterPluginTags, queryPlugins, queryMarketplaceCollectionsAndPlugins, queryPluginsWithDebounced, resetPlugins, exclude, isSuccess])

  const handleScroll = useCallback((e: Event) => {
    const target = e.target as HTMLDivElement
    const {
      scrollTop,
      scrollHeight,
      clientHeight,
    } = target
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD && scrollTop > 0) {
      const searchText = searchTextRef.current
      const filterPluginTags = filterPluginTagsRef.current
      if (hasNextPage && (!!searchText || !!filterPluginTags.length))
        fetchNextPage()
    }
  }, [exclude, fetchNextPage, hasNextPage, plugins, queryPlugins])

  return {
    isLoading: isLoading || isPluginsLoading,
    pluginCollections,
    pluginCollectionPluginsMap,
    plugins,
    handleScroll,
    page: Math.max(pluginsPage || 0, 1),
  }
}
