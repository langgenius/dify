import type {
  Plugin,
} from '../types'
import type {
  CollectionsAndPluginsSearchParams,
  MarketplaceCollection,
  PluginsSearchParams,
} from './types'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { SCROLL_BOTTOM_THRESHOLD } from './constants'
import { marketplaceKeys } from './query'
import {
  getMarketplaceCollectionsAndPlugins,
  getMarketplacePlugins,
  getMarketplacePluginsByCollectionId,
} from './utils'

/**
 * @deprecated Use useMarketplaceCollectionsAndPlugins from query.ts instead
 */
export const useMarketplaceCollectionsAndPlugins = () => {
  const [queryParams, setQueryParams] = useState<CollectionsAndPluginsSearchParams>()
  const [marketplaceCollectionsOverride, setMarketplaceCollections] = useState<MarketplaceCollection[]>()
  const [marketplaceCollectionPluginsMapOverride, setMarketplaceCollectionPluginsMap] = useState<Record<string, Plugin[]>>()

  const {
    data,
    isFetching,
    isSuccess,
    isPending,
  } = useQuery({
    queryKey: marketplaceKeys.collections(queryParams),
    queryFn: ({ signal }) => getMarketplaceCollectionsAndPlugins(queryParams, { signal }),
    enabled: queryParams !== undefined,
  })

  const queryMarketplaceCollectionsAndPlugins = useCallback((query?: CollectionsAndPluginsSearchParams) => {
    setQueryParams(query ? { ...query } : {})
  }, [])
  const isLoading = !!queryParams && (isFetching || isPending)

  return {
    marketplaceCollections: marketplaceCollectionsOverride ?? data?.marketplaceCollections,
    setMarketplaceCollections,
    marketplaceCollectionPluginsMap: marketplaceCollectionPluginsMapOverride ?? data?.marketplaceCollectionPluginsMap,
    setMarketplaceCollectionPluginsMap,
    queryMarketplaceCollectionsAndPlugins,
    isLoading,
    isSuccess,
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
/**
 * @deprecated Use useMarketplacePlugins from query.ts instead
 */
export const useMarketplacePlugins = () => {
  const queryClient = useQueryClient()
  const [queryParams, setQueryParams] = useState<PluginsSearchParams>()

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

  const resetPlugins = useCallback(() => {
    setQueryParams(undefined)
    queryClient.removeQueries({
      queryKey: ['marketplacePlugins'],
    })
  }, [queryClient])

  const handleUpdatePlugins = useCallback((pluginsSearchParams: PluginsSearchParams) => {
    setQueryParams(pluginsSearchParams)
  }, [])

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
