import { isValidCronExpression, parseCronExpression } from './cron-parser'

describe('cron-parser', () => {
  describe('isValidCronExpression', () => {
    test('validates correct cron expressions', () => {
      expect(isValidCronExpression('15 10 1 * *')).toBe(true)
      expect(isValidCronExpression('0 0 * * 0')).toBe(true)
      expect(isValidCronExpression('*/5 * * * *')).toBe(true)
      expect(isValidCronExpression('0 9-17 * * 1-5')).toBe(true)
      expect(isValidCronExpression('30 14 * * 1')).toBe(true)
      expect(isValidCronExpression('0 0 1,15 * *')).toBe(true)
    })

    test('rejects invalid cron expressions', () => {
      expect(isValidCronExpression('')).toBe(false)
      expect(isValidCronExpression('15 10 1')).toBe(false) // Not enough fields
      expect(isValidCronExpression('15 10 1 * * *')).toBe(false) // Too many fields
      expect(isValidCronExpression('60 10 1 * *')).toBe(false) // Invalid minute
      expect(isValidCronExpression('15 25 1 * *')).toBe(false) // Invalid hour
      expect(isValidCronExpression('15 10 32 * *')).toBe(false) // Invalid day
      expect(isValidCronExpression('15 10 1 13 *')).toBe(false) // Invalid month
      expect(isValidCronExpression('15 10 1 * 7')).toBe(false) // Invalid day of week
    })

    test('handles edge cases', () => {
      expect(isValidCronExpression('  15 10 1 * *  ')).toBe(true) // Whitespace
      expect(isValidCronExpression('0 0 29 2 *')).toBe(true) // Feb 29 (valid in leap years)
      expect(isValidCronExpression('59 23 31 12 6')).toBe(true) // Max values
    })
  })

  describe('parseCronExpression', () => {
    beforeEach(() => {
      // Mock current time to make tests deterministic
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2024-01-15T10:00:00Z'))
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    test('parses monthly expressions correctly', () => {
      const result = parseCronExpression('15 10 1 * *') // 1st day of every month at 10:15

      expect(result).toHaveLength(5)
      expect(result[0].getDate()).toBe(1) // February 1st
      expect(result[0].getHours()).toBe(10)
      expect(result[0].getMinutes()).toBe(15)
      expect(result[1].getDate()).toBe(1) // March 1st
      expect(result[2].getDate()).toBe(1) // April 1st
    })

    test('parses weekly expressions correctly', () => {
      const result = parseCronExpression('30 14 * * 1') // Every Monday at 14:30

      expect(result).toHaveLength(5)
      // Should find next 5 Mondays
      result.forEach((date) => {
        expect(date.getDay()).toBe(1) // Monday
        expect(date.getHours()).toBe(14)
        expect(date.getMinutes()).toBe(30)
      })
    })

    test('parses daily expressions correctly', () => {
      const result = parseCronExpression('0 9 * * *') // Every day at 9:00

      expect(result).toHaveLength(5)
      result.forEach((date) => {
        expect(date.getHours()).toBe(9)
        expect(date.getMinutes()).toBe(0)
      })

      // Should be consecutive days (starting from tomorrow since current time is 10:00)
      for (let i = 1; i < result.length; i++) {
        const prevDate = new Date(result[i - 1])
        const currDate = new Date(result[i])
        const dayDiff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
        expect(dayDiff).toBe(1)
      }
    })

    test('handles complex cron expressions with ranges', () => {
      const result = parseCronExpression('0 9-17 * * 1-5') // Weekdays, 9-17 hours

      expect(result).toHaveLength(5)
      result.forEach((date) => {
        expect(date.getDay()).toBeGreaterThanOrEqual(1) // Monday
        expect(date.getDay()).toBeLessThanOrEqual(5) // Friday
        expect(date.getHours()).toBeGreaterThanOrEqual(9)
        expect(date.getHours()).toBeLessThanOrEqual(17)
        expect(date.getMinutes()).toBe(0)
      })
    })

    test('handles step expressions', () => {
      const result = parseCronExpression('*/15 * * * *') // Every 15 minutes

      expect(result).toHaveLength(5)
      result.forEach((date) => {
        expect(date.getMinutes() % 15).toBe(0)
      })
    })

    test('handles list expressions', () => {
      const result = parseCronExpression('0 0 1,15 * *') // 1st and 15th of each month

      expect(result).toHaveLength(5)
      result.forEach((date) => {
        expect([1, 15]).toContain(date.getDate())
        expect(date.getHours()).toBe(0)
        expect(date.getMinutes()).toBe(0)
      })
    })

    test('handles expressions that span multiple months', () => {
      // Test with an expression that might not have many matches in current month
      const result = parseCronExpression('0 12 29 * *') // 29th of each month at noon

      expect(result.length).toBeGreaterThan(0)
      expect(result.length).toBeLessThanOrEqual(5)
      result.forEach((date) => {
        expect(date.getDate()).toBe(29)
        expect(date.getHours()).toBe(12)
        expect(date.getMinutes()).toBe(0)
      })
    })

    test('returns empty array for invalid expressions', () => {
      expect(parseCronExpression('')).toEqual([])
      expect(parseCronExpression('invalid')).toEqual([])
      expect(parseCronExpression('60 10 1 * *')).toEqual([])
      expect(parseCronExpression('15 25 1 * *')).toEqual([])
    })

    test('handles edge case: February 29th in non-leap years', () => {
      // Set to a non-leap year
      jest.setSystemTime(new Date('2023-01-15T10:00:00Z'))

      const result = parseCronExpression('0 12 29 2 *') // Feb 29th at noon

      // Should return empty or skip 2023 and find 2024
      if (result.length > 0) {
        result.forEach((date) => {
          expect(date.getMonth()).toBe(1) // February
          expect(date.getDate()).toBe(29)
          // Should be in a leap year
          const year = date.getFullYear()
          expect(year % 4).toBe(0)
        })
      }
    })

    test('sorts results chronologically', () => {
      const result = parseCronExpression('0 */6 * * *') // Every 6 hours

      expect(result).toHaveLength(5)
      for (let i = 1; i < result.length; i++)
        expect(result[i].getTime()).toBeGreaterThan(result[i - 1].getTime())
    })

    test('excludes past times', () => {
      // Set current time to 15:30
      jest.setSystemTime(new Date('2024-01-15T15:30:00Z'))

      const result = parseCronExpression('0 10 * * *') // Daily at 10:00

      expect(result).toHaveLength(5)
      result.forEach((date) => {
        expect(date.getTime()).toBeGreaterThan(Date.now())
      })

      // First result should be tomorrow since today's 10:00 has passed
      expect(result[0].getDate()).toBe(16)
    })

    test('handles midnight expressions correctly', () => {
      const result = parseCronExpression('0 0 * * *') // Daily at midnight

      expect(result).toHaveLength(5)
      result.forEach((date) => {
        expect(date.getHours()).toBe(0)
        expect(date.getMinutes()).toBe(0)
      })
    })

    test('handles year boundary correctly', () => {
      // Set to end of December
      jest.setSystemTime(new Date('2024-12-30T10:00:00Z'))

      const result = parseCronExpression('0 12 1 * *') // 1st of every month at noon

      expect(result).toHaveLength(5)
      // Should include January 1st of next year
      const nextYear = result.find(date => date.getFullYear() === 2025)
      expect(nextYear).toBeDefined()
      if (nextYear) {
        expect(nextYear.getMonth()).toBe(0) // January
        expect(nextYear.getDate()).toBe(1)
      }
    })
  })

  describe('performance tests', () => {
    test('performs well for complex expressions', () => {
      const start = performance.now()

      // Test multiple complex expressions
      const expressions = [
        '*/5 9-17 * * 1-5', // Every 5 minutes, weekdays, business hours
        '0 */2 1,15 * *', // Every 2 hours on 1st and 15th
        '30 14 * * 1,3,5', // Mon, Wed, Fri at 14:30
        '15,45 8-18 * * 1-5', // 15 and 45 minutes past the hour, weekdays
      ]

      expressions.forEach((expr) => {
        const result = parseCronExpression(expr)
        expect(result).toHaveLength(5)
      })

      // Test quarterly expression separately (may return fewer than 5 results)
      const quarterlyResult = parseCronExpression('0 0 1 */3 *') // First day of every 3rd month
      expect(quarterlyResult.length).toBeGreaterThan(0)
      expect(quarterlyResult.length).toBeLessThanOrEqual(5)

      const end = performance.now()

      // Should complete within reasonable time (less than 100ms for all expressions)
      expect(end - start).toBeLessThan(100)
    })
  })
})
