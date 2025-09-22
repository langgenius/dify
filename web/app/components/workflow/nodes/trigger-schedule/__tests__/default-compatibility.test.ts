import nodeDefault from '../default'
import type { ScheduleTriggerNodeType } from '../types'

// Mock translation function
const mockT = (key: string, params?: any) => {
  if (key.includes('fieldRequired')) return `${params?.field} is required`
  if (key.includes('invalidCronExpression')) return 'Invalid cron expression'
  if (key.includes('invalidTimezone')) return 'Invalid timezone'
  if (key.includes('noValidExecutionTime')) return 'No valid execution time'
  if (key.includes('executionTimeCalculationError')) return 'Execution time calculation error'
  return key
}

describe('Schedule Trigger Default - Backward Compatibility', () => {
  describe('Enhanced Cron Expression Support', () => {
    it('should accept enhanced month abbreviations', () => {
      const payload: ScheduleTriggerNodeType = {
        mode: 'cron',
        timezone: 'UTC',
        cron_expression: '0 9 1 JAN *', // January 1st at 9 AM
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })

    it('should accept enhanced day abbreviations', () => {
      const payload: ScheduleTriggerNodeType = {
        mode: 'cron',
        timezone: 'UTC',
        cron_expression: '0 15 * * MON', // Every Monday at 3 PM
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })

    it('should accept predefined expressions', () => {
      const predefinedExpressions = ['@daily', '@weekly', '@monthly', '@yearly', '@hourly']

      predefinedExpressions.forEach((expr) => {
        const payload: ScheduleTriggerNodeType = {
          mode: 'cron',
          timezone: 'UTC',
          cron_expression: expr,
        }

        const result = nodeDefault.checkValid(payload, mockT)
        expect(result.isValid).toBe(true)
        expect(result.errorMessage).toBe('')
      })
    })

    it('should accept special characters', () => {
      const specialExpressions = [
        '0 9 ? * 1', // ? wildcard
        '0 12 * * 7', // Sunday as 7
        '0 15 L * *', // Last day of month
      ]

      specialExpressions.forEach((expr) => {
        const payload: ScheduleTriggerNodeType = {
          mode: 'cron',
          timezone: 'UTC',
          cron_expression: expr,
        }

        const result = nodeDefault.checkValid(payload, mockT)
        expect(result.isValid).toBe(true)
        expect(result.errorMessage).toBe('')
      })
    })

    it('should maintain backward compatibility with legacy expressions', () => {
      const legacyExpressions = [
        '15 10 1 * *', // Monthly 1st at 10:15
        '0 0 * * 0', // Weekly Sunday midnight
        '*/5 * * * *', // Every 5 minutes
        '0 9-17 * * 1-5', // Business hours weekdays
        '30 14 * * 1', // Monday 14:30
        '0 0 1,15 * *', // 1st and 15th midnight
      ]

      legacyExpressions.forEach((expr) => {
        const payload: ScheduleTriggerNodeType = {
          mode: 'cron',
          timezone: 'UTC',
          cron_expression: expr,
        }

        const result = nodeDefault.checkValid(payload, mockT)
        expect(result.isValid).toBe(true)
        expect(result.errorMessage).toBe('')
      })
    })
  })

  describe('Error Detection and Validation', () => {
    it('should detect invalid enhanced syntax', () => {
      const invalidExpressions = [
        '0 12 * JANUARY *', // Full month name not supported
        '0 12 * * MONDAY', // Full day name not supported
        '0 12 32 JAN *', // Invalid day with month abbreviation
        '@invalid', // Invalid predefined expression
        '0 12 1 INVALID *', // Invalid month abbreviation
        '0 12 * * INVALID', // Invalid day abbreviation
      ]

      invalidExpressions.forEach((expr) => {
        const payload: ScheduleTriggerNodeType = {
          mode: 'cron',
          timezone: 'UTC',
          cron_expression: expr,
        }

        const result = nodeDefault.checkValid(payload, mockT)
        expect(result.isValid).toBe(false)
        expect(result.errorMessage).toContain('Invalid cron expression')
      })
    })

    it('should handle execution time calculation errors gracefully', () => {
      // Test with an expression that contains invalid date (Feb 30th)
      const payload: ScheduleTriggerNodeType = {
        mode: 'cron',
        timezone: 'UTC',
        cron_expression: '0 0 30 2 *', // Feb 30th (invalid date)
      }

      const result = nodeDefault.checkValid(payload, mockT)
      // Should be an invalid expression error since cron-parser detects Feb 30th as invalid
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Invalid cron expression')
    })
  })

  describe('Timezone Integration', () => {
    it('should validate with various timezones', () => {
      const timezones = ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/London']

      timezones.forEach((timezone) => {
        const payload: ScheduleTriggerNodeType = {
          mode: 'cron',
          timezone,
          cron_expression: '0 12 * * *', // Daily noon
        }

        const result = nodeDefault.checkValid(payload, mockT)
        expect(result.isValid).toBe(true)
        expect(result.errorMessage).toBe('')
      })
    })

    it('should reject invalid timezones', () => {
      const payload: ScheduleTriggerNodeType = {
        mode: 'cron',
        timezone: 'Invalid/Timezone',
        cron_expression: '0 12 * * *',
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('Invalid timezone')
    })
  })

  describe('Visual Mode Compatibility', () => {
    it('should maintain visual mode validation', () => {
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

    it('should validate weekly configuration', () => {
      const payload: ScheduleTriggerNodeType = {
        mode: 'visual',
        timezone: 'UTC',
        frequency: 'weekly',
        visual_config: {
          time: '2:30 PM',
          weekdays: ['mon', 'wed', 'fri'],
        },
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })

    it('should validate monthly configuration', () => {
      const payload: ScheduleTriggerNodeType = {
        mode: 'visual',
        timezone: 'UTC',
        frequency: 'monthly',
        visual_config: {
          time: '11:30 AM',
          monthly_days: [1, 15, 'last'],
        },
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })
  })

  describe('Edge Cases and Robustness', () => {
    it('should handle empty/whitespace cron expressions', () => {
      const emptyExpressions = ['', '   ', '\t\n  ']

      emptyExpressions.forEach((expr) => {
        const payload: ScheduleTriggerNodeType = {
          mode: 'cron',
          timezone: 'UTC',
          cron_expression: expr,
        }

        const result = nodeDefault.checkValid(payload, mockT)
        expect(result.isValid).toBe(false)
        expect(result.errorMessage).toMatch(/(Invalid cron expression|required)/)
      })
    })

    it('should validate whitespace-padded expressions', () => {
      const payload: ScheduleTriggerNodeType = {
        mode: 'cron',
        timezone: 'UTC',
        cron_expression: '  0 12 * * *  ', // Padded with whitespace
      }

      const result = nodeDefault.checkValid(payload, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })
  })
})
