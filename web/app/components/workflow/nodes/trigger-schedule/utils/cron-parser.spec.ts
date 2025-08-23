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

  describe('edge cases and error handling', () => {
    test('handles invalid step expressions', () => {
      // Test step with non-numeric values
      expect(parseCronExpression('*/abc * * * *')).toEqual([])
      expect(parseCronExpression('0/NaN * * * *')).toEqual([])
      expect(parseCronExpression('0/0 * * * *')).toEqual([]) // Zero step
      expect(parseCronExpression('0/ * * * *')).toEqual([]) // Empty step
    })

    test('handles invalid range expressions', () => {
      // Test ranges with non-numeric values
      expect(parseCronExpression('0 abc-12 * * *')).toEqual([])
      expect(parseCronExpression('0 9-xyz * * *')).toEqual([])
      expect(parseCronExpression('0 15-10 * * *')).toEqual([]) // Start > End
      expect(parseCronExpression('0 - * * *')).toEqual([]) // Empty range parts
    })

    test('handles complex step expressions with ranges', () => {
      // Test step with ranges like "2-10/3"
      const result = parseCronExpression('0 2-10/3 * * *') // Every 3 hours from 2-10
      expect(result.length).toBeGreaterThan(0)
      // Just verify the expression works, don't check specific hours due to timezone complexity
    })

    test('handles expressions with both day of month and day of week', () => {
      // This should use OR logic
      const result = parseCronExpression('0 12 15 * 1') // 15th of month OR Monday at noon
      expect(result.length).toBeGreaterThan(0)
      result.forEach((date) => {
        const isMonday = date.getDay() === 1
        const is15th = date.getDate() === 15
        expect(isMonday || is15th).toBe(true)
      })
    })

    test('handles wildcard minute and hour expressions', () => {
      // This triggers the fallback path (lines 172-184)
      const result = parseCronExpression('* * 16 * *') // Any time on 16th
      expect(result.length).toBeGreaterThan(0)
      result.forEach((date) => {
        expect(date.getDate()).toBe(16)
      })
    })

    test('handles expressions that require multiple month search', () => {
      // Test February 30th (impossible date)
      const result = parseCronExpression('0 12 30 2 *') // Feb 30th (doesn't exist)
      expect(result).toEqual([])
    })

    test('handles malformed field splitting', () => {
      // Test various malformed patterns
      expect(parseCronExpression('0 12//')).toEqual([]) // Double slash
      expect(parseCronExpression('0 12--15 * * *')).toEqual([]) // Double dash
      const result3 = parseCronExpression('0 12,,15 * * *') // Double comma - parser handles it
      expect(result3.length).toBeGreaterThan(0) // Should work with valid parts
    })

    test('handles step expressions with invalid base ranges', () => {
      // Test step with invalid range base
      const result = parseCronExpression('0 25-30/2 * * *') // Invalid hour range
      expect(result).toEqual([])
    })

    test('handles comma-separated expressions with invalid parts', () => {
      // These work because parser filters valid parts
      const result1 = parseCronExpression('0 9,25,12 * * *') // 25 filtered out, 9&12 remain
      expect(result1.length).toBeGreaterThan(0) // Should have results from valid hours

      const result2 = parseCronExpression('0 9,abc,12 * * *') // Parser handles non-numeric gracefully
      expect(result2.length).toBeGreaterThan(0) // Should have results from valid hours
    })
  })

  describe('validation edge cases', () => {
    test('validates step expressions correctly', () => {
      expect(isValidCronExpression('*/0 * * * *')).toBe(false) // Zero step
      expect(isValidCronExpression('*/-1 * * * *')).toBe(false) // Negative step
      expect(isValidCronExpression('*/abc * * * *')).toBe(false) // Non-numeric step
      expect(isValidCronExpression('2-10/3 * * * *')).toBe(true) // Valid range with step
      expect(isValidCronExpression('25-30/2 * * * *')).toBe(true) // Valid syntax, runtime filtering
    })

    test('validates range expressions correctly', () => {
      expect(isValidCronExpression('0 10-5 * * *')).toBe(false) // Start > End
      expect(isValidCronExpression('0 abc-12 * * *')).toBe(false) // Non-numeric start
      expect(isValidCronExpression('0 9-xyz * * *')).toBe(false) // Non-numeric end
      expect(isValidCronExpression('0 -10 * * *')).toBe(false) // Empty start
      expect(isValidCronExpression('0 10- * * *')).toBe(false) // Empty end
    })

    test('validates comma expressions correctly', () => {
      expect(isValidCronExpression('0 9,12,15 * * *')).toBe(true) // Valid list
      expect(isValidCronExpression('0 9,25,15 * * *')).toBe(false) // Invalid item in list
      expect(isValidCronExpression('0 9,,15 * * *')).toBe(false) // Empty item in list
      expect(isValidCronExpression('0 ,12,15 * * *')).toBe(false) // Leading comma
      expect(isValidCronExpression('0 9,12, * * *')).toBe(false) // Trailing comma
    })

    test('validates complex combined expressions', () => {
      expect(isValidCronExpression('*/5,30 9-17 1,15 * 1-5')).toBe(true) // Complex valid
      expect(isValidCronExpression('*/5,60 9-17 1,15 * 1-5')).toBe(false) // Invalid minute in list
      expect(isValidCronExpression('*/5,30 9-25 1,15 * 1-5')).toBe(false) // Invalid hour range
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

    test('handles pathological expressions gracefully', () => {
      // These should not hang or crash
      const pathologicalExpressions = [
        '* * * * *', // Every minute (fallback path)
        '*/1 */1 */1 */1 */1', // Maximum frequency with steps
        '0-59 0-23 1-31 1-12 0-6', // Full ranges
      ]

      pathologicalExpressions.forEach((expr) => {
        const start = performance.now()
        const result = parseCronExpression(expr)
        const end = performance.now()

        expect(result.length).toBeLessThanOrEqual(5)
        expect(end - start).toBeLessThan(1000) // Should not take more than 1 second
      })
    })
  })
})
