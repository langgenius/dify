import { describe, expect, it } from 'vitest'
import { categoryKeys, tagKeys } from '../constants'
import { PluginCategoryEnum } from '../types'

describe('plugin constants', () => {
  it('exposes the expected plugin tag keys', () => {
    expect(tagKeys).toEqual([
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
    ])
  })

  it('exposes the expected category keys in display order', () => {
    expect(categoryKeys).toEqual([
      PluginCategoryEnum.model,
      PluginCategoryEnum.tool,
      PluginCategoryEnum.datasource,
      PluginCategoryEnum.agent,
      PluginCategoryEnum.extension,
      'bundle',
      PluginCategoryEnum.trigger,
    ])
  })
})
