import type { PluginsSearchParams } from './types'
import { useDebounce } from 'ahooks'
import { useCallback, useMemo } from 'react'
import { useActivePluginType, useFilterPluginTags, useMarketplaceSearchMode, useMarketplaceSortValue, useSearchPluginText } from './atoms'
import { PLUGIN_CATEGORY_WITH_COLLECTIONS, PLUGIN_TYPE_SEARCH_MAP } from './constants'
import { useMarketplaceContainerScroll } from './hooks'
import { useMarketplaceCollectionsAndPlugins, useMarketplacePlugins } from './query'
import { getCollectionsParams, getMarketplaceListFilterType } from './utils'

export function useMarketplaceData() {
  const [searchPluginTextOriginal] = useSearchPluginText()
  const searchPluginText = useDebounce(searchPluginTextOriginal, { wait: 500 })
  const [filterPluginTags] = useFilterPluginTags()
  const [activePluginType] = useActivePluginType()
  const isSearchMode = useMarketplaceSearchMode()

  const collectionsQuery = useMarketplaceCollectionsAndPlugins(
    getCollectionsParams(activePluginType),
    {
      enabled: !isSearchMode && PLUGIN_CATEGORY_WITH_COLLECTIONS.has(activePluginType),
    },
  )

  const sort = useMarketplaceSortValue()
  const queryParams = useMemo((): PluginsSearchParams | undefined => {
    if (!isSearchMode)
      return undefined
    return {
      query: searchPluginText,
      category: activePluginType === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginType,
      tags: filterPluginTags,
      sort_by: sort.sortBy,
      sort_order: sort.sortOrder,
      type: getMarketplaceListFilterType(activePluginType),
    }
  }, [isSearchMode, searchPluginText, activePluginType, filterPluginTags, sort])

  const pluginsQuery = useMarketplacePlugins(queryParams)
  const { hasNextPage, fetchNextPage, isFetching, isFetchingNextPage } = pluginsQuery

  const handlePageChange = useCallback(() => {
    if (hasNextPage && !isFetching)
      fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetching])

  // Scroll pagination
  useMarketplaceContainerScroll(handlePageChange)

  return {
    marketplaceCollections: collectionsQuery.data?.marketplaceCollections,
    marketplaceCollectionPluginsMap: collectionsQuery.data?.marketplaceCollectionPluginsMap,
    plugins: pluginsQuery.data?.pages.flatMap(page => page.plugins),
    pluginsTotal: pluginsQuery.data?.pages[0]?.total,
    page: pluginsQuery.data?.pages.length || 1,
    isLoading: (isSearchMode ? false : collectionsQuery.isLoading) || pluginsQuery.isLoading,
    isFetchingNextPage,
  }
}
