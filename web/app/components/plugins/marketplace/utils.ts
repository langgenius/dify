import { PLUGIN_TYPE_SEARCH_MAP } from './plugin-type-switch'
import type { Plugin } from '@/app/components/plugins/types'
import { PluginType } from '@/app/components/plugins/types'
import type {
  CollectionsAndPluginsSearchParams,
  MarketplaceCollection,
} from '@/app/components/plugins/marketplace/types'
import {
  MARKETPLACE_API_PREFIX,
  MARKETPLACE_URL_PREFIX,
} from '@/config'

export const getPluginIconInMarketplace = (plugin: Plugin) => {
  if (plugin.type === 'bundle')
    return `${MARKETPLACE_API_PREFIX}/bundles/${plugin.org}/${plugin.name}/icon`
  return `${MARKETPLACE_API_PREFIX}/plugins/${plugin.org}/${plugin.name}/icon`
}

export const getFormattedPlugin = (bundle: any) => {
  if (bundle.type === 'bundle') {
    return {
      ...bundle,
      icon: getPluginIconInMarketplace(bundle),
      brief: bundle.description,
      label: bundle.labels,
    }
  }
  return {
    ...bundle,
    icon: getPluginIconInMarketplace(bundle),
  }
}

export const getPluginLinkInMarketplace = (plugin: Plugin) => {
  if (plugin.type === 'bundle')
    return `${MARKETPLACE_URL_PREFIX}/bundles/${plugin.org}/${plugin.name}`
  return `${MARKETPLACE_URL_PREFIX}/plugins/${plugin.org}/${plugin.name}`
}

export const getMarketplacePluginsByCollectionId = async (collectionId: string, query?: CollectionsAndPluginsSearchParams) => {
  let plugins = [] as Plugin[]

  try {
    const url = `${MARKETPLACE_API_PREFIX}/collections/${collectionId}/plugins`
    const marketplaceCollectionPluginsData = await globalThis.fetch(
      url,
      {
        cache: 'no-store',
        method: 'POST',
        body: JSON.stringify({
          category: query?.category,
          exclude: query?.exclude,
          type: query?.type,
        }),
      },
    )
    const marketplaceCollectionPluginsDataJson = await marketplaceCollectionPluginsData.json()
    plugins = marketplaceCollectionPluginsDataJson.data.plugins.map((plugin: Plugin) => {
      return getFormattedPlugin(plugin)
    })
  }
  // eslint-disable-next-line unused-imports/no-unused-vars
  catch (e) {
    plugins = []
  }

  return plugins
}

export const getMarketplaceCollectionsAndPlugins = async (query?: CollectionsAndPluginsSearchParams) => {
  let marketplaceCollections = [] as MarketplaceCollection[]
  let marketplaceCollectionPluginsMap = {} as Record<string, Plugin[]>
  try {
    let marketplaceUrl = `${MARKETPLACE_API_PREFIX}/collections?page=1&page_size=100`
    if (query?.condition)
      marketplaceUrl += `&condition=${query.condition}`
    if (query?.type)
      marketplaceUrl += `&type=${query.type}`
    const marketplaceCollectionsData = await globalThis.fetch(marketplaceUrl, { cache: 'no-store' })
    const marketplaceCollectionsDataJson = await marketplaceCollectionsData.json()
    marketplaceCollections = marketplaceCollectionsDataJson.data.collections
    await Promise.all(marketplaceCollections.map(async (collection: MarketplaceCollection) => {
      const plugins = await getMarketplacePluginsByCollectionId(collection.name, query)

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

export const getMarketplaceListCondition = (pluginType: string) => {
  if (pluginType === PluginType.tool)
    return 'category=tool'

  if (pluginType === PluginType.agent)
    return 'category=agent-strategy'

  if (pluginType === PluginType.model)
    return 'category=model'

  if (pluginType === PluginType.extension)
    return 'category=endpoint'

  if (pluginType === 'bundle')
    return 'type=bundle'

  return ''
}

export const getMarketplaceListFilterType = (category: string) => {
  if (category === PLUGIN_TYPE_SEARCH_MAP.all)
    return undefined

  if (category === PLUGIN_TYPE_SEARCH_MAP.bundle)
    return 'bundle'

  return 'plugin'
}
