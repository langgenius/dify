/**
 * Plugin Trigger Default Configuration Tests
 *
 * Tests the default configuration, node relationships, and validation logic.
 */

import nodeDefault from '../default'
import type { PluginTriggerNodeType } from '../types'

const mockT = (key: string, params?: any) => {
  if (key.includes('fieldRequired')) return `${params?.field} is required`
  return key
}

describe('Plugin Trigger Default Configuration', () => {
  describe('Default Configuration', () => {
    it('should have minimal default value', () => {
      const defaultValue = nodeDefault.defaultValue
      expect(defaultValue).toHaveProperty('config')
      expect(defaultValue.config).toEqual({})
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

  describe('Validation Logic', () => {
    it('should validate required provider selection', () => {
      const payload: PluginTriggerNodeType = {
        provider_name: '',
        tool_name: '',
        config: {},
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('plugin is required')
    })

    it('should pass validation with basic plugin info', () => {
      const payload: PluginTriggerNodeType = {
        provider_name: 'GitHub',
        tool_name: 'webhook_trigger',
        config: {},
        paramSchemas: [],
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })

    it('should validate required parameters', () => {
      const payload: PluginTriggerNodeType = {
        provider_name: 'GitHub',
        tool_name: 'webhook_trigger',
        paramSchemas: [
          {
            name: 'secret',
            label: { en_US: 'Secret Token' },
            type: 'string',
            required: true,
            form: 'llm',
            human_description: { en_US: 'Secret token' },
            llm_description: 'Secret token',
            default: '',
          },
        ],
        config: {},
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('secret is required')
    })

    it('should pass with complete configuration', () => {
      const payload: PluginTriggerNodeType = {
        provider_name: 'GitHub',
        tool_name: 'webhook_trigger',
        paramSchemas: [
          {
            name: 'secret',
            label: { en_US: 'Secret Token' },
            type: 'string',
            required: true,
            form: 'llm',
            human_description: { en_US: 'Secret token' },
            llm_description: 'Secret token',
            default: '',
          },
        ],
        config: {
          secret: 'my-secret-token',
        },
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })

    it('should only validate required parameters', () => {
      const payload: PluginTriggerNodeType = {
        provider_name: 'GitHub',
        tool_name: 'webhook_trigger',
        paramSchemas: [
          {
            name: 'secret',
            label: { en_US: 'Secret Token' },
            type: 'string',
            required: true,
            form: 'llm',
            human_description: { en_US: 'Secret token' },
            llm_description: 'Secret token',
            default: '',
          },
          {
            name: 'events',
            label: { en_US: 'Events' },
            type: 'array',
            required: false,
            form: 'llm',
            human_description: { en_US: 'Event types' },
            llm_description: 'Event types',
            default: '',
          },
        ],
        config: {
          secret: 'token',
        },
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })
  })
})
