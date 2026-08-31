import type { PluginsSearchParams, PluginsSort } from '@dify/contracts/marketplace'
import type { inferParserType } from 'nuqs/server'
import type { ActivePluginType } from './constants'
import { parseAsArrayOf, parseAsString, parseAsStringEnum } from 'nuqs/server'
import { DEFAULT_SORT, PLUGIN_CATEGORY_WITH_COLLECTIONS, PLUGIN_TYPE_SEARCH_MAP } from './constants'
import { getMarketplaceListFilterType } from './utils'

export const marketplaceSearchParamsParsers = {
  category: parseAsStringEnum<ActivePluginType>(
    Object.values(PLUGIN_TYPE_SEARCH_MAP) as ActivePluginType[],
  )
    .withDefault('all')
    .withOptions({ history: 'replace', clearOnDefault: false, scroll: false }),
  q: parseAsString.withDefault('').withOptions({ history: 'replace', scroll: false }),
  tags: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
  languages: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
}

export type MarketplaceSearchParams = inferParserType<typeof marketplaceSearchParamsParsers>

export const shouldSearchMarketplacePlugins = ({ category, q, tags }: MarketplaceSearchParams) =>
  Boolean(q || tags.length > 0 || !PLUGIN_CATEGORY_WITH_COLLECTIONS.has(category))

export const getMarketplacePluginsSearchParams = (
  { category, q, tags }: Pick<MarketplaceSearchParams, 'category' | 'q' | 'tags'>,
  sort: PluginsSort = DEFAULT_SORT,
): PluginsSearchParams => ({
  query: q,
  category: category === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : category,
  tags,
  sort_by: sort.sortBy,
  sort_order: sort.sortOrder,
  type: getMarketplaceListFilterType(category),
})
