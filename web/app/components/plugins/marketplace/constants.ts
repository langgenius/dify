import { PluginCategoryEnum } from '../types'

export const DEFAULT_SORT = {
  sortBy: 'install_count',
  sortOrder: 'DESC',
}

/**
 * DOM id of the marketplace scroll container. The route components render it
 * and the scroll/viewport observers below the marketplace tree look it up.
 */
export const MARKETPLACE_CONTAINER_ID = 'marketplace-container'

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
} as const

type ValueOf<T> = T[keyof T]

export type ActivePluginType = ValueOf<typeof PLUGIN_TYPE_SEARCH_MAP>

export const PLUGIN_CATEGORY_WITH_COLLECTIONS = new Set<ActivePluginType>([
  PLUGIN_TYPE_SEARCH_MAP.all,
  PLUGIN_TYPE_SEARCH_MAP.tool,
])
