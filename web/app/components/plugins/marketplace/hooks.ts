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
import i18n from '@/i18n/i18next-config'
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
    mutate,
    reset,
    isPending,
  } = useMutationPluginsFromMarketplace()

  const queryPlugins = useCallback((pluginsSearchParams: PluginsSearchParams) => {
    mutate(pluginsSearchParams)
  }, [mutate])

  const { run: queryPluginsWithDebounced } = useDebounceFn((pluginsSearchParams: PluginsSearchParams) => {
    mutate(pluginsSearchParams)
  }, {
    wait: 500,
  })

  return {
    plugins: data?.data?.plugins.map((plugin) => {
      return getFormattedPlugin(plugin)
    }),
    total: data?.data?.total,
    resetPlugins: reset,
    queryPlugins,
    queryPluginsWithDebounced,
    isLoading: isPending,
  }
}

export const useMixedTranslation = (localeFromOuter?: string) => {
  let t = useTranslation().t

  if (localeFromOuter)
    t = i18n.getFixedT(localeFromOuter)

  return {
    t,
  }
}

export const useMarketplaceContainerScroll = (callback: () => void) => {
  const container = document.getElementById('marketplace-container')

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
    if (container)
      container.addEventListener('scroll', handleScroll)

    return () => {
      if (container)
        container.removeEventListener('scroll', handleScroll)
    }
  }, [container, handleScroll])
}
