/**
 * Test suite for icon utility functions
 * Tests the generation of marketplace plugin icon URLs
 */
import { getIconFromMarketPlace } from './get-icon'
import { MARKETPLACE_API_PREFIX } from '@/config'

describe('get-icon', () => {
  describe('getIconFromMarketPlace', () => {
    /**
     * Tests basic URL generation for marketplace plugin icons
     */
    test('returns correct marketplace icon URL', () => {
      const pluginId = 'test-plugin-123'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toBe(`${MARKETPLACE_API_PREFIX}/plugins/${pluginId}/icon`)
    })

    /**
     * Tests URL generation with plugin IDs containing special characters
     * like dashes and underscores
     */
    test('handles plugin ID with special characters', () => {
      const pluginId = 'plugin-with-dashes_and_underscores'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toBe(`${MARKETPLACE_API_PREFIX}/plugins/${pluginId}/icon`)
    })

    /**
     * Tests behavior with empty plugin ID
     * Note: This creates a malformed URL but doesn't throw an error
     */
    test('handles empty plugin ID', () => {
      const pluginId = ''
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toBe(`${MARKETPLACE_API_PREFIX}/plugins//icon`)
    })

    /**
     * Tests URL generation with plugin IDs containing spaces
     * Spaces will be URL-encoded when actually used
     */
    test('handles plugin ID with spaces', () => {
      const pluginId = 'plugin with spaces'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toBe(`${MARKETPLACE_API_PREFIX}/plugins/${pluginId}/icon`)
    })
  })
})
