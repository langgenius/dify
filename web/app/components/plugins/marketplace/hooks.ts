'use client'

import type {
  Plugin,
} from '../types'
import type {
  CollectionsAndPluginsSearchParams,
  MarketplaceCollection,
  PluginsSearchParams,
} from './types'
import type { PluginsFromMarketplaceResponse } from '@/app/components/plugins/types'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useMarketplaceCategory, useMarketplaceSearchQuery, useMarketplaceTags } from '@/hooks/use-query-params'
import { postMarketplace } from '@/service/base'
import { setSearchMode, useMarketplaceSearchMode, useMarketplaceSortValue, useSetMarketplaceSort } from './atoms'
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

const EMPTY_PARAMS = {}

export const useMarketplaceCollectionsAndPlugins = (queryParams?: CollectionsAndPluginsSearchParams) => {
  return useQuery({
    queryKey: marketplaceKeys.collections(queryParams),
    queryFn: ({ signal }) => getMarketplaceCollectionsAndPlugins(queryParams, { signal }),
    enabled: queryParams !== undefined,
  })
}

export function useMarketplaceCollectionsData() {
  const [activePluginType] = useMarketplaceCategory()

  const collectionsParams: CollectionsAndPluginsSearchParams = useMemo(() => {
    if (activePluginType === PLUGIN_TYPE_SEARCH_MAP.all) {
      return EMPTY_PARAMS
    }
    return {
      category: activePluginType === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginType,
      condition: getMarketplaceListCondition(activePluginType),
      type: getMarketplaceListFilterType(activePluginType),
    }
  }, [activePluginType])

  const { data, isLoading } = useMarketplaceCollectionsAndPlugins(collectionsParams)

  return {
    marketplaceCollections: data?.marketplaceCollections,
    marketplaceCollectionPluginsMap: data?.marketplaceCollectionPluginsMap,
    isLoading,
  }
}

export const useMarketplacePluginsByCollectionId = (
  collectionId?: string,
  query?: CollectionsAndPluginsSearchParams,
) => {
  const {
    data,
    isFetching,
    isSuccess,
    isPending,
  } = useQuery({
    queryKey: marketplaceKeys.collectionPlugins(collectionId || '', query),
    queryFn: ({ signal }) => {
      if (!collectionId)
        return Promise.resolve<Plugin[]>([])
      return getMarketplacePluginsByCollectionId(collectionId, query, { signal })
    },
    enabled: !!collectionId,
  })

  return {
    plugins: data || [],
    isLoading: !!collectionId && (isFetching || isPending),
    isSuccess,
  }
}

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
      pageSize: 40,
    }
  }

  const {
    query,
    sortBy,
    sortOrder,
    category,
    tags,
    type,
    pageSize = 40,
  } = queryParams
  const pluginOrBundle = type === 'bundle' ? 'bundles' : 'plugins'

  try {
    const res = await postMarketplace<{ data: PluginsFromMarketplaceResponse }>(`/${pluginOrBundle}/search/advanced`, {
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
    })
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

export function useMarketplacePlugins(initialParams?: PluginsSearchParams) {
  const queryClient = useQueryClient()
  const [queryParams, handleUpdatePlugins] = useState<PluginsSearchParams | undefined>(initialParams)

  const marketplacePluginsQuery = useInfiniteQuery({
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

  const resetPlugins = useCallback(() => {
    handleUpdatePlugins(undefined)
    queryClient.removeQueries({
      queryKey: ['marketplacePlugins'],
    })
  }, [queryClient])

  const { run: queryPluginsWithDebounced, cancel: cancelQueryPluginsWithDebounced } = useDebounceFn((pluginsSearchParams: PluginsSearchParams) => {
    handleUpdatePlugins(pluginsSearchParams)
  }, {
    wait: 500,
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
    resetPlugins,
    queryPlugins: handleUpdatePlugins,
    queryPluginsWithDebounced,
    cancelQueryPluginsWithDebounced,
    isLoading: isPluginsLoading,
    isFetchingNextPage: marketplacePluginsQuery.isFetchingNextPage,
    hasNextPage: marketplacePluginsQuery.hasNextPage,
    fetchNextPage: marketplacePluginsQuery.fetchNextPage,
    page: marketplacePluginsQuery.data?.pages?.length || (marketplacePluginsQuery.isPending && hasQuery ? 1 : 0),
  }
}

export function useMarketplacePluginsReactive(queryParams?: PluginsSearchParams) {
  const marketplacePluginsQuery = useInfiniteQuery({
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

export const useMarketplaceContainerScroll = (
  callback: () => void,
  scrollContainerId = 'marketplace-container',
) => {
  const handleScroll = useCallback((e: Event) => {
    const target = e.target as HTMLDivElement
    const {
      scrollTop,
      scrollHeight,
      clientHeight,
    } = target
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
  }, [handleScroll])
}

export type { MarketplaceCollection, PluginsSearchParams }

export function useMarketplacePluginsData() {
  const sort = useMarketplaceSortValue()

  const [searchPluginText] = useMarketplaceSearchQuery()
  const [filterPluginTags] = useMarketplaceTags()
  const [activePluginType] = useMarketplaceCategory()

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
  const [,setQ] = useMarketplaceSearchQuery()
  const setSort = useSetMarketplaceSort()

  return useCallback((searchParams?: { query?: string, sort_by?: string, sort_order?: string }) => {
    if (!searchParams)
      return
    const newQuery = searchParams?.query || ''
    const newSort = {
      sortBy: searchParams?.sort_by || DEFAULT_SORT.sortBy,
      sortOrder: searchParams?.sort_order || DEFAULT_SORT.sortOrder,
    }
    setQ(newQuery)
    setSort(newSort)
    setSearchMode(true)
  }, [setQ, setSort])
}
