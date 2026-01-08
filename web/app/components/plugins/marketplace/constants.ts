import { parseAsArrayOf, parseAsString } from 'nuqs/server'

import { PluginCategoryEnum } from '../types'

export const DEFAULT_SORT = {
  sortBy: 'install_count',
  sortOrder: 'DESC',
}

export const SCROLL_BOTTOM_THRESHOLD = 100

export const PLUGIN_TYPE_SEARCH_MAP = {
  all: 'all',
  model: PluginCategoryEnum.model,
  tool: PluginCategoryEnum.tool,
  agent: PluginCategoryEnum.agent,
  extension: PluginCategoryEnum.extension,
  datasource: PluginCategoryEnum.datasource,
  trigger: PluginCategoryEnum.trigger,
  bundle: 'bundle',
}

export const PLUGIN_CATEGORY_WITH_COLLECTIONS = new Set(
  [
    PLUGIN_TYPE_SEARCH_MAP.all,
    PLUGIN_TYPE_SEARCH_MAP.tool,
  ],
)

export const marketplaceSearchParams = {
  q: parseAsString.withDefault('').withOptions({ history: 'replace' }),
  category: parseAsString.withDefault('all').withOptions({ history: 'replace', clearOnDefault: false }),
  tags: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
}
