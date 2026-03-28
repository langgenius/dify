import { MARKETPLACE_API_PREFIX } from '@/config'
/**
 * Test suite for icon utility functions
 * Tests the generation of marketplace plugin icon URLs
 */
import { getIconFromMarketPlace } from './get-icon'

describe('get-icon', () => {
  describe('getIconFromMarketPlace', () => {
    /**
     * Tests basic URL generation for marketplace plugin icons
     */
    it('returns correct marketplace icon URL', () => {
      const pluginId = 'test-plugin-123'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toBe(`${MARKETPLACE_API_PREFIX}/plugins/${pluginId}/icon`)
    })

    /**
     * Tests URL generation with plugin IDs containing special characters
     * like dashes and underscores
     */
    it('handles plugin ID with special characters', () => {
      const pluginId = 'plugin-with-dashes_and_underscores'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toBe(`${MARKETPLACE_API_PREFIX}/plugins/${pluginId}/icon`)
    })

    /**
     * Tests behavior with empty plugin ID
     * Note: This creates a malformed URL but doesn't throw an error
     */
    it('handles empty plugin ID', () => {
      const pluginId = ''
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toBe(`${MARKETPLACE_API_PREFIX}/plugins//icon`)
    })

    /**
     * Tests URL generation with plugin IDs containing spaces
     * Spaces will be URL-encoded when actually used
     */
    it('handles plugin ID with spaces', () => {
      const pluginId = 'plugin with spaces'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toBe(`${MARKETPLACE_API_PREFIX}/plugins/${pluginId}/icon`)
    })

    /**
     * Security tests: Path traversal attempts
     * These tests document current behavior and potential security concerns
     * Note: Current implementation does not sanitize path traversal sequences
     */
    it('handles path traversal attempts', () => {
      const pluginId = '../../../etc/passwd'
      const result = getIconFromMarketPlace(pluginId)
      // Current implementation includes path traversal sequences in URL
      // This is a potential security concern that should be addressed
      expect(result).toContain('../')
      expect(result).toContain(pluginId)
    })

    it('handles multiple path traversal attempts', () => {
      const pluginId = '../../../../etc/passwd'
      const result = getIconFromMarketPlace(pluginId)
      // Current implementation includes path traversal sequences in URL
      expect(result).toContain('../')
      expect(result).toContain(pluginId)
    })

    it('passes through URL-encoded path traversal sequences', () => {
      const pluginId = '..%2F..%2Fetc%2Fpasswd'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toContain(pluginId)
    })

    /**
     * Security tests: Null and undefined handling
     * These tests document current behavior with invalid input types
     * Note: Current implementation converts null/undefined to strings instead of throwing
     */
    it('handles null plugin ID', () => {
      // Current implementation converts null to string "null"
      const result = getIconFromMarketPlace(null as any)
      expect(result).toContain('null')
      // This is a potential issue - should validate input type
    })

    it('handles undefined plugin ID', () => {
      // Current implementation converts undefined to string "undefined"
      const result = getIconFromMarketPlace(undefined as any)
      expect(result).toContain('undefined')
      // This is a potential issue - should validate input type
    })

    /**
     * Security tests: URL-sensitive characters
     * These tests verify that URL-sensitive characters are handled appropriately
     */
    it('does not encode URL-sensitive characters', () => {
      const pluginId = 'plugin/with?special=chars#hash'
      const result = getIconFromMarketPlace(pluginId)
      // Note: Current implementation doesn't encode, but test documents the behavior
      expect(result).toContain(pluginId)
      expect(result).toContain('?')
      expect(result).toContain('#')
      expect(result).toContain('=')
    })

    it('handles URL characters like & and %', () => {
      const pluginId = 'plugin&with%encoding'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toContain(pluginId)
    })

    /**
     * Edge case tests: Extreme inputs
     * These tests verify behavior with unusual but valid inputs
     */
    it('handles very long plugin ID', () => {
      const pluginId = 'a'.repeat(10000)
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toContain(pluginId)
      expect(result.length).toBeGreaterThan(10000)
    })

    it('handles Unicode characters', () => {
      const pluginId = '插件-🚀-测试-日本語'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toContain(pluginId)
    })

    it('handles control characters', () => {
      const pluginId = 'plugin\nwith\ttabs\r\nand\0null'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toContain(pluginId)
    })

    /**
     * Security tests: XSS attempts
     * These tests verify that XSS attempts are handled appropriately
     */
    it('handles XSS attempts with script tags', () => {
      const pluginId = '<script>alert("xss")</script>'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toContain(pluginId)
      // Note: Current implementation doesn't sanitize, but test documents the behavior
    })

    it('handles XSS attempts with event handlers', () => {
      const pluginId = 'plugin"onerror="alert(1)"'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toContain(pluginId)
    })

    it('handles XSS attempts with encoded script tags', () => {
      const pluginId = '%3Cscript%3Ealert%28%22xss%22%29%3C%2Fscript%3E'
      const result = getIconFromMarketPlace(pluginId)
      expect(result).toContain(pluginId)
    })
  })
})
