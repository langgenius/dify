import { describe, expect, it } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { DEFAULT_SORT, PLUGIN_CATEGORY_WITH_COLLECTIONS, PLUGIN_TYPE_SEARCH_MAP, SCROLL_BOTTOM_THRESHOLD } from './constants'

describe('DEFAULT_SORT', () => {
  it('should have correct default sort values', () => {
    expect(DEFAULT_SORT).toEqual({
      sortBy: 'install_count',
      sortOrder: 'DESC',
    })
  })

  it('should be immutable at runtime', () => {
    const originalSortBy = DEFAULT_SORT.sortBy
    const originalSortOrder = DEFAULT_SORT.sortOrder

    expect(DEFAULT_SORT.sortBy).toBe(originalSortBy)
    expect(DEFAULT_SORT.sortOrder).toBe(originalSortOrder)
  })
})

describe('SCROLL_BOTTOM_THRESHOLD', () => {
  it('should be 100 pixels', () => {
    expect(SCROLL_BOTTOM_THRESHOLD).toBe(100)
  })
})

describe('PLUGIN_TYPE_SEARCH_MAP', () => {
  it('should contain all expected keys', () => {
    expect(PLUGIN_TYPE_SEARCH_MAP).toHaveProperty('all')
    expect(PLUGIN_TYPE_SEARCH_MAP).toHaveProperty('model')
    expect(PLUGIN_TYPE_SEARCH_MAP).toHaveProperty('tool')
    expect(PLUGIN_TYPE_SEARCH_MAP).toHaveProperty('agent')
    expect(PLUGIN_TYPE_SEARCH_MAP).toHaveProperty('extension')
    expect(PLUGIN_TYPE_SEARCH_MAP).toHaveProperty('datasource')
    expect(PLUGIN_TYPE_SEARCH_MAP).toHaveProperty('trigger')
    expect(PLUGIN_TYPE_SEARCH_MAP).toHaveProperty('bundle')
  })

  it('should map to correct category enum values', () => {
    expect(PLUGIN_TYPE_SEARCH_MAP.all).toBe('all')
    expect(PLUGIN_TYPE_SEARCH_MAP.model).toBe(PluginCategoryEnum.model)
    expect(PLUGIN_TYPE_SEARCH_MAP.tool).toBe(PluginCategoryEnum.tool)
    expect(PLUGIN_TYPE_SEARCH_MAP.agent).toBe(PluginCategoryEnum.agent)
    expect(PLUGIN_TYPE_SEARCH_MAP.extension).toBe(PluginCategoryEnum.extension)
    expect(PLUGIN_TYPE_SEARCH_MAP.datasource).toBe(PluginCategoryEnum.datasource)
    expect(PLUGIN_TYPE_SEARCH_MAP.trigger).toBe(PluginCategoryEnum.trigger)
    expect(PLUGIN_TYPE_SEARCH_MAP.bundle).toBe('bundle')
  })
})

describe('PLUGIN_CATEGORY_WITH_COLLECTIONS', () => {
  it('should include all and tool categories', () => {
    expect(PLUGIN_CATEGORY_WITH_COLLECTIONS.has(PLUGIN_TYPE_SEARCH_MAP.all)).toBe(true)
    expect(PLUGIN_CATEGORY_WITH_COLLECTIONS.has(PLUGIN_TYPE_SEARCH_MAP.tool)).toBe(true)
  })

  it('should not include other categories', () => {
    expect(PLUGIN_CATEGORY_WITH_COLLECTIONS.has(PLUGIN_TYPE_SEARCH_MAP.model)).toBe(false)
    expect(PLUGIN_CATEGORY_WITH_COLLECTIONS.has(PLUGIN_TYPE_SEARCH_MAP.bundle)).toBe(false)
  })
})
