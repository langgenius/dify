/**
 * Integration Test: Plugin Data Utilities
 *
 * Tests the integration between plugin utility functions, including
 * tag/category validation, form schema transformation, and
 * credential data processing. Verifies that these utilities work
 * correctly together in processing plugin metadata.
 */
import { describe, expect, it } from 'vitest'

import { transformFormSchemasSecretInput } from '@/app/components/plugins/plugin-auth/utils'
import { getValidCategoryKeys, getValidTagKeys } from '@/app/components/plugins/utils'

type TagInput = Parameters<typeof getValidTagKeys>[0]

describe('Plugin Data Utilities Integration', () => {
  describe('Tag and Category Validation Pipeline', () => {
    it('validates tags and categories in a metadata processing flow', () => {
      const pluginMetadata = {
        tags: ['search', 'productivity', 'invalid-tag', 'media-generate'],
        category: 'tool',
      }

      const validTags = getValidTagKeys(pluginMetadata.tags as TagInput)
      expect(validTags.length).toBeGreaterThan(0)
      expect(validTags.length).toBeLessThanOrEqual(pluginMetadata.tags.length)

      const validCategory = getValidCategoryKeys(pluginMetadata.category)
      expect(validCategory).toBeDefined()
    })

    it('handles completely invalid metadata gracefully', () => {
      const invalidMetadata = {
        tags: ['nonexistent-1', 'nonexistent-2'],
        category: 'nonexistent-category',
      }

      const validTags = getValidTagKeys(invalidMetadata.tags as TagInput)
      expect(validTags).toHaveLength(0)

      const validCategory = getValidCategoryKeys(invalidMetadata.category)
      expect(validCategory).toBeUndefined()
    })

    it('handles undefined and empty inputs', () => {
      expect(getValidTagKeys([] as TagInput)).toHaveLength(0)
      expect(getValidCategoryKeys(undefined)).toBeUndefined()
      expect(getValidCategoryKeys('')).toBeUndefined()
    })
  })

  describe('Credential Secret Masking Pipeline', () => {
    it('masks secrets when displaying credential form data', () => {
      const credentialValues = {
        api_key: 'sk-abc123456789',
        api_endpoint: 'https://api.example.com',
        secret_token: 'secret-token-value',
        description: 'My credential set',
      }

      const secretFields = ['api_key', 'secret_token']

      const displayValues = transformFormSchemasSecretInput(secretFields, credentialValues)

      expect(displayValues.api_key).toBe('[__HIDDEN__]')
      expect(displayValues.secret_token).toBe('[__HIDDEN__]')
      expect(displayValues.api_endpoint).toBe('https://api.example.com')
      expect(displayValues.description).toBe('My credential set')
    })

    it('preserves original values when no secret fields', () => {
      const values = {
        name: 'test',
        endpoint: 'https://api.example.com',
      }

      const result = transformFormSchemasSecretInput([], values)
      expect(result).toEqual(values)
    })

    it('handles falsy secret values without masking', () => {
      const values = {
        api_key: '',
        secret: null as unknown as string,
        other: 'visible',
      }

      const result = transformFormSchemasSecretInput(['api_key', 'secret'], values)
      expect(result.api_key).toBe('')
      expect(result.secret).toBeNull()
      expect(result.other).toBe('visible')
    })

    it('does not mutate the original values object', () => {
      const original = {
        api_key: 'my-secret-key',
        name: 'test',
      }
      const originalCopy = { ...original }

      transformFormSchemasSecretInput(['api_key'], original)

      expect(original).toEqual(originalCopy)
    })
  })

  describe('Combined Plugin Metadata Validation', () => {
    it('processes a complete plugin entry with tags and credentials', () => {
      const pluginEntry = {
        name: 'test-plugin',
        category: 'tool',
        tags: ['search', 'invalid-tag'],
        credentials: {
          api_key: 'sk-test-key-123',
          base_url: 'https://api.test.com',
        },
        secretFields: ['api_key'],
      }

      const validCategory = getValidCategoryKeys(pluginEntry.category)
      expect(validCategory).toBe('tool')

      const validTags = getValidTagKeys(pluginEntry.tags as TagInput)
      expect(validTags).toContain('search')

      const displayCredentials = transformFormSchemasSecretInput(
        pluginEntry.secretFields,
        pluginEntry.credentials,
      )
      expect(displayCredentials.api_key).toBe('[__HIDDEN__]')
      expect(displayCredentials.base_url).toBe('https://api.test.com')

      expect(pluginEntry.credentials.api_key).toBe('sk-test-key-123')
    })

    it('handles multiple plugins in batch processing', () => {
      const plugins = [
        { tags: ['search', 'productivity'], category: 'tool' },
        { tags: ['image', 'design'], category: 'model' },
        { tags: ['invalid'], category: 'extension' },
      ]

      const results = plugins.map(p => ({
        validTags: getValidTagKeys(p.tags as TagInput),
        validCategory: getValidCategoryKeys(p.category),
      }))

      expect(results[0].validTags.length).toBeGreaterThan(0)
      expect(results[0].validCategory).toBe('tool')

      expect(results[1].validTags).toContain('image')
      expect(results[1].validTags).toContain('design')
      expect(results[1].validCategory).toBe('model')

      expect(results[2].validTags).toHaveLength(0)
      expect(results[2].validCategory).toBe('extension')
    })
  })
})
