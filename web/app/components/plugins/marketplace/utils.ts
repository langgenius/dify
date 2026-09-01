import type {
  CollectionsAndPluginsSearchParams,
  MarketplacePlugin,
  MarketplaceTemplate,
  PluginsSearchParams,
} from '@dify/contracts/marketplace'
import type { ActivePluginType } from './constants'
import type { Plugin } from '@/app/components/plugins/types'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { marketplaceClient } from '@/service/client'
import { getMarketplaceUrl } from '@/utils/var'
import { PLUGIN_TYPE_SEARCH_MAP } from './constants'

type MarketplaceFetchOptions = {
  signal?: AbortSignal
}

export function buildCarouselPages<T>(items: T[], itemsPerPage: number): T[][] {
  const pages: T[][] = []

  for (let i = 0; i < items.length; i += itemsPerPage) pages.push(items.slice(i, i + itemsPerPage))

  return pages
}

type MarketplacePluginPayload = MarketplacePlugin | (Plugin & { labels?: Plugin['label'] })

export const getPluginIconInMarketplace = (
  plugin: Pick<MarketplacePluginPayload, 'name' | 'org' | 'type'>,
) => {
  if (plugin.type === 'bundle')
    return `${MARKETPLACE_API_PREFIX}/bundles/${plugin.org}/${plugin.name}/icon`
  return `${MARKETPLACE_API_PREFIX}/plugins/${plugin.org}/${plugin.name}/icon`
}

export const getFormattedPlugin = (payload: MarketplacePluginPayload): Plugin => {
  const plugin = payload as unknown as Plugin

  if (payload.type === 'bundle') {
    return {
      ...plugin,
      icon: getPluginIconInMarketplace(payload),
      brief: payload.description as Plugin['brief'],
      label: (payload.labels ?? payload.label) as Plugin['label'],
    }
  }
  return {
    ...plugin,
    icon: getPluginIconInMarketplace(payload),
  }
}

export const getPluginLinkInMarketplace = (
  plugin: Pick<MarketplacePluginPayload, 'name' | 'org' | 'type'>,
  params?: Record<string, string | undefined>,
) => {
  if (plugin.type === 'bundle')
    return getMarketplaceUrl(`/bundles/${plugin.org}/${plugin.name}`, params)
  return getMarketplaceUrl(`/plugins/${plugin.org}/${plugin.name}`, params)
}

export const getPluginDetailLinkInMarketplace = (
  plugin: Pick<MarketplacePluginPayload, 'name' | 'org' | 'type'>,
) => {
  const org = encodeURIComponent(plugin.org)
  const name = encodeURIComponent(plugin.name)

  if (plugin.type === 'bundle') return `/bundles/${org}/${name}`
  return `/plugin/${org}/${name}`
}

export const getTemplateLinkInMarketplace = (
  template: Pick<
    MarketplaceTemplate,
    'id' | 'publisher_handle' | 'publisher_unique_handle' | 'template_name'
  >,
  params?: Record<string, string | undefined>,
) => {
  const publisher = template.publisher_handle || template.publisher_unique_handle || 'template'
  const path = `/template/${encodeURIComponent(publisher)}/${encodeURIComponent(template.template_name)}`

  return getMarketplaceUrl(path, {
    ...params,
    templateId: template.id,
  })
}

export const getMarketplaceCategoryUrl = (
  category?: string,
  params?: Record<string, string | undefined>,
) => {
  return getMarketplaceUrl(category ? `/plugins/${category}` : '/plugins', params)
}
// One collections response lists every catalog carousel and each needs its own
// plugins request. Firing them all at once head-of-line blocks on the browser's
// per-origin connection cap, so the whole catalog waits on the slowest tail
// request — and every one of those is a request the next search has to abort.
const COLLECTION_PLUGINS_CONCURRENCY = 4

export const getMarketplacePluginsByCollectionId = async (
  collectionId: string,
  query?: CollectionsAndPluginsSearchParams,
  options?: MarketplaceFetchOptions,
) => {
  const marketplaceCollectionPluginsDataJson = await marketplaceClient.collectionPlugins(
    {
      params: {
        collectionId,
      },
      body: query ?? {},
    },
    {
      signal: options?.signal,
    },
  )

  return (marketplaceCollectionPluginsDataJson.data?.plugins || []).map((plugin) =>
    getFormattedPlugin(plugin),
  )
}

export const getMarketplaceCollectionsAndPlugins = async (
  query?: CollectionsAndPluginsSearchParams,
  options?: MarketplaceFetchOptions,
) => {
  // Deliberately not wrapped in a catch: a swallowed failure resolves as an
  // empty catalog, which react-query caches as a success for the whole
  // staleTime and renders as "nothing here" with no retry and no error signal.
  const marketplaceCollectionsDataJson = await marketplaceClient.collections(
    {
      query: {
        ...query,
        page: 1,
        page_size: 100,
      },
    },
    {
      signal: options?.signal,
    },
  )
  const marketplaceCollections = marketplaceCollectionsDataJson.data?.collections || []
  const marketplaceCollectionPluginsMap: Record<string, Plugin[]> = {}

  const pending = [...marketplaceCollections]
  const fetchCollectionPlugins = async () => {
    for (let collection = pending.shift(); collection; collection = pending.shift()) {
      try {
        marketplaceCollectionPluginsMap[collection.name] =
          await getMarketplacePluginsByCollectionId(collection.name, query, options)
      } catch {
        // One empty carousel beats a blank catalog: the collection list itself
        // loaded, so render what did arrive.
        marketplaceCollectionPluginsMap[collection.name] = []
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(COLLECTION_PLUGINS_CONCURRENCY, pending.length) },
      fetchCollectionPlugins,
    ),
  )

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

  const { query, sort_by, sort_order, category, tags, type, page_size = 40 } = queryParams

  // Errors propagate on purpose. Returning a synthesized empty page here made
  // every backend failure — and every aborted keystroke — look like a
  // successful zero-result search: react-query never saw isError, never
  // retried, cached the emptiness, reported total 0 to the analytics flush, and
  // permanently killed getNextPageParam for that key.
  const res = await marketplaceClient.searchAdvanced(
    {
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
    },
    { signal },
  )
  const resPlugins = res.data.bundles || res.data.plugins || []

  return {
    plugins: resPlugins.map((plugin) => getFormattedPlugin(plugin)),
    total: res.data.total,
    page: pageParam,
    page_size,
  }
}

export const getMarketplaceListCondition = (pluginType: string) => {
  if (
    [
      PluginCategoryEnum.tool,
      PluginCategoryEnum.agent,
      PluginCategoryEnum.model,
      PluginCategoryEnum.datasource,
      PluginCategoryEnum.trigger,
    ].includes(pluginType as PluginCategoryEnum)
  )
    return `category=${pluginType}`

  if (pluginType === PluginCategoryEnum.extension) return 'category=endpoint'

  if (pluginType === 'bundle') return 'type=bundle'

  return ''
}

export const getMarketplaceListFilterType = (category: ActivePluginType) => {
  if (category === PLUGIN_TYPE_SEARCH_MAP.all) return undefined

  if (category === PLUGIN_TYPE_SEARCH_MAP.bundle) return 'bundle'

  return 'plugin'
}

export function getCollectionsParams(
  category: ActivePluginType,
): CollectionsAndPluginsSearchParams {
  if (category === PLUGIN_TYPE_SEARCH_MAP.all) {
    return {}
  }
  return {
    category,
    condition: getMarketplaceListCondition(category),
    type: getMarketplaceListFilterType(category),
  }
}
