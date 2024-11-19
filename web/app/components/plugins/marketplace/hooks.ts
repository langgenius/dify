import {
  useCallback,
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
  getMarketplaceCollectionsAndPlugins,
  getPluginIconInMarketplace,
} from './utils'
import i18n from '@/i18n/i18next-config'
import { useMutationPluginsFromMarketplace } from '@/service/use-plugins'

export const useMarketplaceCollectionsAndPlugins = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [marketplaceCollections, setMarketplaceCollections] = useState<MarketplaceCollection[]>()
  const [marketplaceCollectionPluginsMap, setMarketplaceCollectionPluginsMap] = useState<Record<string, Plugin[]>>()

  const queryMarketplaceCollectionsAndPlugins = useCallback(async (query?: CollectionsAndPluginsSearchParams) => {
    setIsLoading(true)
    const { marketplaceCollections, marketplaceCollectionPluginsMap } = await getMarketplaceCollectionsAndPlugins(query)
    setIsLoading(false)

    setMarketplaceCollections(marketplaceCollections)
    setMarketplaceCollectionPluginsMap(marketplaceCollectionPluginsMap)
  }, [])

  return {
    marketplaceCollections,
    setMarketplaceCollections,
    marketplaceCollectionPluginsMap,
    setMarketplaceCollectionPluginsMap,
    queryMarketplaceCollectionsAndPlugins,
    isLoading,
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

  const { run: queryPluginsWithDebounced } = useDebounceFn((pluginsSearchParams) => {
    mutate(pluginsSearchParams)
  }, {
    wait: 500,
  })

  return {
    plugins: data?.data?.plugins.map(plugin => ({
      ...plugin,
      icon: getPluginIconInMarketplace(plugin),
    })),
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
