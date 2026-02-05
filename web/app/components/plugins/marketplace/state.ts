import type { PluginsSearchParams, TemplateSearchParams } from './types'
import { useDebounce } from 'ahooks'
import { useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { useActivePluginType, useFilterPluginTags, useMarketplaceSearchMode, useMarketplaceSortValue, useSearchPluginText } from './atoms'
import { PLUGIN_TYPE_SEARCH_MAP } from './constants'
import { useMarketplaceContainerScroll } from './hooks'
import { useMarketplaceCollectionsAndPlugins, useMarketplacePlugins, useMarketplaceTemplateCollectionsAndTemplates, useMarketplaceTemplates } from './query'
import { getCollectionsParams, getMarketplaceListFilterType } from './utils'

/**
 * Hook for plugins marketplace data
 * Only fetches plugins-related data
 */
export function usePluginsMarketplaceData() {
  const [searchPluginTextOriginal] = useSearchPluginText()
  const searchPluginText = useDebounce(searchPluginTextOriginal, { wait: 500 })
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
    isLoading: collectionsQuery.isLoading || pluginsQuery.isLoading,
    isFetchingNextPage,
  }
}

/**
 * Hook for templates marketplace data
 * Only fetches templates-related data
 */
export function useTemplatesMarketplaceData() {
  // Reuse existing atoms for search and sort
  const [searchTextOriginal] = useSearchPluginText()
  const searchText = useDebounce(searchTextOriginal, { wait: 500 })
  const [activeCategory] = useActivePluginType()

  // Template collections query (for non-search mode)
  const templateCollectionsQuery = useMarketplaceTemplateCollectionsAndTemplates()

  // Sort value
  const sort = useMarketplaceSortValue()

  // Search mode: when there's search text or non-default category
  const isSearchMode = !!searchText || (activeCategory !== PLUGIN_TYPE_SEARCH_MAP.all)

  // Build query params for search mode
  const queryParams = useMemo((): TemplateSearchParams | undefined => {
    if (!isSearchMode)
      return undefined
    return {
      query: searchText,
      categories: activeCategory === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : [activeCategory],
      sort_by: sort.sortBy,
      sort_order: sort.sortOrder,
    }
  }, [isSearchMode, searchText, activeCategory, sort])

  // Templates search query (for search mode)
  const templatesQuery = useMarketplaceTemplates(queryParams)
  const { hasNextPage, fetchNextPage, isFetching, isFetchingNextPage } = templatesQuery

  // Pagination handler
  const handlePageChange = useCallback(() => {
    if (hasNextPage && !isFetching)
      fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetching])

  // Scroll pagination
  useMarketplaceContainerScroll(handlePageChange)

  // Compute flat templates list from collection map (for non-search mode)
  const { collectionTemplates, collectionTemplatesTotal } = useMemo(() => {
    const templateCollectionTemplatesMap = templateCollectionsQuery.data?.templateCollectionTemplatesMap
    if (!templateCollectionTemplatesMap) {
      return { collectionTemplates: undefined, collectionTemplatesTotal: 0 }
    }

    const allTemplates = Object.values(templateCollectionTemplatesMap).flat()
    // Deduplicate templates by template_id
    const uniqueTemplates = allTemplates.filter(
      (template, index, self) => index === self.findIndex(t => t.template_id === template.template_id),
    )

    return {
      collectionTemplates: uniqueTemplates,
      collectionTemplatesTotal: uniqueTemplates.length,
    }
  }, [templateCollectionsQuery.data?.templateCollectionTemplatesMap])

  // Return search results when in search mode, otherwise return collection data
  if (isSearchMode) {
    return {
      isSearchMode,
      templateCollections: undefined,
      templateCollectionTemplatesMap: undefined,
      templates: templatesQuery.data?.pages.flatMap(page => page.templates),
      templatesTotal: templatesQuery.data?.pages[0]?.total,
      page: templatesQuery.data?.pages.length || 1,
      isLoading: templatesQuery.isLoading,
      isFetchingNextPage,
    }
  }

  return {
    isSearchMode,
    templateCollections: templateCollectionsQuery.data?.templateCollections,
    templateCollectionTemplatesMap: templateCollectionsQuery.data?.templateCollectionTemplatesMap,
    templates: collectionTemplates,
    templatesTotal: collectionTemplatesTotal,
    page: 1,
    isLoading: templateCollectionsQuery.isLoading,
    isFetchingNextPage: false,
  }
}

/**
 * Main hook that routes to appropriate data based on creationType
 * Returns either plugins or templates data based on URL parameter
 */
export function useMarketplaceData() {
  const searchParams = useSearchParams()
  const creationType = (searchParams.get('creationType') || 'plugins') as 'plugins' | 'templates'

  const pluginsData = usePluginsMarketplaceData()
  const templatesData = useTemplatesMarketplaceData()

  if (creationType === 'templates') {
    return {
      creationType,
      isSearchMode: templatesData.isSearchMode,
      // Templates-specific fields
      templateCollections: templatesData.templateCollections,
      templateCollectionTemplatesMap: templatesData.templateCollectionTemplatesMap,
      templates: templatesData.templates,
      templatesTotal: templatesData.templatesTotal,
      page: templatesData.page,
      isLoading: templatesData.isLoading,
      isFetchingNextPage: templatesData.isFetchingNextPage,
    }
  }

  // Default: plugins
  return {
    creationType,
    isSearchMode: false, // plugins uses useMarketplaceSearchMode separately
    // Plugins-specific fields
    marketplaceCollections: pluginsData.marketplaceCollections,
    marketplaceCollectionPluginsMap: pluginsData.marketplaceCollectionPluginsMap,
    plugins: pluginsData.plugins,
    pluginsTotal: pluginsData.pluginsTotal,
    page: pluginsData.page,
    isLoading: pluginsData.isLoading,
    isFetchingNextPage: pluginsData.isFetchingNextPage,
  }
}
