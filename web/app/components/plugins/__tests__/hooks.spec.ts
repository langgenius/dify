import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_PAGE_TABS_MAP, useCategories, usePluginPageTabs, useTags } from '../hooks'

describe('useTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return non-empty tags array with name and label properties', () => {
    const { result } = renderHook(() => useTags())

    expect(result.current.tags.length).toBeGreaterThan(0)
    result.current.tags.forEach((tag) => {
      expect(typeof tag.name).toBe('string')
      expect(tag.label).toBe(`pluginTags.tags.${tag.name}`)
    })
  })

  it('should build a tagsMap that maps every tag name to its object', () => {
    const { result } = renderHook(() => useTags())

    result.current.tags.forEach((tag) => {
      expect(result.current.tagsMap[tag.name]).toEqual(tag)
    })
  })

  describe('getTagLabel', () => {
    it('should return translated label for existing tags', () => {
      const { result } = renderHook(() => useTags())

      expect(result.current.getTagLabel('agent')).toBe('pluginTags.tags.agent')
      expect(result.current.getTagLabel('search')).toBe('pluginTags.tags.search')
      expect(result.current.getTagLabel('rag')).toBe('pluginTags.tags.rag')
    })

    it('should return the name itself for non-existing tags', () => {
      const { result } = renderHook(() => useTags())

      expect(result.current.getTagLabel('non-existing')).toBe('non-existing')
      expect(result.current.getTagLabel('custom-tag')).toBe('custom-tag')
    })

    it('should handle edge cases: empty string and special characters', () => {
      const { result } = renderHook(() => useTags())

      expect(result.current.getTagLabel('')).toBe('')
      expect(result.current.getTagLabel('tag-with-dashes')).toBe('tag-with-dashes')
      expect(result.current.getTagLabel('tag_with_underscores')).toBe('tag_with_underscores')
    })
  })

  it('should return same structure on re-render', () => {
    const { result, rerender } = renderHook(() => useTags())

    const firstTagNames = result.current.tags.map(t => t.name)
    rerender()
    expect(result.current.tags.map(t => t.name)).toEqual(firstTagNames)
  })
})

describe('useCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return non-empty categories array with name and label properties', () => {
    const { result } = renderHook(() => useCategories())

    expect(result.current.categories.length).toBeGreaterThan(0)
    result.current.categories.forEach((category) => {
      expect(typeof category.name).toBe('string')
      expect(typeof category.label).toBe('string')
    })
  })

  it('should build a categoriesMap that maps every category name to its object', () => {
    const { result } = renderHook(() => useCategories())

    result.current.categories.forEach((category) => {
      expect(result.current.categoriesMap[category.name]).toEqual(category)
    })
  })

  describe('isSingle parameter', () => {
    it('should use plural labels by default', () => {
      const { result } = renderHook(() => useCategories())

      expect(result.current.categoriesMap.tool.label).toBe('plugin.category.tools')
      expect(result.current.categoriesMap['agent-strategy'].label).toBe('plugin.category.agents')
    })

    it('should use singular labels when isSingle is true', () => {
      const { result } = renderHook(() => useCategories(true))

      expect(result.current.categoriesMap.tool.label).toBe('plugin.categorySingle.tool')
      expect(result.current.categoriesMap['agent-strategy'].label).toBe('plugin.categorySingle.agent')
    })
  })

  it('should return same structure on re-render', () => {
    const { result, rerender } = renderHook(() => useCategories())

    const firstCategoryNames = result.current.categories.map(c => c.name)
    rerender()
    expect(result.current.categories.map(c => c.name)).toEqual(firstCategoryNames)
  })
})

describe('usePluginPageTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return two tabs: plugins first, marketplace second', () => {
    const { result } = renderHook(() => usePluginPageTabs())

    expect(result.current).toHaveLength(2)
    expect(result.current[0]).toEqual({ value: 'plugins', text: 'common.menus.plugins' })
    expect(result.current[1]).toEqual({ value: 'discover', text: 'common.menus.exploreMarketplace' })
  })

  it('should have consistent structure across re-renders', () => {
    const { result, rerender } = renderHook(() => usePluginPageTabs())

    const firstTabs = [...result.current]
    rerender()
    expect(result.current).toEqual(firstTabs)
  })
})

describe('PLUGIN_PAGE_TABS_MAP', () => {
  it('should have correct key-value mappings', () => {
    expect(PLUGIN_PAGE_TABS_MAP.plugins).toBe('plugins')
    expect(PLUGIN_PAGE_TABS_MAP.marketplace).toBe('discover')
  })
})
