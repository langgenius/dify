'use client'

import type { Plugin } from '../types'
import type {
  CollectionsAndPluginsSearchParams,
  MarketplaceCollection,
  PluginsSearchParams,
} from './types'
import type { PluginsFromMarketplaceResponse } from '@/app/components/plugins/types'
import {
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useMarketplaceFilters } from '@/hooks/use-query-params'
import { postMarketplace } from '@/service/base'
import { useMarketplaceSort, useMarketplaceSortValue } from './atoms'
import { DEFAULT_SORT, SCROLL_BOTTOM_THRESHOLD } from './constants'
import { PLUGIN_TYPE_SEARCH_MAP } from './plugin-type-switch'
import { marketplaceKeys } from './query-keys'
import {
  getFormattedPlugin,
  getMarketplaceCollectionsAndPlugins,
  getMarketplaceListCondition,
  getMarketplaceListFilterType,
  getMarketplacePluginsByCollectionId,
} from './utils'

export { marketplaceKeys }

// Stable empty object for query key matching with server prefetch
const EMPTY_PARAMS = {}

/**
 * Fetches marketplace collections and their plugins
 */
export function useMarketplaceCollectionsAndPlugins(
  params?: CollectionsAndPluginsSearchParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: marketplaceKeys.collections(params),
    queryFn: ({ signal }) => getMarketplaceCollectionsAndPlugins(params, { signal }),
    enabled: options?.enabled ?? true,
  })
}

/**
 * Reactive hook that automatically fetches collections based on current state
 */
export function useMarketplaceCollectionsData() {
  const [urlFilters] = useMarketplaceFilters()

  const activePluginType = urlFilters.category
  const searchPluginText = urlFilters.q
  const filterPluginTags = urlFilters.tags

  const isSearchMode = !!searchPluginText || filterPluginTags.length > 0

  const collectionsParams = useMemo(() => {
    if (activePluginType === PLUGIN_TYPE_SEARCH_MAP.all) {
      return EMPTY_PARAMS
    }
    return {
      category: activePluginType === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginType,
      condition: getMarketplaceListCondition(activePluginType),
      type: getMarketplaceListFilterType(activePluginType),
    }
  }, [activePluginType])

  const collectionsQuery = useMarketplaceCollectionsAndPlugins(
    collectionsParams,
    { enabled: !isSearchMode },
  )

  return {
    marketplaceCollections: collectionsQuery.data?.marketplaceCollections,
    marketplaceCollectionPluginsMap: collectionsQuery.data?.marketplaceCollectionPluginsMap,
    isLoading: collectionsQuery.isLoading,
    isSearchMode,
  }
}

/**
 * Fetches plugins for a specific collection
 */
export function useMarketplacePluginsByCollectionId(
  collectionId?: string,
  params?: CollectionsAndPluginsSearchParams,
) {
  const query = useQuery({
    queryKey: marketplaceKeys.collectionPlugins(collectionId || '', params),
    queryFn: ({ signal }) => {
      if (!collectionId)
        return Promise.resolve<Plugin[]>([])
      return getMarketplacePluginsByCollectionId(collectionId, params, { signal })
    },
    enabled: !!collectionId,
  })

  return {
    plugins: query.data || [],
    isLoading: query.isLoading,
    isSuccess: query.isSuccess,
  }
}

const DEFAULT_PAGE_SIZE = 40

async function fetchMarketplacePlugins(
  queryParams: PluginsSearchParams | undefined,
  pageParam: number,
  signal?: AbortSignal,
) {
  if (!queryParams) {
    return {
      plugins: [] as Plugin[],
      total: 0,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    }
  }

  const {
    query,
    sortBy,
    sortOrder,
    category,
    tags,
    type,
    pageSize = DEFAULT_PAGE_SIZE,
  } = queryParams
  const pluginOrBundle = type === 'bundle' ? 'bundles' : 'plugins'

  try {
    const res = await postMarketplace<{ data: PluginsFromMarketplaceResponse }>(
      `/${pluginOrBundle}/search/advanced`,
      {
        body: {
          page: pageParam,
          page_size: pageSize,
          query,
          sort_by: sortBy,
          sort_order: sortOrder,
          category: category !== 'all' ? category : '',
          tags,
          type,
        },
        signal,
      },
    )
    const resPlugins = res.data.bundles || res.data.plugins || []

    return {
      plugins: resPlugins.map(plugin => getFormattedPlugin(plugin)),
      total: res.data.total,
      page: pageParam,
      pageSize,
    }
  }
  catch {
    return {
      plugins: [],
      total: 0,
      page: pageParam,
      pageSize,
    }
  }
}

/**
 * Fetches plugins with infinite scroll support - imperative version
 * Used by external components (workflow block selectors, etc.)
 */
export function useMarketplacePlugins(initialParams?: PluginsSearchParams) {
  const [queryParams, setQueryParams] = useState<PluginsSearchParams | undefined>(initialParams)

  const query = useInfiniteQuery({
    queryKey: marketplaceKeys.plugins(queryParams),
    queryFn: ({ pageParam = 1, signal }) => fetchMarketplacePlugins(queryParams, pageParam, signal),
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1
      const loaded = lastPage.page * lastPage.pageSize
      return loaded < (lastPage.total || 0) ? nextPage : undefined
    },
    initialPageParam: 1,
    enabled: !!queryParams,
  })

  const { run: queryPluginsDebounced, cancel: cancelDebounced } = useDebounceFn(
    (params: PluginsSearchParams) => setQueryParams(params),
    { wait: 500 },
  )

  const plugins = useMemo(() => {
    if (!queryParams || !query.data)
      return undefined
    return query.data.pages.flatMap(page => page.plugins)
  }, [queryParams, query.data])

  const total = queryParams && query.data ? query.data.pages[0]?.total : undefined

  return {
    plugins,
    total,
    queryPlugins: setQueryParams,
    queryPluginsDebounced,
    queryPluginsWithDebounced: queryPluginsDebounced,
    cancelDebounced,
    cancelQueryPluginsWithDebounced: cancelDebounced,
    resetPlugins: useCallback(() => setQueryParams(undefined), []),
    isLoading: !!queryParams && query.isPending,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    page: query.data?.pages?.length || 0,
  }
}

/**
 * Fetches plugins with infinite scroll support - reactive version
 * Automatically refetches when queryParams changes
 */
export function useMarketplacePluginsReactive(queryParams?: PluginsSearchParams) {
  const query = useInfiniteQuery({
    queryKey: marketplaceKeys.plugins(queryParams),
    queryFn: ({ pageParam = 1, signal }) => fetchMarketplacePlugins(queryParams, pageParam, signal),
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1
      const loaded = lastPage.page * lastPage.pageSize
      return loaded < (lastPage.total || 0) ? nextPage : undefined
    },
    initialPageParam: 1,
    enabled: !!queryParams,
  })

  const plugins = useMemo(() => {
    if (!queryParams || !query.data)
      return undefined
    return query.data.pages.flatMap(page => page.plugins)
  }, [queryParams, query.data])

  const total = queryParams && query.data ? query.data.pages[0]?.total : undefined

  return {
    plugins,
    total,
    isLoading: !!queryParams && query.isPending,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    page: query.data?.pages?.length || 0,
  }
}

/**
 * Reactive hook that automatically fetches plugins based on current state
 */
export function useMarketplacePluginsData() {
  const [urlFilters] = useMarketplaceFilters()
  const sort = useMarketplaceSortValue()

  const searchPluginText = urlFilters.q
  const filterPluginTags = urlFilters.tags
  const activePluginType = urlFilters.category

  const isSearchMode = !!searchPluginText
    || filterPluginTags.length > 0
    || (activePluginType !== PLUGIN_TYPE_SEARCH_MAP.all && activePluginType !== PLUGIN_TYPE_SEARCH_MAP.tool)

  // Compute query params reactively - TanStack Query will auto-refetch when this changes
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

/**
 * Hook for handling "More" click in collection headers
 */
export function useMarketplaceMoreClick() {
  const [, setUrlFilters] = useMarketplaceFilters()
  const [, setSort] = useMarketplaceSort()

  return useCallback((searchParams?: { query?: string, sort_by?: string, sort_order?: string }) => {
    if (!searchParams)
      return
    const newQuery = searchParams?.query || ''
    const newSort = {
      sortBy: searchParams?.sort_by || DEFAULT_SORT.sortBy,
      sortOrder: searchParams?.sort_order || DEFAULT_SORT.sortOrder,
    }
    setUrlFilters({ q: newQuery })
    setSort(newSort)
  }, [setUrlFilters, setSort])
}

/**
 * Combined hook for marketplace data
 */
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

/**
 * Handles scroll-based pagination
 */
export function useMarketplaceContainerScroll(
  callback: () => void,
  scrollContainerId = 'marketplace-container',
) {
  const handleScroll = useCallback((e: Event) => {
    const target = e.target as HTMLDivElement
    const { scrollTop, scrollHeight, clientHeight } = target
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD && scrollTop > 0)
      callback()
  }, [callback])

  useEffect(() => {
    const container = document.getElementById(scrollContainerId)
    if (container)
      container.addEventListener('scroll', handleScroll)

    return () => {
      if (container)
        container.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll, scrollContainerId])
}

// Re-export for external usage (workflow block selector, etc.)
export type { MarketplaceCollection, PluginsSearchParams }
