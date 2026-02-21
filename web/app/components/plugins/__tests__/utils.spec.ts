import type { TagKey } from '../constants'
import { describe, expect, it } from 'vitest'
import { PluginCategoryEnum } from '../types'
import { getValidCategoryKeys, getValidTagKeys } from '../utils'

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
})
