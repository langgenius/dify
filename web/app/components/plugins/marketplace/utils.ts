import type {
  CollectionsAndPluginsSearchParams,
  MarketplacePlugin,
  PluginsSearchParams,
} from '@dify/contracts/marketplace'
import type { ActivePluginType } from './constants'
import type { Plugin } from '@/app/components/plugins/types'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { getMarketplacePluginIconUrl } from '@/features/marketplace/api'
import { marketplaceClient } from '@/service/marketplace'
import { PLUGIN_TYPE_SEARCH_MAP } from './constants'

type MarketplaceFetchOptions = {
  signal?: AbortSignal
}

type MarketplacePluginListExtras = {
  agent_strategy?: unknown
  data_sources?: unknown
  model?: unknown
  plugins?: unknown
  privacy_options?: unknown
  privacy_policy?: unknown
  readme_meta?: unknown
  resource?: unknown
  tool?: unknown
  triggers?: unknown
}

export const toListPlugin = (plugin: Plugin): Plugin => {
  const {
    agent_strategy: _agentStrategy,
    data_sources: _dataSources,
    introduction: _introduction,
    model: _model,
    plugins: _plugins,
    privacy_options: _privacyOptions,
    privacy_policy: _privacyPolicy,
    readme_meta: _readmeMeta,
    resource: _resource,
    tool: _tool,
    triggers: _triggers,
    ...listFields
  } = plugin as Plugin & MarketplacePluginListExtras

  return {
    ...listFields,
    introduction: '',
    endpoint: { settings: [] },
  }
}

export function buildCarouselPages<T>(items: T[], itemsPerPage: number): T[][] {
  const pages: T[][] = []

  for (let i = 0; i < items.length; i += itemsPerPage) pages.push(items.slice(i, i + itemsPerPage))

  return pages
}

type MarketplacePluginPayload = MarketplacePlugin | (Plugin & { labels?: Plugin['label'] })

export const getPluginIconInMarketplace = (
  plugin: Pick<MarketplacePluginPayload, 'name' | 'org' | 'type'>,
) => getMarketplacePluginIconUrl(`${plugin.org}/${plugin.name}`, plugin.type)

export const getFormattedPlugin = (payload: MarketplacePluginPayload): Plugin => {
  const plugin = payload as Plugin

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
    toListPlugin(getFormattedPlugin(plugin)),
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
      } catch (error) {
        if (options?.signal?.aborted) throw error
        // One empty carousel beats a blank catalog: the collection list itself
        // loaded, so render what did arrive. Cancellation must not take this
        // path — react-query would cache the empty carousels as a success.
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
  const marketplaceCategories: PluginCategoryEnum[] = [
    PluginCategoryEnum.tool,
    PluginCategoryEnum.agent,
    PluginCategoryEnum.model,
    PluginCategoryEnum.datasource,
    PluginCategoryEnum.trigger,
  ]
  if (marketplaceCategories.includes(pluginType as PluginCategoryEnum))
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
