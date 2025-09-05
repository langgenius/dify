/**
 * Schedule Trigger Node Default Tests
 *
 * Simple test for the Schedule Trigger node default configuration and validation.
 * Tests core checkValid functionality following project patterns.
 */

import nodeDefault from '../default'
import type { ScheduleTriggerNodeType } from '../types'

// Mock external dependencies
jest.mock('../utils/cron-parser', () => ({
  isValidCronExpression: jest.fn((expr: string) => {
    return expr === '0 9 * * 1' // Only this specific expression is valid
  }),
}))

jest.mock('../utils/execution-time-calculator', () => ({
  getNextExecutionTimes: jest.fn(() => [new Date(Date.now() + 86400000)]),
}))

// Simple mock translation function
const mockT = (key: string, params?: any) => {
  if (key.includes('fieldRequired')) return `${params?.field} is required`
  if (key.includes('invalidCronExpression')) return 'Invalid cron expression'
  if (key.includes('invalidTimezone')) return 'Invalid timezone'
  return key
}

describe('Schedule Trigger Node Default', () => {
  describe('Basic Configuration', () => {
    it('should have correct default value', () => {
      expect(nodeDefault.defaultValue.mode).toBe('visual')
      expect(nodeDefault.defaultValue.frequency).toBe('weekly')
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
    it('should validate successfully with valid visual config', () => {
      const payload: ScheduleTriggerNodeType = {
        mode: 'visual',
        timezone: 'UTC',
        frequency: 'daily',
        visual_config: {
          time: '9:00 AM',
        },
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })

    it('should require mode field', () => {
      const payload = {
        timezone: 'UTC',
      } as ScheduleTriggerNodeType

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('required')
    })

    it('should require timezone field', () => {
      const payload = {
        mode: 'visual',
      } as ScheduleTriggerNodeType

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('required')
    })

    it('should validate cron mode with valid expression', () => {
      const payload: ScheduleTriggerNodeType = {
        mode: 'cron',
        timezone: 'UTC',
        cron_expression: '0 9 * * 1',
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
    })

    it('should reject invalid cron expression', () => {
      const payload: ScheduleTriggerNodeType = {
        mode: 'cron',
        timezone: 'UTC',
        cron_expression: 'invalid',
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('Invalid cron expression')
    })

    it('should reject invalid timezone', () => {
      const payload = {
        mode: 'visual',
        timezone: 'Invalid/Timezone',
        frequency: 'daily',
        visual_config: { time: '9:00 AM' },
      } as ScheduleTriggerNodeType

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('Invalid timezone')
    })

    it('should require frequency in visual mode', () => {
      const payload = {
        mode: 'visual',
        timezone: 'UTC',
      } as ScheduleTriggerNodeType

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('required')
    })
  })
})
