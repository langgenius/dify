import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useQuery } from '@tanstack/react-query'
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
import i18n from '@/i18n-config/i18next-config'
import {
  useMutationPluginsFromMarketplace,
} from '@/service/use-plugins'

export const useMarketplaceCollectionsAndPlugins = () => {
  const [queryParams, setQueryParams] = useState<CollectionsAndPluginsSearchParams>()
  const [marketplaceCollectionsOverride, setMarketplaceCollections] = useState<MarketplaceCollection[]>()
  const [marketplaceCollectionPluginsMapOverride, setMarketplaceCollectionPluginsMap] = useState<Record<string, Plugin[]>>()

  const {
    data,
    isFetching,
    isSuccess,
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

  return {
    marketplaceCollections: marketplaceCollectionsOverride ?? data?.marketplaceCollections,
    setMarketplaceCollections,
    marketplaceCollectionPluginsMap: marketplaceCollectionPluginsMapOverride ?? data?.marketplaceCollectionPluginsMap,
    setMarketplaceCollectionPluginsMap,
    queryMarketplaceCollectionsAndPlugins,
    isLoading: isFetching,
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
    isLoading: isFetching,
    isSuccess,
  }
}

export const useMarketplacePlugins = () => {
  const {
    data,
    mutateAsync,
    reset,
    isPending,
  } = useMutationPluginsFromMarketplace()

  const [prevPlugins, setPrevPlugins] = useState<Plugin[] | undefined>()

  const resetPlugins = useCallback(() => {
    reset()
    setPrevPlugins(undefined)
  }, [reset])

  const handleUpdatePlugins = useCallback((pluginsSearchParams: PluginsSearchParams) => {
    mutateAsync(pluginsSearchParams).then((res) => {
      const currentPage = pluginsSearchParams.page || 1
      const resPlugins = res.data.bundles || res.data.plugins
      if (currentPage > 1) {
        setPrevPlugins(prevPlugins => [...(prevPlugins || []), ...resPlugins.map((plugin) => {
          return getFormattedPlugin(plugin)
        })])
      }
      else {
        setPrevPlugins(resPlugins.map((plugin) => {
          return getFormattedPlugin(plugin)
        }))
      }
    })
  }, [mutateAsync])

  const { run: queryPluginsWithDebounced, cancel: cancelQueryPluginsWithDebounced } = useDebounceFn((pluginsSearchParams: PluginsSearchParams) => {
    handleUpdatePlugins(pluginsSearchParams)
  }, {
    wait: 500,
  })

  return {
    plugins: prevPlugins,
    total: data?.data?.total,
    resetPlugins,
    queryPlugins: handleUpdatePlugins,
    queryPluginsWithDebounced,
    cancelQueryPluginsWithDebounced,
    isLoading: isPending,
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
    if (scrollTop + clientHeight >= scrollHeight - 5 && scrollTop > 0)
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

export const useSearchBoxAutoAnimate = (searchBoxAutoAnimate?: boolean) => {
  const [searchBoxCanAnimate, setSearchBoxCanAnimate] = useState(true)

  const handleSearchBoxCanAnimateChange = useCallback(() => {
    if (!searchBoxAutoAnimate) {
      const clientWidth = document.documentElement.clientWidth

      if (clientWidth < 1400)
        setSearchBoxCanAnimate(false)
      else
        setSearchBoxCanAnimate(true)
    }
  }, [searchBoxAutoAnimate])

  useEffect(() => {
    handleSearchBoxCanAnimateChange()
  }, [handleSearchBoxCanAnimateChange])

  useEffect(() => {
    window.addEventListener('resize', handleSearchBoxCanAnimateChange)

    return () => {
      window.removeEventListener('resize', handleSearchBoxCanAnimateChange)
    }
  }, [handleSearchBoxCanAnimateChange])

  return {
    searchBoxCanAnimate,
  }
}
