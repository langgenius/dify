/**
 * Webhook Trigger Node Default Tests
 *
 * Tests for webhook trigger node default configuration and field validation.
 * Tests core checkValid functionality following project patterns.
 */

import nodeDefault from '../default'

// Simple mock translation function
const mockT = (key: string, params?: any) => {
  if (key.includes('fieldRequired')) return `${params?.field} is required`
  return key
}

describe('Webhook Trigger Node Default', () => {
  describe('Basic Configuration', () => {
    it('should have correct default values for all backend fields', () => {
      const defaultValue = nodeDefault.defaultValue

      // Core webhook configuration
      expect(defaultValue.webhook_url).toBe('')
      expect(defaultValue.method).toBe('POST')
      expect(defaultValue.content_type).toBe('application/json')

      // Response configuration fields
      expect(defaultValue.async_mode).toBe(true)
      expect(defaultValue.status_code).toBe(200)
      expect(defaultValue.response_body).toBe('')

      // Parameter arrays
      expect(Array.isArray(defaultValue.headers)).toBe(true)
      expect(Array.isArray(defaultValue.params)).toBe(true)
      expect(Array.isArray(defaultValue.body)).toBe(true)
      expect(Array.isArray(defaultValue.default_value)).toBe(true)

      // Initial arrays should be empty
      expect(defaultValue.headers).toHaveLength(0)
      expect(defaultValue.params).toHaveLength(0)
      expect(defaultValue.body).toHaveLength(0)
      expect(defaultValue.default_value).toHaveLength(0)
    })

    it('should have empty prev nodes', () => {
      const prevNodes = nodeDefault.getAvailablePrevNodes(false)
      expect(prevNodes).toEqual([])
    })

    it('should have available next nodes excluding Start', () => {
      const nextNodes = nodeDefault.getAvailableNextNodes(false)
      expect(nextNodes).toBeDefined()
      expect(nextNodes.length).toBeGreaterThan(0)
    })
  })

  describe('Validation - checkValid', () => {
    it('should validate successfully with default configuration', () => {
      const payload = nodeDefault.defaultValue

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })

    it('should handle response configuration fields', () => {
      const payload = {
        ...nodeDefault.defaultValue,
        status_code: 404,
        response_body: '{"error": "Not found"}',
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
    })

    it('should handle async_mode field correctly', () => {
      const payload = {
        ...nodeDefault.defaultValue,
        async_mode: false,
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
    })
  })
})
