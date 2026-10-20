import type { PluginsSearchParams } from '@dify/contracts/marketplace'
import type { ActivePluginType } from './constants'
import { useDebounce } from 'ahooks'
import { useCallback, useMemo } from 'react'
import {
  useActivePluginType,
  useFilterPluginTags,
  useMarketplaceSearchMode,
  useMarketplaceSortValue,
  useSearchPluginText,
} from './atoms'
import { useMarketplaceContainerScroll } from './hooks'
import { useMarketplaceCollectionsAndPlugins, useMarketplacePlugins } from './query'
import { getMarketplacePluginsSearchParams } from './search-params'
import { getCollectionsParams } from './utils'

export function useMarketplaceData(activePluginTypeOverride?: ActivePluginType) {
  const [searchPluginTextOriginal] = useSearchPluginText()
  const searchPluginText = useDebounce(searchPluginTextOriginal, { wait: 500 })
  const [filterPluginTags] = useFilterPluginTags()
  const [activePluginTypeFromUrl] = useActivePluginType()
  const activePluginType = activePluginTypeOverride ?? activePluginTypeFromUrl
  const isSearchMode = useMarketplaceSearchMode(activePluginType, searchPluginText)

  const collectionsQuery = useMarketplaceCollectionsAndPlugins(
    getCollectionsParams(activePluginType),
    !isSearchMode,
  )

  const sort = useMarketplaceSortValue()
  const queryParams = useMemo((): PluginsSearchParams | undefined => {
    if (!isSearchMode) return undefined
    return getMarketplacePluginsSearchParams(
      {
        q: searchPluginText,
        category: activePluginType,
        tags: filterPluginTags,
      },
      sort,
    )
  }, [isSearchMode, searchPluginText, activePluginType, filterPluginTags, sort])

  const pluginsQuery = useMarketplacePlugins(queryParams)
  const { hasNextPage, fetchNextPage, isFetching, isFetchingNextPage } = pluginsQuery

  const handlePageChange = useCallback(() => {
    if (hasNextPage && !isFetching) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetching])

  // Scroll pagination
  useMarketplaceContainerScroll(handlePageChange)

  const pages = pluginsQuery.data?.pages
  // Meilisearch resolves ties in `install_count DESC` by internal document
  // order, and the sync task rewrites those documents every minute, so
  // offset-paginated pages can overlap. Without this, an overlap renders two
  // cards with the same React key and remounts the grid.
  const plugins = useMemo(() => {
    if (!pages) return undefined
    const seen = new Set<string>()
    return pages.flatMap((page) =>
      page.plugins.filter((plugin) => {
        const key = `${plugin.org}/${plugin.name}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }),
    )
  }, [pages])

  return {
    marketplaceCollections: collectionsQuery.data?.marketplaceCollections,
    marketplaceCollectionPluginsMap: collectionsQuery.data?.marketplaceCollectionPluginsMap,
    plugins,
    pluginsTotal: pages?.[0]?.total,
    page: pages?.length || 1,
    isLoading: collectionsQuery.isLoading || pluginsQuery.isLoading,
    // A superseded query keeps the previous results on screen (placeholderData)
    // or has not been issued yet (still debouncing). Both need a quiet pending
    // affordance; unmounting the grid instead collapses layout and jumps scroll.
    isRefreshing:
      pluginsQuery.isPlaceholderData || searchPluginTextOriginal.trim() !== searchPluginText.trim(),
    isError: collectionsQuery.isError || pluginsQuery.isError,
    refetch: isSearchMode ? pluginsQuery.refetch : collectionsQuery.refetch,
    isFetchingNextPage,
  }
}
