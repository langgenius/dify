/**
 * Webhook Trigger Node Default Tests
 *
 * Tests for webhook trigger node default configuration and field validation.
 * Tests core checkValid functionality following project patterns.
 */

import nodeDefault from '../default'
import type { WebhookTriggerNodeType } from '../types'

// Simple mock translation function
const mockT = (key: string, params?: any) => {
  const translations: Record<string, string> = {
    'workflow.nodes.triggerWebhook.validation.webhookUrlRequired': 'Webhook URL is required',
    'workflow.nodes.triggerWebhook.validation.invalidParameterType': `Invalid parameter type ${params?.type} for ${params?.name}`,
  }

  if (key.includes('fieldRequired')) return `${params?.field} is required`
  return translations[key] || key
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
      expect(Array.isArray(defaultValue.variables)).toBe(true)

      // Initial arrays should be empty
      expect(defaultValue.headers).toHaveLength(0)
      expect(defaultValue.params).toHaveLength(0)
      expect(defaultValue.body).toHaveLength(0)
      expect(defaultValue.variables).toHaveLength(1)

      const rawVariable = defaultValue.variables?.[0]
      expect(rawVariable?.variable).toBe('_webhook_raw')
      expect(rawVariable?.label).toBe('raw')
      expect(rawVariable?.value_type).toBe('object')
    })

    it('should have correct metadata for trigger node', () => {
      expect(nodeDefault.metaData).toBeDefined()
      expect(nodeDefault.metaData.type).toBe('trigger-webhook')
      expect(nodeDefault.metaData.sort).toBe(3)
      expect(nodeDefault.metaData.isStart).toBe(true)
    })
  })

  describe('Validation - checkValid', () => {
    it('should require webhook_url to be configured', () => {
      const payload = nodeDefault.defaultValue as WebhookTriggerNodeType

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('required')
    })

    it('should validate successfully when webhook_url is provided', () => {
      const payload = {
        ...nodeDefault.defaultValue,
        webhook_url: 'https://example.com/webhook',
      } as WebhookTriggerNodeType

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })

    it('should handle response configuration fields when webhook_url is provided', () => {
      const payload = {
        ...nodeDefault.defaultValue,
        webhook_url: 'https://example.com/webhook',
        status_code: 404,
        response_body: '{"error": "Not found"}',
      } as WebhookTriggerNodeType

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
    })

    it('should handle async_mode field correctly when webhook_url is provided', () => {
      const payload = {
        ...nodeDefault.defaultValue,
        webhook_url: 'https://example.com/webhook',
        async_mode: false,
      } as WebhookTriggerNodeType

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
    })
  })
})
