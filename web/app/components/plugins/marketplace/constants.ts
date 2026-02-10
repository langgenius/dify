import { PluginCategoryEnum } from '../types'

export const DEFAULT_SORT = {
  sortBy: 'install_count',
  sortOrder: 'DESC',
}

export const SCROLL_BOTTOM_THRESHOLD = 100

export const CATEGORY_ALL = 'all'

export const PLUGIN_TYPE_SEARCH_MAP = {
  all: CATEGORY_ALL,
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

export const PLUGIN_CATEGORY_WITH_COLLECTIONS = new Set<ActivePluginType>(
  [
    PLUGIN_TYPE_SEARCH_MAP.all,
    PLUGIN_TYPE_SEARCH_MAP.tool,
  ],
)


export const TEMPLATE_CATEGORY_MAP = {
  all: CATEGORY_ALL,
  marketing: 'marketing',
  sales: 'sales',
  support: 'support',
  operations: 'operations',
  it: 'it',
  knowledge: 'knowledge',
  design: 'design',
} as const

export type ActiveTemplateCategory = typeof TEMPLATE_CATEGORY_MAP[keyof typeof TEMPLATE_CATEGORY_MAP]

export function getValidatedPluginCategory(category: string): ActivePluginType {
  const key = (category in PLUGIN_TYPE_SEARCH_MAP ? category : CATEGORY_ALL) as keyof typeof PLUGIN_TYPE_SEARCH_MAP
  return PLUGIN_TYPE_SEARCH_MAP[key]
}

export function getValidatedTemplateCategory(category: string): ActiveTemplateCategory {
  const key = (category in TEMPLATE_CATEGORY_MAP ? category : CATEGORY_ALL) as keyof typeof TEMPLATE_CATEGORY_MAP
  return TEMPLATE_CATEGORY_MAP[key]
}
