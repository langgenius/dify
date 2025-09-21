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

    test('validates enhanced dayOfWeek syntax', () => {
      expect(isValidCronExpression('0 9 * * 7')).toBe(true) // Sunday as 7
      expect(isValidCronExpression('0 9 * * SUN')).toBe(true) // Sunday abbreviation
      expect(isValidCronExpression('0 9 * * MON')).toBe(true) // Monday abbreviation
      expect(isValidCronExpression('0 9 * * MON-FRI')).toBe(true) // Range with abbreviations
      expect(isValidCronExpression('0 9 * * SUN,WED,FRI')).toBe(true) // List with abbreviations
    })

    test('validates enhanced month syntax', () => {
      expect(isValidCronExpression('0 9 1 JAN *')).toBe(true) // January abbreviation
      expect(isValidCronExpression('0 9 1 DEC *')).toBe(true) // December abbreviation
      expect(isValidCronExpression('0 9 1 JAN-MAR *')).toBe(true) // Range with abbreviations
      expect(isValidCronExpression('0 9 1 JAN,JUN,DEC *')).toBe(true) // List with abbreviations
    })

    test('validates special characters', () => {
      expect(isValidCronExpression('0 9 ? * 1')).toBe(true) // ? wildcard
      expect(isValidCronExpression('0 9 L * *')).toBe(true) // Last day of month
      expect(isValidCronExpression('0 9 * * 1#1')).toBe(true) // First Monday of month
      expect(isValidCronExpression('0 9 * * 1L')).toBe(true) // Last Monday of month
    })

    test('validates predefined expressions', () => {
      expect(isValidCronExpression('@yearly')).toBe(true)
      expect(isValidCronExpression('@monthly')).toBe(true)
      expect(isValidCronExpression('@weekly')).toBe(true)
      expect(isValidCronExpression('@daily')).toBe(true)
      expect(isValidCronExpression('@hourly')).toBe(true)
    })

    test('rejects invalid cron expressions', () => {
      expect(isValidCronExpression('')).toBe(false)
      expect(isValidCronExpression('15 10 1')).toBe(false) // Not enough fields
      expect(isValidCronExpression('15 10 1 * * *')).toBe(false) // Too many fields
      expect(isValidCronExpression('60 10 1 * *')).toBe(false) // Invalid minute
      expect(isValidCronExpression('15 25 1 * *')).toBe(false) // Invalid hour
      expect(isValidCronExpression('15 10 32 * *')).toBe(false) // Invalid day
      expect(isValidCronExpression('15 10 1 13 *')).toBe(false) // Invalid month
      expect(isValidCronExpression('15 10 1 * 8')).toBe(false) // Invalid day of week
      expect(isValidCronExpression('15 10 1 INVALID *')).toBe(false) // Invalid month abbreviation
      expect(isValidCronExpression('15 10 1 * INVALID')).toBe(false) // Invalid day abbreviation
      expect(isValidCronExpression('@invalid')).toBe(false) // Invalid predefined expression
    })

    test('handles edge cases', () => {
      expect(isValidCronExpression('  15 10 1 * *  ')).toBe(true) // Whitespace
      expect(isValidCronExpression('0 0 29 2 *')).toBe(true) // Feb 29 (valid in leap years)
      expect(isValidCronExpression('59 23 31 12 6')).toBe(true) // Max values
      expect(isValidCronExpression('0 0 29 FEB *')).toBe(true) // Feb 29 with month abbreviation
      expect(isValidCronExpression('59 23 31 DEC SAT')).toBe(true) // Max values with abbreviations
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
        // Since we're using UTC timezone in this test, the returned dates should
        // be in the future relative to the current time
        // Note: our implementation returns dates in "user timezone representation"
        // but for UTC, this should match the expected behavior
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

  describe('enhanced syntax tests', () => {
    test('handles month abbreviations correctly', () => {
      const result = parseCronExpression('0 12 1 JAN *') // First day of January at noon

      expect(result).toHaveLength(5)
      result.forEach((date) => {
        expect(date.getMonth()).toBe(0) // January
        expect(date.getDate()).toBe(1)
        expect(date.getHours()).toBe(12)
        expect(date.getMinutes()).toBe(0)
      })
    })

    test('handles day abbreviations correctly', () => {
      const result = parseCronExpression('0 14 * * MON') // Every Monday at 14:00

      expect(result).toHaveLength(5)
      result.forEach((date) => {
        expect(date.getDay()).toBe(1) // Monday
        expect(date.getHours()).toBe(14)
        expect(date.getMinutes()).toBe(0)
      })
    })

    test('handles Sunday as both 0 and 7', () => {
      const result0 = parseCronExpression('0 10 * * 0') // Sunday as 0
      const result7 = parseCronExpression('0 10 * * 7') // Sunday as 7
      const resultSUN = parseCronExpression('0 10 * * SUN') // Sunday as SUN

      expect(result0).toHaveLength(5)
      expect(result7).toHaveLength(5)
      expect(resultSUN).toHaveLength(5)

      // All should return Sundays
      result0.forEach(date => expect(date.getDay()).toBe(0))
      result7.forEach(date => expect(date.getDay()).toBe(0))
      resultSUN.forEach(date => expect(date.getDay()).toBe(0))
    })

    test('handles question mark wildcard', () => {
      const resultStar = parseCronExpression('0 9 * * 1') // Using *
      const resultQuestion = parseCronExpression('0 9 ? * 1') // Using ?

      expect(resultStar).toHaveLength(5)
      expect(resultQuestion).toHaveLength(5)

      // Both should return Mondays at 9:00
      resultStar.forEach((date) => {
        expect(date.getDay()).toBe(1)
        expect(date.getHours()).toBe(9)
      })
      resultQuestion.forEach((date) => {
        expect(date.getDay()).toBe(1)
        expect(date.getHours()).toBe(9)
      })
    })

    test('handles predefined expressions', () => {
      const daily = parseCronExpression('@daily')
      const weekly = parseCronExpression('@weekly')
      const monthly = parseCronExpression('@monthly')

      expect(daily).toHaveLength(5)
      expect(weekly).toHaveLength(5)
      expect(monthly).toHaveLength(5)

      // @daily should be at midnight
      daily.forEach((date) => {
        expect(date.getHours()).toBe(0)
        expect(date.getMinutes()).toBe(0)
      })

      // @weekly should be on Sundays at midnight
      weekly.forEach((date) => {
        expect(date.getDay()).toBe(0) // Sunday
        expect(date.getHours()).toBe(0)
        expect(date.getMinutes()).toBe(0)
      })

      // @monthly should be on the 1st of each month at midnight
      monthly.forEach((date) => {
        expect(date.getDate()).toBe(1)
        expect(date.getHours()).toBe(0)
        expect(date.getMinutes()).toBe(0)
      })
    })
  })

  describe('edge cases and error handling', () => {
    test('handles complex month/day combinations', () => {
      // Test Feb 29 with month abbreviation
      const result = parseCronExpression('0 12 29 FEB *')
      if (result.length > 0) {
        result.forEach((date) => {
          expect(date.getMonth()).toBe(1) // February
          expect(date.getDate()).toBe(29)
          // Should only occur in leap years
          const year = date.getFullYear()
          expect(year % 4).toBe(0)
        })
      }
    })

    test('handles mixed syntax correctly', () => {
      // Mix of numbers and abbreviations (using only dayOfMonth OR dayOfWeek, not both)
      // Test 1: Month abbreviations with specific day
      const result1 = parseCronExpression('30 14 15 JAN,JUN,DEC *')
      expect(result1.length).toBeGreaterThan(0)
      result1.forEach((date) => {
        expect(date.getDate()).toBe(15) // Should be 15th day
        expect([0, 5, 11]).toContain(date.getMonth()) // Jan, Jun, Dec
        expect(date.getHours()).toBe(14)
        expect(date.getMinutes()).toBe(30)
      })

      // Test 2: Month abbreviations with weekdays
      const result2 = parseCronExpression('0 9 * JAN-MAR MON-FRI')
      expect(result2.length).toBeGreaterThan(0)
      result2.forEach((date) => {
        // Should be weekday OR in Q1 months
        const isWeekday = date.getDay() >= 1 && date.getDay() <= 5
        const isQ1 = [0, 1, 2].includes(date.getMonth())
        expect(isWeekday || isQ1).toBe(true)
        expect(date.getHours()).toBe(9)
        expect(date.getMinutes()).toBe(0)
      })
    })

    test('handles timezone edge cases', () => {
      // Test with different timezones
      const utcResult = parseCronExpression('0 12 * * *', 'UTC')
      const nyResult = parseCronExpression('0 12 * * *', 'America/New_York')
      const tokyoResult = parseCronExpression('0 12 * * *', 'Asia/Tokyo')

      expect(utcResult).toHaveLength(5)
      expect(nyResult).toHaveLength(5)
      expect(tokyoResult).toHaveLength(5)

      // All should be at noon in their respective timezones
      utcResult.forEach(date => expect(date.getHours()).toBe(12))
      nyResult.forEach(date => expect(date.getHours()).toBe(12))
      tokyoResult.forEach(date => expect(date.getHours()).toBe(12))
    })

    test('timezone compatibility and DST handling', () => {
      // Test DST boundary scenarios
      jest.useFakeTimers()

      try {
        // Test 1: DST spring forward (March 2024) - America/New_York
        jest.setSystemTime(new Date('2024-03-08T10:00:00Z'))
        const springDST = parseCronExpression('0 2 * * *', 'America/New_York')
        expect(springDST).toHaveLength(5)
        springDST.forEach(date => expect([2, 3]).toContain(date.getHours()))

        // Test 2: DST fall back (November 2024) - America/New_York
        jest.setSystemTime(new Date('2024-11-01T10:00:00Z'))
        const fallDST = parseCronExpression('0 1 * * *', 'America/New_York')
        expect(fallDST).toHaveLength(5)
        fallDST.forEach(date => expect(date.getHours()).toBe(1))

        // Test 3: Cross-timezone consistency on same UTC moment
        jest.setSystemTime(new Date('2024-06-15T12:00:00Z'))
        const utcNoon = parseCronExpression('0 12 * * *', 'UTC')
        const nycMorning = parseCronExpression('0 8 * * *', 'America/New_York') // 8 AM NYC = 12 PM UTC in summer
        const tokyoEvening = parseCronExpression('0 21 * * *', 'Asia/Tokyo') // 9 PM Tokyo = 12 PM UTC

        expect(utcNoon).toHaveLength(5)
        expect(nycMorning).toHaveLength(5)
        expect(tokyoEvening).toHaveLength(5)

        // Verify timezone consistency - all should represent the same UTC moments
        const utcTime = utcNoon[0]
        const nycTime = nycMorning[0]
        const tokyoTime = tokyoEvening[0]

        expect(utcTime.getHours()).toBe(12)
        expect(nycTime.getHours()).toBe(8)
        expect(tokyoTime.getHours()).toBe(21)
      }
      finally {
        jest.useRealTimers()
      }
    })

    test('backward compatibility with execution-time-calculator timezone logic', () => {
      // Simulate the exact usage pattern from execution-time-calculator.ts:47
      const mockData = {
        cron_expression: '30 14 * * 1-5', // 2:30 PM weekdays
        timezone: 'America/New_York',
      }

      // This is the exact call from execution-time-calculator.ts
      const results = parseCronExpression(mockData.cron_expression, mockData.timezone)
      expect(results).toHaveLength(5)

      results.forEach((date) => {
        // Should be weekdays (1-5)
        expect(date.getDay()).toBeGreaterThanOrEqual(1)
        expect(date.getDay()).toBeLessThanOrEqual(5)

        // Should be 2:30 PM in the user's timezone representation
        expect(date.getHours()).toBe(14)
        expect(date.getMinutes()).toBe(30)
        expect(date.getSeconds()).toBe(0)

        // Should be Date objects (not CronDate or other types)
        expect(date).toBeInstanceOf(Date)

        // Should be in the future (relative to test time)
        expect(date.getTime()).toBeGreaterThan(Date.now())
      })
    })

    test('edge case timezone handling', () => {
      // Test uncommon but valid timezones
      const australiaResult = parseCronExpression('0 15 * * *', 'Australia/Sydney')
      const indiaResult = parseCronExpression('0 9 * * *', 'Asia/Kolkata') // UTC+5:30
      const alaskaResult = parseCronExpression('0 6 * * *', 'America/Anchorage')

      expect(australiaResult).toHaveLength(5)
      expect(indiaResult).toHaveLength(5)
      expect(alaskaResult).toHaveLength(5)

      australiaResult.forEach(date => expect(date.getHours()).toBe(15))
      indiaResult.forEach(date => expect(date.getHours()).toBe(9))
      alaskaResult.forEach(date => expect(date.getHours()).toBe(6))

      // Test invalid timezone graceful handling
      const invalidTzResult = parseCronExpression('0 12 * * *', 'Invalid/Timezone')
      // Should either return empty array or handle gracefully
      expect(Array.isArray(invalidTzResult)).toBe(true)
    })

    test('gracefully handles invalid enhanced syntax', () => {
      // Invalid but close to valid expressions
      expect(parseCronExpression('0 12 * JANUARY *')).toEqual([]) // Full month name
      expect(parseCronExpression('0 12 * * MONDAY')).toEqual([]) // Full day name
      expect(parseCronExpression('0 12 32 JAN *')).toEqual([]) // Invalid day with valid month
      expect(parseCronExpression('@invalid')).toEqual([]) // Invalid predefined
    })
  })

  describe('performance tests', () => {
    test('performs well for complex expressions', () => {
      const start = performance.now()

      // Test multiple complex expressions including new syntax
      const expressions = [
        '*/5 9-17 * * 1-5', // Every 5 minutes, weekdays, business hours
        '0 */2 1,15 * *', // Every 2 hours on 1st and 15th
        '30 14 * * 1,3,5', // Mon, Wed, Fri at 14:30
        '15,45 8-18 * * 1-5', // 15 and 45 minutes past the hour, weekdays
        '0 9 * JAN-MAR MON-FRI', // Weekdays in Q1 at 9:00
        '0 12 ? * SUN', // Sundays at noon using ?
        '@daily', // Predefined expression
        '@weekly', // Predefined expression
      ]

      expressions.forEach((expr) => {
        const result = parseCronExpression(expr)
        expect(result.length).toBeGreaterThan(0)
        expect(result.length).toBeLessThanOrEqual(5)
      })

      // Test quarterly expression separately (may return fewer than 5 results)
      const quarterlyResult = parseCronExpression('0 0 1 */3 *') // First day of every 3rd month
      expect(quarterlyResult.length).toBeGreaterThan(0)
      expect(quarterlyResult.length).toBeLessThanOrEqual(5)

      const end = performance.now()

      // Should complete within reasonable time (less than 150ms for all expressions)
      expect(end - start).toBeLessThan(150)
    })
  })
})
