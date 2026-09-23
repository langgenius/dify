import { PluginCategoryEnum } from '../types'

export type EmbeddedMarketplaceCategory = 'agent-strategy' | 'extension' | 'trigger'

export const isEmbeddedMarketplaceCategory = (
  category?: EmbeddedMarketplaceCategory | PluginCategoryEnum,
): category is EmbeddedMarketplaceCategory =>
  category === PluginCategoryEnum.trigger ||
  category === PluginCategoryEnum.agent ||
  category === PluginCategoryEnum.extension

export const getCategoryMarketplaceId = (category: EmbeddedMarketplaceCategory) =>
  `plugin-category-marketplace-${category}`
