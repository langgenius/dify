import type { Plugin } from '@/app/components/plugins/types'
import type {
  MarketplaceCollection,
  PluginsSearchParams,
} from '@/app/components/plugins/marketplace/types'

const MARKETPLACE_API_URL = 'https://marketplace.dify.dev/api/v1'
export const getMarketplaceCollectionsAndPlugins = async () => {
  let marketplaceCollections = [] as MarketplaceCollection[]
  let marketplaceCollectionPluginsMap = {} as Record<string, Plugin[]>
  try {
    const marketplaceCollectionsData = await globalThis.fetch(`${MARKETPLACE_API_URL}/collections`)
    const marketplaceCollectionsDataJson = await marketplaceCollectionsData.json()
    marketplaceCollections = marketplaceCollectionsDataJson.data.collections
    await Promise.all(marketplaceCollections.map(async (collection: MarketplaceCollection) => {
      const marketplaceCollectionPluginsData = await globalThis.fetch(`${MARKETPLACE_API_URL}/collections/${collection.name}/plugins`)
      const marketplaceCollectionPluginsDataJson = await marketplaceCollectionPluginsData.json()
      const plugins = marketplaceCollectionPluginsDataJson.data.plugins

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

export const getMarketplacePlugins = async (query: PluginsSearchParams) => {
  let marketplacePlugins = [] as Plugin[]
  try {
    const marketplacePluginsData = await globalThis.fetch(
      `${MARKETPLACE_API_URL}/plugins`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          page: 1,
          page_size: 10,
          query: query.query,
          sort_by: query.sortBy,
          sort_order: query.sortOrder,
          category: query.category,
          tag: query.tag,
        }),
      },
    )
    const marketplacePluginsDataJson = await marketplacePluginsData.json()
    marketplacePlugins = marketplacePluginsDataJson.data.plugins
  }
  // eslint-disable-next-line unused-imports/no-unused-vars
  catch (e) {
    marketplacePlugins = []
  }

  return {
    marketplacePlugins,
  }
}
