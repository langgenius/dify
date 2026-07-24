import type { ScheduleTriggerNodeType } from '../types'
import { BlockEnum } from '../../../types'
import { isValidCronExpression, parseCronExpression } from './cron-parser'
import { getNextExecutionTime, getNextExecutionTimes } from './execution-time-calculator'

// Comprehensive integration tests for cron-parser and execution-time-calculator compatibility
describe('cron-parser + execution-time-calculator integration', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  const createCronData = (overrides: Partial<ScheduleTriggerNodeType> = {}): ScheduleTriggerNodeType => ({
    type: BlockEnum.TriggerSchedule,
    title: 'test-schedule',
    mode: 'cron',
    frequency: 'daily',
    timezone: 'UTC',
    ...overrides,
  } as ScheduleTriggerNodeType)

  describe('backward compatibility validation', () => {
    it('maintains exact behavior for legacy cron expressions', () => {
      const legacyExpressions = [
        '15 10 1 * *', // Monthly 1st at 10:15
        '0 0 * * 0', // Weekly Sunday midnight
        '*/5 * * * *', // Every 5 minutes
        '0 9-17 * * 1-5', // Business hours weekdays
        '30 14 * * 1', // Monday 14:30
        '0 0 1,15 * *', // 1st and 15th midnight
      ]

      legacyExpressions.forEach((expression) => {
        // Test direct cron-parser usage
        const directResult = parseCronExpression(expression, 'UTC')
        expect(directResult).toHaveLength(5)
        expect(isValidCronExpression(expression)).toBe(true)

        // Test through execution-time-calculator
        const data = createCronData({ cron_expression: expression })
        const calculatorResult = getNextExecutionTimes(data, 5)

        expect(calculatorResult).toHaveLength(5)

        // Results should be identical
        directResult.forEach((directDate, index) => {
          const calcDate = calculatorResult[index]
          expect(calcDate.getTime()).toBe(directDate.getTime())
          expect(calcDate.getHours()).toBe(directDate.getHours())
          expect(calcDate.getMinutes()).toBe(directDate.getMinutes())
        })
      })
    })

    it('validates timezone handling consistency', () => {
      const timezones = ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/London']
      const expression = '0 12 * * *' // Daily noon

      timezones.forEach((timezone) => {
        // Direct cron-parser call
        const directResult = parseCronExpression(expression, timezone)

        // Through execution-time-calculator
        const data = createCronData({ cron_expression: expression, timezone })
        const calculatorResult = getNextExecutionTimes(data, 5)

        expect(directResult).toHaveLength(5)
        expect(calculatorResult).toHaveLength(5)

        // All results should show noon (12:00) in their respective timezone
        directResult.forEach(date => expect(date.getHours()).toBe(12))
        calculatorResult.forEach(date => expect(date.getHours()).toBe(12))

        // Cross-validation: results should be identical
        directResult.forEach((directDate, index) => {
          expect(calculatorResult[index].getTime()).toBe(directDate.getTime())
        })
      })
    })

    it('error handling consistency', () => {
      const invalidExpressions = [
        '', // Empty string
        '   ', // Whitespace only
        '60 10 1 * *', // Invalid minute
        '15 25 1 * *', // Invalid hour
        '15 10 32 * *', // Invalid day
        '15 10 1 13 *', // Invalid month
        '15 10 1', // Too few fields
        '15 10 1 * * *', // Too many fields
        'invalid expression', // Completely invalid
      ]

      invalidExpressions.forEach((expression) => {
        // Direct cron-parser calls
        expect(isValidCronExpression(expression)).toBe(false)
        expect(parseCronExpression(expression, 'UTC')).toEqual([])

        // Through execution-time-calculator
        const data = createCronData({ cron_expression: expression })
        const result = getNextExecutionTimes(data, 5)
        expect(result).toEqual([])

        // getNextExecutionTime should return '--' for invalid cron
        const timeString = getNextExecutionTime(data)
        expect(timeString).toBe('--')
      })
    })
  })

  describe('enhanced features integration', () => {
    it('month and day abbreviations work end-to-end', () => {
      const enhancedExpressions = [
        { expr: '0 9 1 JAN *', month: 0, day: 1, hour: 9 }, // January 1st 9 AM
        { expr: '0 15 * * MON', weekday: 1, hour: 15 }, // Monday 3 PM
        { expr: '30 10 15 JUN,DEC *', month: [5, 11], day: 15, hour: 10, minute: 30 }, // Jun/Dec 15th
        { expr: '0 12 * JAN-MAR *', month: [0, 1, 2], hour: 12 }, // Q1 noon
      ]

      enhancedExpressions.forEach(({ expr, month, day, weekday, hour, minute = 0 }) => {
        // Validate through both paths
        expect(isValidCronExpression(expr)).toBe(true)

        const directResult = parseCronExpression(expr, 'UTC')
        const data = createCronData({ cron_expression: expr })
        const calculatorResult = getNextExecutionTimes(data, 3)

        expect(directResult.length).toBeGreaterThan(0)
        expect(calculatorResult.length).toBeGreaterThan(0)

        // Validate expected properties
        const validateDate = (date: Date) => {
          expect(date.getHours()).toBe(hour)
          expect(date.getMinutes()).toBe(minute)

          if (month !== undefined) {
            if (Array.isArray(month))
              expect(month).toContain(date.getMonth())
            else
              expect(date.getMonth()).toBe(month)
          }

          if (day !== undefined)
            expect(date.getDate()).toBe(day)

          if (weekday !== undefined)
            expect(date.getDay()).toBe(weekday)
        }

        directResult.forEach(validateDate)
        calculatorResult.forEach(validateDate)
      })
    })

    it('predefined expressions work through execution-time-calculator', () => {
      const predefExpressions = [
        { expr: '@daily', hour: 0, minute: 0 },
        { expr: '@weekly', hour: 0, minute: 0, weekday: 0 }, // Sunday
        { expr: '@monthly', hour: 0, minute: 0, day: 1 }, // 1st of month
        { expr: '@yearly', hour: 0, minute: 0, month: 0, day: 1 }, // Jan 1st
      ]

      predefExpressions.forEach(({ expr, hour, minute, weekday, day, month }) => {
        expect(isValidCronExpression(expr)).toBe(true)

        const data = createCronData({ cron_expression: expr })
        const result = getNextExecutionTimes(data, 3)

        expect(result.length).toBeGreaterThan(0)

        result.forEach((date) => {
          expect(date.getHours()).toBe(hour)
          expect(date.getMinutes()).toBe(minute)

          if (weekday !== undefined)
            expect(date.getDay()).toBe(weekday)
          if (day !== undefined)
            expect(date.getDate()).toBe(day)
          if (month !== undefined)
            expect(date.getMonth()).toBe(month)
        })
      })
    })

    it('special characters integration', () => {
      const specialExpressions = [
        '0 9 ? * 1', // ? wildcard for day
        '0 12 * * 7', // Sunday as 7
        '0 15 L * *', // Last day of month
      ]

      specialExpressions.forEach((expr) => {
        // Should validate and parse successfully
        expect(isValidCronExpression(expr)).toBe(true)

        const directResult = parseCronExpression(expr, 'UTC')
        const data = createCronData({ cron_expression: expr })
        const calculatorResult = getNextExecutionTimes(data, 2)

        expect(directResult.length).toBeGreaterThan(0)
        expect(calculatorResult.length).toBeGreaterThan(0)

        // Results should be consistent
        expect(calculatorResult[0].getHours()).toBe(directResult[0].getHours())
        expect(calculatorResult[0].getMinutes()).toBe(directResult[0].getMinutes())
      })
    })
  })

  describe('DST and timezone edge cases', () => {
    it('handles DST transitions consistently', () => {
      // Test around DST spring forward (March 2024)
      vi.setSystemTime(new Date('2024-03-08T10:00:00Z'))

      const expression = '0 2 * * *' // 2 AM daily (problematic during DST)
      const timezone = 'America/New_York'

      const directResult = parseCronExpression(expression, timezone)
      const data = createCronData({ cron_expression: expression, timezone })
      const calculatorResult = getNextExecutionTimes(data, 5)

      expect(directResult.length).toBeGreaterThan(0)
      expect(calculatorResult.length).toBeGreaterThan(0)

      // Both should handle DST gracefully
      // During DST spring forward, 2 AM becomes 3 AM - this is correct behavior
      directResult.forEach(date => expect([2, 3]).toContain(date.getHours()))
      calculatorResult.forEach(date => expect([2, 3]).toContain(date.getHours()))

      // Results should be identical
      directResult.forEach((directDate, index) => {
        expect(calculatorResult[index].getTime()).toBe(directDate.getTime())
      })
    })

    it('complex timezone scenarios', () => {
      const scenarios = [
        { tz: 'Asia/Kolkata', expr: '30 14 * * *', expectedHour: 14, expectedMinute: 30 }, // UTC+5:30
        { tz: 'Australia/Adelaide', expr: '0 8 * * *', expectedHour: 8, expectedMinute: 0 }, // UTC+9:30/+10:30
        { tz: 'Pacific/Kiritimati', expr: '0 12 * * *', expectedHour: 12, expectedMinute: 0 }, // UTC+14
      ]

      scenarios.forEach(({ tz, expr, expectedHour, expectedMinute }) => {
        const directResult = parseCronExpression(expr, tz)
        const data = createCronData({ cron_expression: expr, timezone: tz })
        const calculatorResult = getNextExecutionTimes(data, 2)

        expect(directResult.length).toBeGreaterThan(0)
        expect(calculatorResult.length).toBeGreaterThan(0)

        // Validate expected time
        directResult.forEach((date) => {
          expect(date.getHours()).toBe(expectedHour)
          expect(date.getMinutes()).toBe(expectedMinute)
        })

        calculatorResult.forEach((date) => {
          expect(date.getHours()).toBe(expectedHour)
          expect(date.getMinutes()).toBe(expectedMinute)
        })

        // Cross-validate consistency
        expect(calculatorResult[0].getTime()).toBe(directResult[0].getTime())
      })
    })
  })

  describe('performance and reliability', () => {
    it('handles high-frequency expressions efficiently', () => {
      const highFreqExpressions = [
        '*/1 * * * *', // Every minute
        '*/5 * * * *', // Every 5 minutes
        '0,15,30,45 * * * *', // Every 15 minutes
      ]

      highFreqExpressions.forEach((expr) => {
        const start = performance.now()

        // Test both direct and through calculator
        const directResult = parseCronExpression(expr, 'UTC')
        const data = createCronData({ cron_expression: expr })
        const calculatorResult = getNextExecutionTimes(data, 5)

        const end = performance.now()

        expect(directResult).toHaveLength(5)
        expect(calculatorResult).toHaveLength(5)
        expect(end - start).toBeLessThan(100) // Should be fast

        // Results should be consistent
        directResult.forEach((directDate, index) => {
          expect(calculatorResult[index].getTime()).toBe(directDate.getTime())
        })
      })
    })

    it('stress test with complex expressions', () => {
      const complexExpressions = [
        '15,45 8-18 1,15 JAN-MAR MON-FRI', // Business hours, specific days, Q1, weekdays
        '0 */2 ? * SUN#1,SUN#3', // First and third Sunday, every 2 hours
        '30 9 L * *', // Last day of month, 9:30 AM
      ]

      complexExpressions.forEach((expr) => {
        if (isValidCronExpression(expr)) {
          const directResult = parseCronExpression(expr, 'America/New_York')
          const data = createCronData({
            cron_expression: expr,
            timezone: 'America/New_York',
          })
          const calculatorResult = getNextExecutionTimes(data, 3)

          expect(directResult.length).toBeGreaterThan(0)
          expect(calculatorResult.length).toBeGreaterThan(0)

          // Validate consistency where results exist
          const minLength = Math.min(directResult.length, calculatorResult.length)
          for (let i = 0; i < minLength; i++)
            expect(calculatorResult[i].getTime()).toBe(directResult[i].getTime())
        }
      })
    })
  })

  describe('format compatibility', () => {
    it('getNextExecutionTime formatting consistency', () => {
      const testCases = [
        { expr: '0 9 * * *', timezone: 'UTC' },
        { expr: '30 14 * * 1-5', timezone: 'America/New_York' },
        { expr: '@daily', timezone: 'Asia/Tokyo' },
      ]

      testCases.forEach(({ expr, timezone }) => {
        const data = createCronData({ cron_expression: expr, timezone })
        const timeString = getNextExecutionTime(data)

        // Should return a formatted time string, not '--'
        expect(timeString).not.toBe('--')
        expect(typeof timeString).toBe('string')
        expect(timeString.length).toBeGreaterThan(0)

        // Should contain expected format elements
        expect(timeString).toMatch(/\d+:\d+/) // Time format
        expect(timeString).toMatch(/AM|PM/) // 12-hour format
        expect(timeString).toMatch(/\d{4}/) // Year
      })
    })
  })
})
