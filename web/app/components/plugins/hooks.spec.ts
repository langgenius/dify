import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_PAGE_TABS_MAP, useCategories, usePluginPageTabs, useTags } from './hooks'

// Create mock translation function
const mockT = vi.fn((key: string, _options?: Record<string, string>) => {
  const translations: Record<string, string> = {
    'tags.agent': 'Agent',
    'tags.rag': 'RAG',
    'tags.search': 'Search',
    'tags.image': 'Image',
    'tags.videos': 'Videos',
    'tags.weather': 'Weather',
    'tags.finance': 'Finance',
    'tags.design': 'Design',
    'tags.travel': 'Travel',
    'tags.social': 'Social',
    'tags.news': 'News',
    'tags.medical': 'Medical',
    'tags.productivity': 'Productivity',
    'tags.education': 'Education',
    'tags.business': 'Business',
    'tags.entertainment': 'Entertainment',
    'tags.utilities': 'Utilities',
    'tags.other': 'Other',
    'category.models': 'Models',
    'category.tools': 'Tools',
    'category.datasources': 'Datasources',
    'category.agents': 'Agents',
    'category.extensions': 'Extensions',
    'category.bundles': 'Bundles',
    'category.triggers': 'Triggers',
    'categorySingle.model': 'Model',
    'categorySingle.tool': 'Tool',
    'categorySingle.datasource': 'Datasource',
    'categorySingle.agent': 'Agent',
    'categorySingle.extension': 'Extension',
    'categorySingle.bundle': 'Bundle',
    'categorySingle.trigger': 'Trigger',
    'menus.plugins': 'Plugins',
    'menus.exploreMarketplace': 'Explore Marketplace',
  }
  return translations[key] || key
})

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

describe('useTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockT.mockClear()
  })

  describe('Rendering', () => {
    it('should return tags array', () => {
      const { result } = renderHook(() => useTags())

      expect(result.current.tags).toBeDefined()
      expect(Array.isArray(result.current.tags)).toBe(true)
      expect(result.current.tags.length).toBeGreaterThan(0)
    })

    it('should call translation function for each tag', () => {
      renderHook(() => useTags())

      // Verify t() was called for tag translations
      expect(mockT).toHaveBeenCalled()
      const tagCalls = mockT.mock.calls.filter(call => call[0].startsWith('tags.'))
      expect(tagCalls.length).toBeGreaterThan(0)
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
      expect(result.current.tagsMap.agent.label).toBe('Agent')
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

      // Test existing tags - this covers the branch where tagsMap[name] exists
      expect(result.current.getTagLabel('agent')).toBe('Agent')
      expect(result.current.getTagLabel('search')).toBe('Search')
    })

    it('should return name for non-existing tag', () => {
      const { result } = renderHook(() => useTags())

      // Test non-existing tags - this covers the branch where !tagsMap[name]
      expect(result.current.getTagLabel('non-existing')).toBe('non-existing')
      expect(result.current.getTagLabel('custom-tag')).toBe('custom-tag')
    })

    it('should cover both branches of getTagLabel conditional', () => {
      const { result } = renderHook(() => useTags())

      // Branch 1: tag exists in tagsMap - returns label
      const existingTagResult = result.current.getTagLabel('rag')
      expect(existingTagResult).toBe('RAG')

      // Branch 2: tag does not exist in tagsMap - returns name itself
      const nonExistingTagResult = result.current.getTagLabel('unknown-tag-xyz')
      expect(nonExistingTagResult).toBe('unknown-tag-xyz')
    })

    it('should be a function', () => {
      const { result } = renderHook(() => useTags())

      expect(typeof result.current.getTagLabel).toBe('function')
    })

    it('should return correct labels for all predefined tags', () => {
      const { result } = renderHook(() => useTags())

      // Test all predefined tags
      expect(result.current.getTagLabel('rag')).toBe('RAG')
      expect(result.current.getTagLabel('image')).toBe('Image')
      expect(result.current.getTagLabel('videos')).toBe('Videos')
      expect(result.current.getTagLabel('weather')).toBe('Weather')
      expect(result.current.getTagLabel('finance')).toBe('Finance')
      expect(result.current.getTagLabel('design')).toBe('Design')
      expect(result.current.getTagLabel('travel')).toBe('Travel')
      expect(result.current.getTagLabel('social')).toBe('Social')
      expect(result.current.getTagLabel('news')).toBe('News')
      expect(result.current.getTagLabel('medical')).toBe('Medical')
      expect(result.current.getTagLabel('productivity')).toBe('Productivity')
      expect(result.current.getTagLabel('education')).toBe('Education')
      expect(result.current.getTagLabel('business')).toBe('Business')
      expect(result.current.getTagLabel('entertainment')).toBe('Entertainment')
      expect(result.current.getTagLabel('utilities')).toBe('Utilities')
      expect(result.current.getTagLabel('other')).toBe('Other')
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

      expect(result.current.categoriesMap.tool.label).toBe('Tools')
    })

    it('should use plural labels when isSingle is undefined', () => {
      const { result } = renderHook(() => useCategories())

      expect(result.current.categoriesMap.tool.label).toBe('Tools')
    })

    it('should use singular labels when isSingle is true', () => {
      const { result } = renderHook(() => useCategories(true))

      expect(result.current.categoriesMap.tool.label).toBe('Tool')
    })

    it('should handle agent category specially', () => {
      const { result: resultPlural } = renderHook(() => useCategories(false))
      const { result: resultSingle } = renderHook(() => useCategories(true))

      expect(resultPlural.current.categoriesMap['agent-strategy'].label).toBe('Agents')
      expect(resultSingle.current.categoriesMap['agent-strategy'].label).toBe('Agent')
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
    mockT.mockClear()
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

    it('should call translation function for tab texts', () => {
      renderHook(() => usePluginPageTabs())

      // Verify t() was called for menu translations
      expect(mockT).toHaveBeenCalledWith('menus.plugins', { ns: 'common' })
      expect(mockT).toHaveBeenCalledWith('menus.exploreMarketplace', { ns: 'common' })
    })
  })

  describe('Tab Values', () => {
    it('should have plugins tab with correct value', () => {
      const { result } = renderHook(() => usePluginPageTabs())

      const pluginsTab = result.current.find(tab => tab.value === PLUGIN_PAGE_TABS_MAP.plugins)
      expect(pluginsTab).toBeDefined()
      expect(pluginsTab?.value).toBe('plugins')
      expect(pluginsTab?.text).toBe('Plugins')
    })

    it('should have marketplace tab with correct value', () => {
      const { result } = renderHook(() => usePluginPageTabs())

      const marketplaceTab = result.current.find(tab => tab.value === PLUGIN_PAGE_TABS_MAP.marketplace)
      expect(marketplaceTab).toBeDefined()
      expect(marketplaceTab?.value).toBe('discover')
      expect(marketplaceTab?.text).toBe('Explore Marketplace')
    })
  })

  describe('Tab Order', () => {
    it('should return plugins tab as first tab', () => {
      const { result } = renderHook(() => usePluginPageTabs())

      expect(result.current[0].value).toBe('plugins')
      expect(result.current[0].text).toBe('Plugins')
    })

    it('should return marketplace tab as second tab', () => {
      const { result } = renderHook(() => usePluginPageTabs())

      expect(result.current[1].value).toBe('discover')
      expect(result.current[1].text).toBe('Explore Marketplace')
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
