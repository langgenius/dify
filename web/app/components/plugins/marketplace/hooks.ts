import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useDebounceFn } from 'ahooks'
import type {
  Plugin,
} from '../types'
import type {
  CollectionsAndPluginsSearchParams,
  MarketplaceCollection,
  PluginsSearchParams,
} from './types'
import {
  getFormattedPlugin,
  getMarketplaceCollectionsAndPlugins,
  getMarketplacePluginsByCollectionId,
} from './utils'
import { SCROLL_BOTTOM_THRESHOLD } from './constants'
import i18n from '@/i18n-config/i18next-config'
import { postMarketplace } from '@/service/base'
import type { PluginsFromMarketplaceResponse } from '@/app/components/plugins/types'

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
    queryKey: ['marketplaceCollectionsAndPlugins', queryParams],
    queryFn: ({ signal }) => getMarketplaceCollectionsAndPlugins(queryParams, { signal }),
    enabled: queryParams !== undefined,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: false,
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
    queryKey: ['marketplaceCollectionPlugins', collectionId, query],
    queryFn: ({ signal }) => {
      if (!collectionId)
        return Promise.resolve<Plugin[]>([])
      return getMarketplacePluginsByCollectionId(collectionId, query, { signal })
    },
    enabled: !!collectionId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: false,
  })

  return {
    plugins: data || [],
    isLoading: !!collectionId && (isFetching || isPending),
    isSuccess,
  }
}

export const useMarketplacePlugins = () => {
  const queryClient = useQueryClient()
  const [queryParams, setQueryParams] = useState<PluginsSearchParams>()

  const normalizeParams = useCallback((pluginsSearchParams: PluginsSearchParams) => {
    const pageSize = pluginsSearchParams.pageSize || 40

    return {
      ...pluginsSearchParams,
      pageSize,
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
          pageSize: 40,
        }
      }

      const params = normalizeParams(queryParams)
      const {
        query,
        sortBy,
        sortOrder,
        category,
        tags,
        exclude,
        type,
        pageSize,
      } = params
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
            exclude,
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
    },
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1
      const loaded = lastPage.page * lastPage.pageSize
      return loaded < (lastPage.total || 0) ? nextPage : undefined
    },
    initialPageParam: 1,
    enabled: !!queryParams,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: false,
  })

  const resetPlugins = useCallback(() => {
    setQueryParams(undefined)
    queryClient.removeQueries({
      queryKey: ['marketplacePlugins'],
    })
  }, [queryClient])

  const handleUpdatePlugins = useCallback((pluginsSearchParams: PluginsSearchParams) => {
    setQueryParams(normalizeParams(pluginsSearchParams))
  }, [normalizeParams])

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

/**
 * ! Support zh-Hans, pt-BR, ja-JP and en-US for Marketplace page
 * ! For other languages, use en-US as fallback
 */
export const useMixedTranslation = (localeFromOuter?: string) => {
  let t = useTranslation().t

  if (localeFromOuter)
    t = i18n.getFixedT(localeFromOuter)

  return {
    t,
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
