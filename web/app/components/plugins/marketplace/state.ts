import type { CollectionsAndPluginsSearchParams, PluginsSearchParams, SearchParamsFromCollection } from './types'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { useMarketplaceSearchMode, useMarketplaceSortValue, useSetMarketplaceSort, useSetSearchMode } from './atoms'
import { DEFAULT_SORT, PLUGIN_TYPE_SEARCH_MAP } from './constants'
import { useMarketplaceContainerScroll } from './hooks'
import { marketplaceKeys } from './query-keys'
import { marketplaceSearchParamsParsers } from './search-params'
import { getCollectionsParams, getMarketplaceCollectionsAndPlugins, getMarketplaceListFilterType, getMarketplacePlugins } from './utils'

function useMarketplaceCollectionsAndPluginsReactive(queryParams?: CollectionsAndPluginsSearchParams) {
  return useQuery({
    queryKey: marketplaceKeys.collections(queryParams),
    queryFn: ({ signal }) => getMarketplaceCollectionsAndPlugins(queryParams, { signal }),
    enabled: queryParams !== undefined,
  })
}

function useMarketplaceCollectionsData() {
  const [activePluginType] = useActivePluginType()

  const collectionsParams = useMemo(() => getCollectionsParams(activePluginType), [activePluginType])

  const { data, isLoading } = useMarketplaceCollectionsAndPluginsReactive(collectionsParams)

  return {
    marketplaceCollections: data?.marketplaceCollections,
    marketplaceCollectionPluginsMap: data?.marketplaceCollectionPluginsMap,
    isLoading,
  }
}

function useMarketplacePluginsReactive(queryParams?: PluginsSearchParams) {
  const marketplacePluginsQuery = useInfiniteQuery({
    queryKey: marketplaceKeys.plugins(queryParams),
    queryFn: ({ pageParam = 1, signal }) => getMarketplacePlugins(queryParams, pageParam, signal),
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1
      const loaded = lastPage.page * lastPage.pageSize
      return loaded < (lastPage.total || 0) ? nextPage : undefined
    },
    initialPageParam: 1,
    enabled: !!queryParams,
  })

  const hasQuery = !!queryParams
  const hasData = marketplacePluginsQuery.data !== undefined
  const plugins = hasQuery && hasData
    ? marketplacePluginsQuery.data.pages.flatMap(page => page.plugins)
    : undefined
  const total = hasQuery && hasData ? marketplacePluginsQuery.data.pages?.[0]?.total : undefined
  const isPluginsLoading = hasQuery && (
    marketplacePluginsQuery.isPending
    || (marketplacePluginsQuery.isFetching && !marketplacePluginsQuery.data)
  )

  return {
    plugins,
    total,
    isLoading: isPluginsLoading,
    isFetchingNextPage: marketplacePluginsQuery.isFetchingNextPage,
    hasNextPage: marketplacePluginsQuery.hasNextPage,
    fetchNextPage: marketplacePluginsQuery.fetchNextPage,
    page: marketplacePluginsQuery.data?.pages?.length || (marketplacePluginsQuery.isPending && hasQuery ? 1 : 0),
  }
}

function useMarketplacePluginsData() {
  const sort = useMarketplaceSortValue()

  const [searchPluginText] = useSearchPluginText()
  const [filterPluginTags] = useFilterPluginTags()
  const [activePluginType] = useActivePluginType()

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

  const {
    plugins,
    total: pluginsTotal,
    isLoading: isPluginsLoading,
    fetchNextPage,
    hasNextPage,
    page: pluginsPage,
  } = useMarketplacePluginsReactive(queryParams)

  const handlePageChange = useCallback(() => {
    if (hasNextPage)
      fetchNextPage()
  }, [fetchNextPage, hasNextPage])

  // Scroll pagination
  useMarketplaceContainerScroll(handlePageChange)

  return {
    plugins,
    pluginsTotal,
    page: Math.max(pluginsPage, 1),
    isLoading: isPluginsLoading,
  }
}

export function useMarketplaceData() {
  const collectionsData = useMarketplaceCollectionsData()
  const pluginsData = useMarketplacePluginsData()

  return {
    marketplaceCollections: collectionsData.marketplaceCollections,
    marketplaceCollectionPluginsMap: collectionsData.marketplaceCollectionPluginsMap,

    plugins: pluginsData.plugins,
    pluginsTotal: pluginsData.pluginsTotal,
    page: pluginsData.page,

    isLoading: collectionsData.isLoading || pluginsData.isLoading,
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

export function useSearchPluginText() {
  return useQueryState('q', marketplaceSearchParamsParsers.q)
}
export function useActivePluginType() {
  return useQueryState('category', marketplaceSearchParamsParsers.category)
}
export function useFilterPluginTags() {
  return useQueryState('tags', marketplaceSearchParamsParsers.tags)
}
