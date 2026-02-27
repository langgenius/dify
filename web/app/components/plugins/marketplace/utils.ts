import type { ActivePluginType } from './constants'
import type {
  CollectionsAndPluginsSearchParams,
  MarketplaceCollection,
  PluginsSearchParams,
} from '@/app/components/plugins/marketplace/types'
import type { Plugin } from '@/app/components/plugins/types'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import {
  MARKETPLACE_API_PREFIX,
} from '@/config'
import { marketplaceClient } from '@/service/client'
import { getMarketplaceUrl } from '@/utils/var'
import { PLUGIN_TYPE_SEARCH_MAP } from './constants'

type MarketplaceFetchOptions = {
  signal?: AbortSignal
}

export const getPluginIconInMarketplace = (plugin: Plugin) => {
  if (plugin.type === 'bundle')
    return `${MARKETPLACE_API_PREFIX}/bundles/${plugin.org}/${plugin.name}/icon`
  return `${MARKETPLACE_API_PREFIX}/plugins/${plugin.org}/${plugin.name}/icon`
}

export const getFormattedPlugin = (bundle: Plugin): Plugin => {
  if (bundle.type === 'bundle') {
    return {
      ...bundle,
      icon: getPluginIconInMarketplace(bundle),
      brief: bundle.description,
      // @ts-expect-error I do not have enough information
      label: bundle.labels,
    }
  }
  return {
    ...bundle,
    icon: getPluginIconInMarketplace(bundle),
  }
}

export const getPluginLinkInMarketplace = (plugin: Plugin, params?: Record<string, string | undefined>) => {
  if (plugin.type === 'bundle')
    return getMarketplaceUrl(`/bundles/${plugin.org}/${plugin.name}`, params)
  return getMarketplaceUrl(`/plugins/${plugin.org}/${plugin.name}`, params)
}

export const getPluginDetailLinkInMarketplace = (plugin: Plugin) => {
  if (plugin.type === 'bundle')
    return `/bundles/${plugin.org}/${plugin.name}`
  return `/plugins/${plugin.org}/${plugin.name}`
}

export const getMarketplacePluginsByCollectionId = async (
  collectionId: string,
  query?: CollectionsAndPluginsSearchParams,
  options?: MarketplaceFetchOptions,
) => {
  let plugins: Plugin[] = []

  try {
    const marketplaceCollectionPluginsDataJson = await marketplaceClient.collectionPlugins({
      params: {
        collectionId,
      },
      body: query,
    }, {
      signal: options?.signal,
    })
    plugins = (marketplaceCollectionPluginsDataJson.data?.plugins || []).map(plugin => getFormattedPlugin(plugin))
  }
  // eslint-disable-next-line unused-imports/no-unused-vars
  catch (e) {
    plugins = []
  }

  return plugins
}

export const getMarketplaceCollectionsAndPlugins = async (
  query?: CollectionsAndPluginsSearchParams,
  options?: MarketplaceFetchOptions,
) => {
  let marketplaceCollections: MarketplaceCollection[] = []
  let marketplaceCollectionPluginsMap: Record<string, Plugin[]> = {}
  try {
    const marketplaceCollectionsDataJson = await marketplaceClient.collections({
      query: {
        ...query,
        page: 1,
        page_size: 100,
      },
    }, {
      signal: options?.signal,
    })
    marketplaceCollections = marketplaceCollectionsDataJson.data?.collections || []
    await Promise.all(marketplaceCollections.map(async (collection: MarketplaceCollection) => {
      const plugins = await getMarketplacePluginsByCollectionId(collection.name, query, options)

      marketplaceCollectionPluginsMap[collection.name] = plugins
    }))
  }
  // eslint-disable-next-line unused-imports/no-unused-vars
  catch (e) {
    marketplaceCollections = []
    marketplaceCollectionPluginsMap = {}
  }

  return {
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
  }
}

export const getMarketplacePlugins = async (
  queryParams: PluginsSearchParams | undefined,
  pageParam: number,
  signal?: AbortSignal,
) => {
  if (!queryParams) {
    return {
      plugins: [] as Plugin[],
      total: 0,
      page: 1,
      page_size: 40,
    }
  }

  const {
    query,
    sort_by,
    sort_order,
    category,
    tags,
    type,
    page_size = 40,
  } = queryParams

  try {
    const res = await marketplaceClient.searchAdvanced({
      params: {
        kind: type === 'bundle' ? 'bundles' : 'plugins',
      },
      body: {
        page: pageParam,
        page_size,
        query,
        sort_by,
        sort_order,
        category: category !== 'all' ? category : '',
        tags,
      },
    }, { signal })
    const resPlugins = res.data.bundles || res.data.plugins || []

    return {
      plugins: resPlugins.map(plugin => getFormattedPlugin(plugin)),
      total: res.data.total,
      page: pageParam,
      page_size,
    }
  }
  catch {
    return {
      plugins: [],
      total: 0,
      page: pageParam,
      page_size,
    }
  }
}

export const getMarketplaceListCondition = (pluginType: string) => {
  if ([PluginCategoryEnum.tool, PluginCategoryEnum.agent, PluginCategoryEnum.model, PluginCategoryEnum.datasource, PluginCategoryEnum.trigger].includes(pluginType as PluginCategoryEnum))
    return `category=${pluginType}`

  if (pluginType === PluginCategoryEnum.extension)
    return 'category=endpoint'

  if (pluginType === 'bundle')
    return 'type=bundle'

  return ''
}

export const getMarketplaceListFilterType = (category: ActivePluginType) => {
  if (category === PLUGIN_TYPE_SEARCH_MAP.all)
    return undefined

  if (category === PLUGIN_TYPE_SEARCH_MAP.bundle)
    return 'bundle'

  return 'plugin'
}

export function getCollectionsParams(category: ActivePluginType): CollectionsAndPluginsSearchParams {
  if (category === PLUGIN_TYPE_SEARCH_MAP.all) {
    return {}
  }
  return {
    category,
    condition: getMarketplaceListCondition(category),
    type: getMarketplaceListFilterType(category),
  }
}
