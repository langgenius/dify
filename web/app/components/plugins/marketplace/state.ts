import type { PluginsSearchParams } from './types'
import { useDebounce } from 'ahooks'
import { useCallback, useMemo } from 'react'
import { useActivePluginType, useFilterPluginTags, useMarketplaceSearchMode, useMarketplaceSortValue, useSearchPluginText } from './atoms'
import { PLUGIN_TYPE_SEARCH_MAP } from './constants'
import { useMarketplaceContainerScroll } from './hooks'
import { useMarketplaceCollectionsAndPlugins, useMarketplacePlugins } from './query'
import { getCollectionsParams, getMarketplaceListFilterType } from './utils'

export function useMarketplaceData() {
  const [searchPluginText] = useSearchPluginText()
  const [filterPluginTags] = useFilterPluginTags()
  const [activePluginType] = useActivePluginType()

  const collectionsQuery = useMarketplaceCollectionsAndPlugins(
    getCollectionsParams(activePluginType),
  )

  const sort = useMarketplaceSortValue()
  const isSearchMode = useMarketplaceSearchMode()
  const queryParams = useMemo((): PluginsSearchParams | undefined => {
    if (!isSearchMode)
      return undefined
    return {
      query: searchPluginText,
      category: activePluginType === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginType,
      tags: filterPluginTags,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      type: getMarketplaceListFilterType(activePluginType),
    }
  }, [isSearchMode, searchPluginText, activePluginType, filterPluginTags, sort])

  const deferredQueryParams = useDebounce(queryParams, { wait: 500 })
  const pluginsQuery = useMarketplacePlugins(deferredQueryParams)
  const { hasNextPage, fetchNextPage } = pluginsQuery

  const handlePageChange = useCallback(() => {
    if (hasNextPage)
      fetchNextPage()
  }, [fetchNextPage, hasNextPage])

  // Scroll pagination
  useMarketplaceContainerScroll(handlePageChange)

  return {
    marketplaceCollections: collectionsQuery.data?.marketplaceCollections,
    marketplaceCollectionPluginsMap: collectionsQuery.data?.marketplaceCollectionPluginsMap,
    plugins: pluginsQuery.data?.pages.flatMap(page => page.plugins),
    pluginsTotal: pluginsQuery.data?.pages[0]?.total,
    page: pluginsQuery.data?.pages.length || 1,
    isLoading: collectionsQuery.isLoading || pluginsQuery.isLoading,
  }
}
