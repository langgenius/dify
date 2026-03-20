import type { TagKey } from '../constants'
import type { Plugin } from '../types'
import { describe, expect, it } from 'vitest'
import { API_PREFIX, MARKETPLACE_API_PREFIX } from '@/config'
import { PluginCategoryEnum } from '../types'
import { getPluginCardIconUrl, getValidCategoryKeys, getValidTagKeys } from '../utils'

const createPlugin = (overrides: Partial<Pick<Plugin, 'from' | 'name' | 'org' | 'type'>> = {}): Pick<Plugin, 'from' | 'name' | 'org' | 'type'> => ({
  from: 'github',
  name: 'demo-plugin',
  org: 'langgenius',
  type: 'plugin',
  ...overrides,
})

describe('plugins/utils', () => {
  describe('getValidTagKeys', () => {
    it('returns only valid tag keys from the predefined set', () => {
      const input = ['agent', 'rag', 'invalid-tag', 'search'] as TagKey[]
      const result = getValidTagKeys(input)
      expect(result).toEqual(['agent', 'rag', 'search'])
    })

    it('returns empty array when no valid tags', () => {
      const result = getValidTagKeys(['foo', 'bar'] as unknown as TagKey[])
      expect(result).toEqual([])
    })

    it('returns empty array for empty input', () => {
      expect(getValidTagKeys([])).toEqual([])
    })

    it('preserves all valid tags when all are valid', () => {
      const input: TagKey[] = ['agent', 'rag', 'search', 'image']
      const result = getValidTagKeys(input)
      expect(result).toEqual(input)
    })
  })

  describe('getValidCategoryKeys', () => {
    it('returns matching category for valid key', () => {
      expect(getValidCategoryKeys(PluginCategoryEnum.model)).toBe(PluginCategoryEnum.model)
      expect(getValidCategoryKeys(PluginCategoryEnum.tool)).toBe(PluginCategoryEnum.tool)
      expect(getValidCategoryKeys(PluginCategoryEnum.agent)).toBe(PluginCategoryEnum.agent)
      expect(getValidCategoryKeys('bundle')).toBe('bundle')
    })

    it('returns undefined for invalid category', () => {
      expect(getValidCategoryKeys('nonexistent')).toBeUndefined()
    })

    it('returns undefined for undefined input', () => {
      expect(getValidCategoryKeys(undefined)).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
      expect(getValidCategoryKeys('')).toBeUndefined()
    })
  })

  describe('getPluginCardIconUrl', () => {
    it('returns an empty string when icon is missing', () => {
      expect(getPluginCardIconUrl(createPlugin(), undefined, 'tenant-1')).toBe('')
    })

    it('returns absolute urls and root-relative urls as-is', () => {
      expect(getPluginCardIconUrl(createPlugin(), 'https://example.com/icon.png', 'tenant-1')).toBe('https://example.com/icon.png')
      expect(getPluginCardIconUrl(createPlugin(), '/icons/demo.png', 'tenant-1')).toBe('/icons/demo.png')
    })

    it('builds the marketplace icon url for plugins and bundles', () => {
      expect(getPluginCardIconUrl(createPlugin({ from: 'marketplace' }), 'icon.png', 'tenant-1'))
        .toBe(`${MARKETPLACE_API_PREFIX}/plugins/langgenius/demo-plugin/icon`)
      expect(getPluginCardIconUrl(createPlugin({ from: 'marketplace', type: 'bundle' }), 'icon.png', 'tenant-1'))
        .toBe(`${MARKETPLACE_API_PREFIX}/bundles/langgenius/demo-plugin/icon`)
    })

    it('falls back to the raw icon when tenant id is missing for non-marketplace plugins', () => {
      expect(getPluginCardIconUrl(createPlugin(), 'icon.png', '')).toBe('icon.png')
    })

    it('builds the workspace icon url for tenant-scoped plugins', () => {
      expect(getPluginCardIconUrl(createPlugin(), 'icon.png', 'tenant-1'))
        .toBe(`${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=tenant-1&filename=icon.png`)
    })
  })
})
