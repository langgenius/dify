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
import { getMarketplaceListCondition } from '@/app/components/plugins/marketplace/utils'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useAllToolProviders } from '@/service/use-tools'

export function useMarketplace(searchPluginText: string, filterPluginTags: string[]) {
  const { data: toolProvidersData, isSuccess } = useAllToolProviders()
  const exclude = useMemo(() => {
    if (isSuccess)
      return toolProvidersData?.filter(toolProvider => !!toolProvider.plugin_id).map(toolProvider => toolProvider.plugin_id!)
    return undefined
  }, [isSuccess, toolProvidersData])

  const isSearchMode = !!searchPluginText || filterPluginTags.length > 0

  // Collections query (only when not searching)
  const collectionsQuery = useMarketplaceCollectionsAndPlugins(
    {
      category: PluginCategoryEnum.tool,
      condition: getMarketplaceListCondition(PluginCategoryEnum.tool),
      exclude,
      type: 'plugin',
    },
    { enabled: !isSearchMode && isSuccess },
  )

  // Plugins search
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

  const searchPluginTextRef = useRef(searchPluginText)
  const filterPluginTagsRef = useRef(filterPluginTags)

  useEffect(() => {
    searchPluginTextRef.current = searchPluginText
    filterPluginTagsRef.current = filterPluginTags
  }, [searchPluginText, filterPluginTags])

  useEffect(() => {
    if (!isSuccess)
      return

    if (isSearchMode) {
      if (searchPluginText) {
        queryPluginsWithDebounced({
          category: PluginCategoryEnum.tool,
          query: searchPluginText,
          tags: filterPluginTags,
          exclude,
          type: 'plugin',
        })
      }
      else {
        queryPlugins({
          category: PluginCategoryEnum.tool,
          query: searchPluginText,
          tags: filterPluginTags,
          exclude,
          type: 'plugin',
        })
      }
    }
    else {
      resetPlugins()
    }
  }, [searchPluginText, filterPluginTags, queryPlugins, queryPluginsWithDebounced, resetPlugins, exclude, isSuccess, isSearchMode])

  const handleScroll = useCallback((e: Event) => {
    const target = e.target as HTMLDivElement
    const { scrollTop, scrollHeight, clientHeight } = target
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD && scrollTop > 0) {
      const searchText = searchPluginTextRef.current
      const tags = filterPluginTagsRef.current
      if (hasNextPage && (!!searchText || !!tags.length))
        fetchNextPage()
    }
  }, [fetchNextPage, hasNextPage])

  return {
    isLoading: collectionsQuery.isLoading || isPluginsLoading,
    marketplaceCollections: collectionsQuery.data?.marketplaceCollections,
    marketplaceCollectionPluginsMap: collectionsQuery.data?.marketplaceCollectionPluginsMap,
    plugins,
    handleScroll,
    page: Math.max(pluginsPage || 0, 1),
  }
}
