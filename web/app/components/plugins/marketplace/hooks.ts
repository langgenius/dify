import {
  useCallback,
  useEffect,
  useState,
} from 'react'
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
} from './utils'
import i18n from '@/i18n-config/i18next-config'
import {
  useMutationPluginsFromMarketplace,
} from '@/service/use-plugins'

export const useMarketplaceCollectionsAndPlugins = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [marketplaceCollections, setMarketplaceCollections] = useState<MarketplaceCollection[]>()
  const [marketplaceCollectionPluginsMap, setMarketplaceCollectionPluginsMap] = useState<Record<string, Plugin[]>>()

  const queryMarketplaceCollectionsAndPlugins = useCallback(async (query?: CollectionsAndPluginsSearchParams) => {
    try {
      setIsLoading(true)
      setIsSuccess(false)
      const { marketplaceCollections, marketplaceCollectionPluginsMap } = await getMarketplaceCollectionsAndPlugins(query)
      setIsLoading(false)
      setIsSuccess(true)
      setMarketplaceCollections(marketplaceCollections)
      setMarketplaceCollectionPluginsMap(marketplaceCollectionPluginsMap)
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (e) {
      setIsLoading(false)
      setIsSuccess(false)
    }
  }, [])

  return {
    marketplaceCollections,
    setMarketplaceCollections,
    marketplaceCollectionPluginsMap,
    setMarketplaceCollectionPluginsMap,
    queryMarketplaceCollectionsAndPlugins,
    isLoading,
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
  const queryPlugins = useCallback((pluginsSearchParams: PluginsSearchParams) => {
    handleUpdatePlugins(pluginsSearchParams)
  }, [handleUpdatePlugins])

  const { run: queryPluginsWithDebounced, cancel: cancelQueryPluginsWithDebounced } = useDebounceFn((pluginsSearchParams: PluginsSearchParams) => {
    handleUpdatePlugins(pluginsSearchParams)
  }, {
    wait: 500,
  })

  return {
    plugins: prevPlugins,
    total: data?.data?.total,
    resetPlugins,
    queryPlugins,
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
