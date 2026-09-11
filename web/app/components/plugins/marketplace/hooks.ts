import type {
  CollectionsAndPluginsSearchParams,
  MarketplaceCollection,
  PluginsFromMarketplaceResponse,
  PluginsSearchParams,
} from '@dify/contracts/marketplace'
import type { Plugin } from '../types'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { postMarketplace } from '@/service/base'
import { MARKETPLACE_CONTAINER_ID, SCROLL_BOTTOM_THRESHOLD } from './constants'
import {
  getFormattedPlugin,
  getMarketplaceCollectionsAndPlugins,
  getMarketplacePluginsByCollectionId,
} from './utils'

/**
 * @deprecated Use useMarketplaceCollectionsAndPlugins from query.ts instead
 */
export const useMarketplaceCollectionsAndPlugins = () => {
  const [queryParams, setQueryParams] = useState<CollectionsAndPluginsSearchParams>()
  const [marketplaceCollectionsOverride, setMarketplaceCollections] =
    useState<MarketplaceCollection[]>()
  const [marketplaceCollectionPluginsMapOverride, setMarketplaceCollectionPluginsMap] =
    useState<Record<string, Plugin[]>>()

  const { data, isFetching, isSuccess, isPending } = useQuery({
    queryKey: ['marketplaceCollectionsAndPlugins', queryParams],
    queryFn: ({ signal }) => getMarketplaceCollectionsAndPlugins(queryParams, { signal }),
    enabled: queryParams !== undefined,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: false,
  })

  const queryMarketplaceCollectionsAndPlugins = useCallback(
    (query?: CollectionsAndPluginsSearchParams) => {
      setQueryParams(query ? { ...query } : {})
    },
    [],
  )
  const isLoading = !!queryParams && (isPending || (isFetching && !data))

  return {
    marketplaceCollections: marketplaceCollectionsOverride ?? data?.marketplaceCollections,
    setMarketplaceCollections,
    marketplaceCollectionPluginsMap:
      marketplaceCollectionPluginsMapOverride ?? data?.marketplaceCollectionPluginsMap,
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
  const { data, isFetching, isSuccess, isPending } = useQuery({
    queryKey: ['marketplaceCollectionPlugins', collectionId, query],
    queryFn: ({ signal }) => {
      if (!collectionId) return Promise.resolve<Plugin[]>([])
      return getMarketplacePluginsByCollectionId(collectionId, query, { signal })
    },
    enabled: !!collectionId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: false,
  })

  return {
    plugins: data || [],
    isLoading: !!collectionId && (isPending || (isFetching && !data)),
    isSuccess,
  }
}
/**
 * @deprecated Use useMarketplacePlugins from query.ts instead
 */
export const useMarketplacePlugins = (enabled = true) => {
  const [queryParams, setQueryParams] = useState<PluginsSearchParams>()

  const normalizeParams = useCallback((pluginsSearchParams: PluginsSearchParams) => {
    const page_size = pluginsSearchParams.page_size || 40

    return {
      ...pluginsSearchParams,
      page_size,
    }
  }, [])

  const marketplacePluginsQuery = useInfiniteQuery({
    queryKey: ['marketplacePlugins', queryParams],
    queryFn: async ({ pageParam = 1, signal }) => {
      if (!queryParams) {
        return {
          plugins: [] as Plugin[],
          total: 0,
          page: 1,
          page_size: 40,
        }
      }

      const params = normalizeParams(queryParams)
      const { query, sort_by, sort_order, category, tags, exclude, type, page_size } = params
      const pluginOrBundle = type === 'bundle' ? 'bundles' : 'plugins'

      try {
        const res = await postMarketplace<{ data: PluginsFromMarketplaceResponse }>(
          `/${pluginOrBundle}/search/advanced`,
          {
            body: {
              page: pageParam,
              page_size,
              query,
              sort_by,
              sort_order,
              category: category !== 'all' ? category : '',
              tags,
              exclude,
              type,
            },
            signal,
          },
        )
        const resPlugins = res.data.bundles || res.data.plugins || []

        return {
          plugins: resPlugins.map((plugin) => getFormattedPlugin(plugin)),
          total: res.data.total,
          page: pageParam,
          page_size,
        }
      } catch {
        return {
          plugins: [],
          total: 0,
          page: pageParam,
          page_size,
        }
      }
    },
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1
      const loaded = lastPage.page * lastPage.page_size
      return loaded < (lastPage.total || 0) ? nextPage : undefined
    },
    initialPageParam: 1,
    enabled: enabled && !!queryParams,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: false,
  })

  const resetQueryParams = useCallback(() => {
    setQueryParams(undefined)
  }, [])

  const handleUpdatePlugins = useCallback(
    (pluginsSearchParams: PluginsSearchParams) => {
      setQueryParams(normalizeParams(pluginsSearchParams))
    },
    [normalizeParams],
  )

  const { run: queryPluginsWithDebounced, cancel: cancelQueryPluginsWithDebounced } = useDebounceFn(
    (pluginsSearchParams: PluginsSearchParams) => {
      handleUpdatePlugins(pluginsSearchParams)
    },
    {
      wait: 500,
    },
  )

  const hasQuery = !!queryParams
  const hasData = marketplacePluginsQuery.data !== undefined
  const plugins =
    hasQuery && hasData
      ? marketplacePluginsQuery.data.pages.flatMap((page) => page.plugins)
      : undefined
  const total = hasQuery && hasData ? marketplacePluginsQuery.data.pages?.[0]?.total : undefined
  const isPluginsLoading =
    enabled &&
    hasQuery &&
    (marketplacePluginsQuery.isPending ||
      (marketplacePluginsQuery.isFetching && !marketplacePluginsQuery.data))

  return {
    plugins,
    total,
    resetQueryParams,
    queryPlugins: handleUpdatePlugins,
    queryPluginsWithDebounced,
    cancelQueryPluginsWithDebounced,
    isLoading: isPluginsLoading,
    isFetchingNextPage: marketplacePluginsQuery.isFetchingNextPage,
    hasNextPage: marketplacePluginsQuery.hasNextPage,
    fetchNextPage: marketplacePluginsQuery.fetchNextPage,
    page:
      marketplacePluginsQuery.data?.pages?.length ||
      (marketplacePluginsQuery.isPending && hasQuery ? 1 : 0),
  }
}

export const useMarketplaceContainerScroll = (
  callback: () => void,
  scrollContainerId = MARKETPLACE_CONTAINER_ID,
) => {
  // The callback closes over isFetching, so its identity flips on every fetch
  // boundary. Re-subscribing on each flip dropped the scroll events in that
  // window; a ref keeps one listener for the container's lifetime.
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    const container = document.getElementById(scrollContainerId)
    if (!container) return

    // scrollTop/scrollHeight/clientHeight force a synchronous layout, so
    // measuring per scroll event janks the scroll. Worse, every threshold hit
    // calls fetchNextPage, which defaults to cancelRefetch: true — a burst
    // aborts and restarts the in-flight page request, and the backend counts
    // those aborts against its search circuit breaker. One measurement per
    // frame is both smoother and quieter on the wire.
    let frame = 0
    const handleScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const { scrollTop, scrollHeight, clientHeight } = container
        if (scrollTop > 0 && scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD)
          callbackRef.current()
      })
    }

    container.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      if (frame) cancelAnimationFrame(frame)
      container.removeEventListener('scroll', handleScroll)
    }
  }, [scrollContainerId])
}
