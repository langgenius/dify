import { describe, expect, it } from 'vitest'
import { PluginCategoryEnum } from '../../types'
import {
  DEFAULT_SORT,
  PLUGIN_CATEGORY_WITH_COLLECTIONS,
  PLUGIN_TYPE_SEARCH_MAP,
  SCROLL_BOTTOM_THRESHOLD,
} from '../constants'

describe('marketplace constants', () => {
  it('defines the expected default sort', () => {
    expect(DEFAULT_SORT).toEqual({
      sortBy: 'install_count',
      sortOrder: 'DESC',
    })
  })

  it('defines the expected plugin search type map', () => {
    expect(PLUGIN_TYPE_SEARCH_MAP).toEqual({
      all: 'all',
      model: PluginCategoryEnum.model,
      tool: PluginCategoryEnum.tool,
      agent: PluginCategoryEnum.agent,
      extension: PluginCategoryEnum.extension,
      datasource: PluginCategoryEnum.datasource,
      trigger: PluginCategoryEnum.trigger,
      bundle: 'bundle',
    })
    expect(SCROLL_BOTTOM_THRESHOLD).toBe(100)
  })

  it('tracks only collection-backed categories', () => {
    expect(PLUGIN_CATEGORY_WITH_COLLECTIONS.has(PLUGIN_TYPE_SEARCH_MAP.all)).toBe(true)
    expect(PLUGIN_CATEGORY_WITH_COLLECTIONS.has(PLUGIN_TYPE_SEARCH_MAP.tool)).toBe(true)
    expect(PLUGIN_CATEGORY_WITH_COLLECTIONS.has(PLUGIN_TYPE_SEARCH_MAP.model)).toBe(false)
  })
})
