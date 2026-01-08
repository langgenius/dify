import type { PluginsSearchParams, SearchParamsFromCollection } from './types'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { useMarketplaceSearchMode, useMarketplaceSortValue, useSetMarketplaceSort, useSetSearchMode } from './atoms'
import { DEFAULT_SORT, PLUGIN_TYPE_SEARCH_MAP } from './constants'
import { useMarketplaceContainerScroll } from './hooks'
import { useMarketplaceCollectionsAndPlugins, useMarketplacePlugins } from './query'
import { marketplaceSearchParamsParsers } from './search-params'
import { getCollectionsParams, getMarketplaceListFilterType } from './utils'

export function useSearchPluginText() {
  return useQueryState('q', marketplaceSearchParamsParsers.q)
}
export function useActivePluginType() {
  return useQueryState('category', marketplaceSearchParamsParsers.category)
}
export function useFilterPluginTags() {
  return useQueryState('tags', marketplaceSearchParamsParsers.tags)
}

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

  const pluginsQuery = useMarketplacePlugins(queryParams)
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

export function useMarketplaceMoreClick() {
  const [,setQ] = useSearchPluginText()
  const setSort = useSetMarketplaceSort()
  const setSearchMode = useSetSearchMode()

  return useCallback((searchParams?: SearchParamsFromCollection) => {
    if (!searchParams)
      return
    setQ(searchParams?.query || '')
    setSort({
      sortBy: searchParams?.sort_by || DEFAULT_SORT.sortBy,
      sortOrder: searchParams?.sort_order || DEFAULT_SORT.sortOrder,
    })
    setSearchMode(true)
  }, [setQ, setSort, setSearchMode])
}
