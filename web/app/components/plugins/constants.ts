import { PluginCategoryEnum } from './types'

export const tagKeys = [
  'agent',
  'rag',
  'search',
  'image',
  'videos',
  'weather',
  'finance',
  'design',
  'travel',
  'social',
  'news',
  'medical',
  'productivity',
  'education',
  'business',
  'entertainment',
  'utilities',
  'other',
] as const

export type TagKey = typeof tagKeys[number]

export const categoryKeys = [
  PluginCategoryEnum.model,
  PluginCategoryEnum.tool,
  PluginCategoryEnum.datasource,
  PluginCategoryEnum.agent,
  PluginCategoryEnum.extension,
  'bundle',
  PluginCategoryEnum.trigger,
] as const

export type CategoryKey = typeof categoryKeys[number]
