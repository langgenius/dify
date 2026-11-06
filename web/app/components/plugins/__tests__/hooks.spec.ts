import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useCategories, usePluginPageTabs, useTags } from '../hooks'

describe('useTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return non-empty tags array with name and label properties', () => {
    const { result } = renderHook(() => useTags())

    expect(result.current.tags.length).toBeGreaterThan(0)
    result.current.tags.forEach((tag) => {
      expect(result.current.tagsMap[tag.name]).toEqual(tag)
      expect(tag.label).toBe(`pluginTags.tags.${tag.name}`)
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
  })
})

describe('useCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isSingle parameter', () => {
    it('should use plural labels by default', () => {
      const { result } = renderHook(() => useCategories())

      expect(result.current.categoriesMap.tool!.label).toBe('plugin.category.tools')
      expect(result.current.categoriesMap['agent-strategy']!.label).toBe('plugin.category.agents')
    })

    it('should use singular labels when isSingle is true', () => {
      const { result } = renderHook(() => useCategories(true))

      expect(result.current.categoriesMap.tool!.label).toBe('plugin.categorySingle.tool')
      expect(result.current.categoriesMap['agent-strategy']!.label).toBe(
        'plugin.categorySingle.agent',
      )
    })
  })
})

describe('usePluginPageTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return two tabs: plugins first, marketplace second', () => {
    const { result } = renderHook(() => usePluginPageTabs())

    expect(result.current).toHaveLength(2)
    expect(result.current[0]).toEqual({ value: 'plugins', text: 'navigation.menus.plugins' })
    expect(result.current[1]).toEqual({
      value: 'discover',
      text: 'navigation.menus.exploreMarketplace',
    })
  })
})
