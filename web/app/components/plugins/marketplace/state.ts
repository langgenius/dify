import type { PluginsSearchParams, TemplateSearchParams } from './types'
import { useDebounce } from 'ahooks'
import { useCallback, useMemo } from 'react'
import { useActivePluginCategory, useActiveTemplateCategory, useCreationType, useFilterPluginTags, useMarketplaceSearchMode, useMarketplaceSortValue, useSearchText } from './atoms'
import { CATEGORY_ALL } from './constants'
import { useMarketplaceContainerScroll } from './hooks'
import { useMarketplaceCollectionsAndPlugins, useMarketplacePlugins, useMarketplaceTemplateCollectionsAndTemplates, useMarketplaceTemplates } from './query'
import { CREATION_TYPE } from './search-params'
import { getCollectionsParams, getPluginFilterType, mapTemplateDetailToTemplate } from './utils'

const getCategory = (category: string) => {
  if (category === CATEGORY_ALL)
    return undefined
  return category
}

/**
 * Hook for plugins marketplace data
 * Only fetches plugins-related data
 */
export function usePluginsMarketplaceData(enabled = true) {
  const [searchTextOriginal] = useSearchText()
  const searchText = useDebounce(searchTextOriginal, { wait: 500 })
  const [filterPluginTags] = useFilterPluginTags()
  const [activePluginCategory] = useActivePluginCategory()

  const pluginsCollectionsQuery = useMarketplaceCollectionsAndPlugins(
    getCollectionsParams(activePluginCategory),
    { enabled },
  )

  const sort = useMarketplaceSortValue()
  const isSearchMode = useMarketplaceSearchMode()
  const queryParams = useMemo((): PluginsSearchParams | undefined => {
    if (!isSearchMode)
      return undefined
    return {
      query: searchText,
      category: getCategory(activePluginCategory),
      tags: filterPluginTags,
      sort_by: sort.sortBy,
      sort_order: sort.sortOrder,
      type: getPluginFilterType(activePluginCategory),
    }
  }, [isSearchMode, searchText, activePluginCategory, filterPluginTags, sort])

  const pluginsQuery = useMarketplacePlugins(queryParams, { enabled })
  const { hasNextPage, fetchNextPage, isFetching, isFetchingNextPage } = pluginsQuery

  const handlePageChange = useCallback(() => {
    if (hasNextPage && !isFetching)
      fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetching])

  // Scroll pagination
  useMarketplaceContainerScroll(handlePageChange)

  return {
    pluginCollections: pluginsCollectionsQuery.data?.marketplaceCollections,
    pluginCollectionPluginsMap: pluginsCollectionsQuery.data?.marketplaceCollectionPluginsMap,
    plugins: pluginsQuery.data?.pages.flatMap(page => page.plugins),
    pluginsTotal: pluginsQuery.data?.pages[0]?.total,
    page: pluginsQuery.data?.pages.length || 1,
    isLoading: pluginsCollectionsQuery.isLoading || pluginsQuery.isLoading,
    isFetchingNextPage,
  }
}

/**
 * Hook for templates marketplace data
 * Only fetches templates-related data
 */
export function useTemplatesMarketplaceData(enabled = true) {
  // Reuse existing atoms for search and sort
  const [searchTextOriginal] = useSearchText()
  const searchText = useDebounce(searchTextOriginal, { wait: 500 })
  const [activeTemplateCategory] = useActiveTemplateCategory()

  // Template collections query (for non-search mode)
  const templateCollectionsQuery = useMarketplaceTemplateCollectionsAndTemplates(undefined, { enabled })

  // Sort value
  const sort = useMarketplaceSortValue()

  // Search mode: when there's search text or non-default category
  const isSearchMode = useMarketplaceSearchMode()

  // Build query params for search mode
  const queryParams = useMemo((): TemplateSearchParams | undefined => {
    if (!isSearchMode)
      return undefined
    return {
      query: searchText,
      categories: activeTemplateCategory === CATEGORY_ALL ? undefined : [activeTemplateCategory],
      sort_by: sort.sortBy,
      sort_order: sort.sortOrder,
    }
  }, [isSearchMode, searchText, activeTemplateCategory, sort])

  // Templates search query (for search mode)
  const templatesQuery = useMarketplaceTemplates(queryParams, { enabled })
  const { hasNextPage, fetchNextPage, isFetching, isFetchingNextPage } = templatesQuery

  // Pagination handler
  const handlePageChange = useCallback(() => {
    if (hasNextPage && !isFetching)
      fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetching])

  // Scroll pagination
  useMarketplaceContainerScroll(handlePageChange)

  return {
    templateCollections: templateCollectionsQuery.data?.templateCollections,
    templateCollectionTemplatesMap: templateCollectionsQuery.data?.templateCollectionTemplatesMap,
    templates: templatesQuery.data?.pages.flatMap(page => page.templates).map(mapTemplateDetailToTemplate),
    templatesTotal: templatesQuery.data?.pages[0]?.total,
    page: templatesQuery.data?.pages.length || 1,
    isLoading: templateCollectionsQuery.isLoading || templatesQuery.isLoading,
    isFetchingNextPage,
  }
}

export type PluginsMarketplaceData = ReturnType<typeof usePluginsMarketplaceData>
export type TemplatesMarketplaceData = ReturnType<typeof useTemplatesMarketplaceData>
export type MarketplaceData = PluginsMarketplaceData | TemplatesMarketplaceData

export function isPluginsData(data: MarketplaceData): data is PluginsMarketplaceData {
  return 'pluginCollections' in data
}

/**
 * Main hook that routes to appropriate data based on creationType
 * Returns either plugins or templates data based on URL parameter
 */
export function useMarketplaceData(): MarketplaceData {
  const [creationType] = useCreationType()

  const pluginsData = usePluginsMarketplaceData(creationType === CREATION_TYPE.plugins)
  const templatesData = useTemplatesMarketplaceData(creationType === CREATION_TYPE.templates)
  return creationType === CREATION_TYPE.templates ? templatesData : pluginsData
}
