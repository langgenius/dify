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
  const isSearchMode = useMarketplaceSearchMode(activePluginType)

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
    if (hasNextPage && !isFetching) fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetching])

  // Scroll pagination
  useMarketplaceContainerScroll(handlePageChange)

  return {
    marketplaceCollections: collectionsQuery.data?.marketplaceCollections,
    marketplaceCollectionPluginsMap: collectionsQuery.data?.marketplaceCollectionPluginsMap,
    plugins: pluginsQuery.data?.pages.flatMap((page) => page.plugins),
    pluginsTotal: pluginsQuery.data?.pages[0]?.total,
    page: pluginsQuery.data?.pages.length || 1,
    isLoading: collectionsQuery.isLoading || pluginsQuery.isLoading,
    isFetchingNextPage,
  }
}
