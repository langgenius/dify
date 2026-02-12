import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_PAGE_TABS_MAP, useCategories, usePluginPageTabs, useTags } from '../hooks'

describe('useTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should return tags array', () => {
      const { result } = renderHook(() => useTags())

      expect(result.current.tags).toBeDefined()
      expect(Array.isArray(result.current.tags)).toBe(true)
      expect(result.current.tags.length).toBeGreaterThan(0)
    })

    it('should return tags with translated labels', () => {
      const { result } = renderHook(() => useTags())

      result.current.tags.forEach((tag) => {
        expect(tag.label).toBe(`pluginTags.tags.${tag.name}`)
      })
    })

    it('should return tags with name and label properties', () => {
      const { result } = renderHook(() => useTags())

      result.current.tags.forEach((tag) => {
        expect(tag).toHaveProperty('name')
        expect(tag).toHaveProperty('label')
        expect(typeof tag.name).toBe('string')
        expect(typeof tag.label).toBe('string')
      })
    })

    it('should return tagsMap object', () => {
      const { result } = renderHook(() => useTags())

      expect(result.current.tagsMap).toBeDefined()
      expect(typeof result.current.tagsMap).toBe('object')
    })
  })

  describe('tagsMap', () => {
    it('should map tag name to tag object', () => {
      const { result } = renderHook(() => useTags())

      expect(result.current.tagsMap.agent).toBeDefined()
      expect(result.current.tagsMap.agent.name).toBe('agent')
      expect(result.current.tagsMap.agent.label).toBe('pluginTags.tags.agent')
    })

    it('should contain all tags from tags array', () => {
      const { result } = renderHook(() => useTags())

      result.current.tags.forEach((tag) => {
        expect(result.current.tagsMap[tag.name]).toBeDefined()
        expect(result.current.tagsMap[tag.name]).toEqual(tag)
      })
    })
  })

  describe('getTagLabel', () => {
    it('should return label for existing tag', () => {
      const { result } = renderHook(() => useTags())

      expect(result.current.getTagLabel('agent')).toBe('pluginTags.tags.agent')
      expect(result.current.getTagLabel('search')).toBe('pluginTags.tags.search')
    })

    it('should return name for non-existing tag', () => {
      const { result } = renderHook(() => useTags())

      // Test non-existing tags - this covers the branch where !tagsMap[name]
      expect(result.current.getTagLabel('non-existing')).toBe('non-existing')
      expect(result.current.getTagLabel('custom-tag')).toBe('custom-tag')
    })

    it('should cover both branches of getTagLabel conditional', () => {
      const { result } = renderHook(() => useTags())

      const existingTagResult = result.current.getTagLabel('rag')
      expect(existingTagResult).toBe('pluginTags.tags.rag')

      const nonExistingTagResult = result.current.getTagLabel('unknown-tag-xyz')
      expect(nonExistingTagResult).toBe('unknown-tag-xyz')
    })

    it('should be a function', () => {
      const { result } = renderHook(() => useTags())

      expect(typeof result.current.getTagLabel).toBe('function')
    })

    it('should return correct labels for all predefined tags', () => {
      const { result } = renderHook(() => useTags())

      expect(result.current.getTagLabel('rag')).toBe('pluginTags.tags.rag')
      expect(result.current.getTagLabel('image')).toBe('pluginTags.tags.image')
      expect(result.current.getTagLabel('videos')).toBe('pluginTags.tags.videos')
      expect(result.current.getTagLabel('weather')).toBe('pluginTags.tags.weather')
      expect(result.current.getTagLabel('finance')).toBe('pluginTags.tags.finance')
      expect(result.current.getTagLabel('design')).toBe('pluginTags.tags.design')
      expect(result.current.getTagLabel('travel')).toBe('pluginTags.tags.travel')
      expect(result.current.getTagLabel('social')).toBe('pluginTags.tags.social')
      expect(result.current.getTagLabel('news')).toBe('pluginTags.tags.news')
      expect(result.current.getTagLabel('medical')).toBe('pluginTags.tags.medical')
      expect(result.current.getTagLabel('productivity')).toBe('pluginTags.tags.productivity')
      expect(result.current.getTagLabel('education')).toBe('pluginTags.tags.education')
      expect(result.current.getTagLabel('business')).toBe('pluginTags.tags.business')
      expect(result.current.getTagLabel('entertainment')).toBe('pluginTags.tags.entertainment')
      expect(result.current.getTagLabel('utilities')).toBe('pluginTags.tags.utilities')
      expect(result.current.getTagLabel('other')).toBe('pluginTags.tags.other')
    })

    it('should handle empty string tag name', () => {
      const { result } = renderHook(() => useTags())

      // Empty string tag doesn't exist, so should return the empty string
      expect(result.current.getTagLabel('')).toBe('')
    })

    it('should handle special characters in tag name', () => {
      const { result } = renderHook(() => useTags())

      expect(result.current.getTagLabel('tag-with-dashes')).toBe('tag-with-dashes')
      expect(result.current.getTagLabel('tag_with_underscores')).toBe('tag_with_underscores')
    })
  })

  describe('Memoization', () => {
    it('should return same structure on re-render', () => {
      const { result, rerender } = renderHook(() => useTags())

      const firstTagsLength = result.current.tags.length
      const firstTagNames = result.current.tags.map(t => t.name)

      rerender()

      // Structure should remain consistent
      expect(result.current.tags.length).toBe(firstTagsLength)
      expect(result.current.tags.map(t => t.name)).toEqual(firstTagNames)
    })
  })
})

describe('useCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should return categories array', () => {
      const { result } = renderHook(() => useCategories())

      expect(result.current.categories).toBeDefined()
      expect(Array.isArray(result.current.categories)).toBe(true)
      expect(result.current.categories.length).toBeGreaterThan(0)
    })

    it('should return categories with name and label properties', () => {
      const { result } = renderHook(() => useCategories())

      result.current.categories.forEach((category) => {
        expect(category).toHaveProperty('name')
        expect(category).toHaveProperty('label')
        expect(typeof category.name).toBe('string')
        expect(typeof category.label).toBe('string')
      })
    })

    it('should return categoriesMap object', () => {
      const { result } = renderHook(() => useCategories())

      expect(result.current.categoriesMap).toBeDefined()
      expect(typeof result.current.categoriesMap).toBe('object')
    })
  })

  describe('categoriesMap', () => {
    it('should map category name to category object', () => {
      const { result } = renderHook(() => useCategories())

      expect(result.current.categoriesMap.tool).toBeDefined()
      expect(result.current.categoriesMap.tool.name).toBe('tool')
    })

    it('should contain all categories from categories array', () => {
      const { result } = renderHook(() => useCategories())

      result.current.categories.forEach((category) => {
        expect(result.current.categoriesMap[category.name]).toBeDefined()
        expect(result.current.categoriesMap[category.name]).toEqual(category)
      })
    })
  })

  describe('isSingle parameter', () => {
    it('should use plural labels when isSingle is false', () => {
      const { result } = renderHook(() => useCategories(false))

      expect(result.current.categoriesMap.tool.label).toBe('plugin.category.tools')
    })

    it('should use plural labels when isSingle is undefined', () => {
      const { result } = renderHook(() => useCategories())

      expect(result.current.categoriesMap.tool.label).toBe('plugin.category.tools')
    })

    it('should use singular labels when isSingle is true', () => {
      const { result } = renderHook(() => useCategories(true))

      expect(result.current.categoriesMap.tool.label).toBe('plugin.categorySingle.tool')
    })

    it('should handle agent category specially', () => {
      const { result: resultPlural } = renderHook(() => useCategories(false))
      const { result: resultSingle } = renderHook(() => useCategories(true))

      expect(resultPlural.current.categoriesMap['agent-strategy'].label).toBe('plugin.category.agents')
      expect(resultSingle.current.categoriesMap['agent-strategy'].label).toBe('plugin.categorySingle.agent')
    })
  })

  describe('Memoization', () => {
    it('should return same structure on re-render', () => {
      const { result, rerender } = renderHook(() => useCategories())

      const firstCategoriesLength = result.current.categories.length
      const firstCategoryNames = result.current.categories.map(c => c.name)

      rerender()

      // Structure should remain consistent
      expect(result.current.categories.length).toBe(firstCategoriesLength)
      expect(result.current.categories.map(c => c.name)).toEqual(firstCategoryNames)
    })
  })
})

describe('usePluginPageTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should return tabs array', () => {
      const { result } = renderHook(() => usePluginPageTabs())

      expect(result.current).toBeDefined()
      expect(Array.isArray(result.current)).toBe(true)
    })

    it('should return two tabs', () => {
      const { result } = renderHook(() => usePluginPageTabs())

      expect(result.current.length).toBe(2)
    })

    it('should return tabs with value and text properties', () => {
      const { result } = renderHook(() => usePluginPageTabs())

      result.current.forEach((tab) => {
        expect(tab).toHaveProperty('value')
        expect(tab).toHaveProperty('text')
        expect(typeof tab.value).toBe('string')
        expect(typeof tab.text).toBe('string')
      })
    })

    it('should return tabs with translated texts', () => {
      const { result } = renderHook(() => usePluginPageTabs())

      expect(result.current[0].text).toBe('common.menus.plugins')
      expect(result.current[1].text).toBe('common.menus.exploreMarketplace')
    })
  })

  describe('Tab Values', () => {
    it('should have plugins tab with correct value', () => {
      const { result } = renderHook(() => usePluginPageTabs())

      const pluginsTab = result.current.find(tab => tab.value === PLUGIN_PAGE_TABS_MAP.plugins)
      expect(pluginsTab).toBeDefined()
      expect(pluginsTab?.value).toBe('plugins')
      expect(pluginsTab?.text).toBe('common.menus.plugins')
    })

    it('should have marketplace tab with correct value', () => {
      const { result } = renderHook(() => usePluginPageTabs())

      const marketplaceTab = result.current.find(tab => tab.value === PLUGIN_PAGE_TABS_MAP.marketplace)
      expect(marketplaceTab).toBeDefined()
      expect(marketplaceTab?.value).toBe('discover')
      expect(marketplaceTab?.text).toBe('common.menus.exploreMarketplace')
    })
  })

  describe('Tab Order', () => {
    it('should return plugins tab as first tab', () => {
      const { result } = renderHook(() => usePluginPageTabs())

      expect(result.current[0].value).toBe('plugins')
      expect(result.current[0].text).toBe('common.menus.plugins')
    })

    it('should return marketplace tab as second tab', () => {
      const { result } = renderHook(() => usePluginPageTabs())

      expect(result.current[1].value).toBe('discover')
      expect(result.current[1].text).toBe('common.menus.exploreMarketplace')
    })
  })

  describe('Tab Structure', () => {
    it('should have consistent structure across re-renders', () => {
      const { result, rerender } = renderHook(() => usePluginPageTabs())

      const firstTabs = [...result.current]
      rerender()

      expect(result.current).toEqual(firstTabs)
    })

    it('should return new array reference on each call', () => {
      const { result, rerender } = renderHook(() => usePluginPageTabs())

      const firstTabs = result.current
      rerender()

      // Each call creates a new array (not memoized)
      expect(result.current).not.toBe(firstTabs)
    })
  })
})

describe('PLUGIN_PAGE_TABS_MAP', () => {
  it('should have plugins key with correct value', () => {
    expect(PLUGIN_PAGE_TABS_MAP.plugins).toBe('plugins')
  })

  it('should have marketplace key with correct value', () => {
    expect(PLUGIN_PAGE_TABS_MAP.marketplace).toBe('discover')
  })
})
