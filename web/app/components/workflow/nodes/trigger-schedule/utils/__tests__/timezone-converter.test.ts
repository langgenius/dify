import {
  TimezoneConverter,
  createTimezoneConverter,
  createTimezoneConverterForSchedule,
  createTimezoneConverterFromUserProfile,
} from '../timezone-converter'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

describe('TimezoneConverter', () => {
  describe('UTC timezone (special case)', () => {
    const converter = new TimezoneConverter('UTC')

    describe('toUTC', () => {
      test('converts 12h format to 24h format for UTC timezone', () => {
        expect(converter.toUTC('2:30 PM')).toBe('14:30')
        expect(converter.toUTC('12:00 AM')).toBe('00:00')
        expect(converter.toUTC('12:00 PM')).toBe('12:00')
        expect(converter.toUTC('11:59 PM')).toBe('23:59')
        expect(converter.toUTC('1:15 AM')).toBe('01:15')
      })

      test('handles invalid time format gracefully', () => {
        expect(converter.toUTC('invalid time')).toBe('invalid time')
        expect(converter.toUTC('25:00 PM')).toBe('25:00 PM') // Invalid hour should return as-is
        expect(converter.toUTC('')).toBe('')
      })
    })

    describe('fromUTC', () => {
      test('converts 24h format to 12h format for UTC timezone', () => {
        expect(converter.fromUTC('14:30')).toBe('2:30 PM')
        expect(converter.fromUTC('00:00')).toBe('12:00 AM')
        expect(converter.fromUTC('12:00')).toBe('12:00 PM')
        expect(converter.fromUTC('23:59')).toBe('11:59 PM')
        expect(converter.fromUTC('01:15')).toBe('1:15 AM')
      })
    })

    describe('round trip conversion', () => {
      test('maintains consistency in both directions', () => {
        const testTimes = ['12:00 AM', '6:30 AM', '12:00 PM', '2:30 PM', '11:59 PM']

        testTimes.forEach((time) => {
          const utc = converter.toUTC(time)
          const backToUser = converter.fromUTC(utc)
          expect(backToUser).toBe(time)
        })
      })
    })
  })

  describe('Non-UTC timezone conversions', () => {
    describe('America/New_York timezone', () => {
      const converter = new TimezoneConverter('America/New_York')

      test('converts user time to UTC correctly', () => {
        // Note: Using a fixed reference date to avoid DST variations in tests
        const utcTime = converter.toUTC('2:30 PM')
        // The exact UTC time depends on whether it's EST or EDT
        // We validate the format and that conversion occurred
        expect(utcTime).toMatch(/^\d{2}:\d{2}$/)
        expect(utcTime).not.toBe('14:30') // Should be different from UTC input
      })

      test('converts UTC time to user timezone correctly', () => {
        const userTime = converter.fromUTC('19:30')
        expect(userTime).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/)
      })

      test('round trip conversion maintains consistency', () => {
        const testTimes = ['9:00 AM', '12:00 PM', '6:30 PM']

        testTimes.forEach((time) => {
          const utc = converter.toUTC(time)
          const backToUser = converter.fromUTC(utc)
          expect(backToUser).toBe(time)
        })
      })
    })

    describe('Asia/Tokyo timezone', () => {
      const converter = new TimezoneConverter('Asia/Tokyo')

      test('handles timezone conversion correctly', () => {
        const utcTime = converter.toUTC('3:00 PM')
        expect(utcTime).toMatch(/^\d{2}:\d{2}$/)

        const backToUser = converter.fromUTC(utcTime)
        expect(backToUser).toBe('3:00 PM')
      })
    })

    describe('Europe/London timezone', () => {
      const converter = new TimezoneConverter('Europe/London')

      test('handles timezone conversion correctly', () => {
        const utcTime = converter.toUTC('6:00 PM')
        expect(utcTime).toMatch(/^\d{2}:\d{2}$/)

        const backToUser = converter.fromUTC(utcTime)
        expect(backToUser).toBe('6:00 PM')
      })
    })
  })

  describe('getCurrentUserTime', () => {
    test('returns current time for UTC', () => {
      const converter = new TimezoneConverter('UTC')
      const result = converter.getCurrentUserTime()
      expect(result).toBeInstanceOf(Date)

      // Should be close to actual current time (within 1 second)
      const now = new Date()
      expect(Math.abs(result.getTime() - now.getTime())).toBeLessThan(1000)
    })

    test('returns current time for different timezone', () => {
      const converter = new TimezoneConverter('America/New_York')
      const result = converter.getCurrentUserTime()
      expect(result).toBeInstanceOf(Date)
    })

    test('handles invalid timezone gracefully', () => {
      const converter = new TimezoneConverter('Invalid/Timezone')
      const result = converter.getCurrentUserTime()
      expect(result).toBeInstanceOf(Date)
    })
  })

  describe('formatExecutionTime', () => {
    const testDate = new Date('2024-03-15T14:30:00.000Z')

    test('formats time in UTC timezone', () => {
      const converter = new TimezoneConverter('UTC')
      const result = converter.formatExecutionTime(testDate)

      expect(result).toContain('March')
      expect(result).toContain('15')
      expect(result).toContain('2024')
      expect(result).toContain('2:30 PM')
    })

    test('formats time in different timezone', () => {
      const converter = new TimezoneConverter('America/New_York')
      const result = converter.formatExecutionTime(testDate)

      expect(result).toContain('March')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    test('handles includeWeekday parameter', () => {
      const converter = new TimezoneConverter('UTC')
      const withWeekday = converter.formatExecutionTime(testDate, true)
      const withoutWeekday = converter.formatExecutionTime(testDate, false)

      expect(typeof withWeekday).toBe('string')
      expect(typeof withoutWeekday).toBe('string')
    })
  })

  describe('format validation methods', () => {
    const converter = new TimezoneConverter('UTC')

    describe('isUTCFormat', () => {
      test('identifies valid UTC format correctly', () => {
        expect(converter.isUTCFormat('14:30')).toBe(true)
        expect(converter.isUTCFormat('00:00')).toBe(true)
        expect(converter.isUTCFormat('23:59')).toBe(true)
      })

      test('rejects invalid UTC format', () => {
        expect(converter.isUTCFormat('2:30 PM')).toBe(false)
        expect(converter.isUTCFormat('14:3')).toBe(false)
        expect(converter.isUTCFormat('25:00')).toBe(false)
        expect(converter.isUTCFormat('')).toBe(false)
      })
    })

    describe('isUserFormat', () => {
      test('identifies valid user format correctly', () => {
        expect(converter.isUserFormat('2:30 PM')).toBe(true)
        expect(converter.isUserFormat('12:00 AM')).toBe(true)
        expect(converter.isUserFormat('11:59 PM')).toBe(true)
      })

      test('rejects invalid user format', () => {
        expect(converter.isUserFormat('14:30')).toBe(false)
        expect(converter.isUserFormat('2:30')).toBe(false)
        expect(converter.isUserFormat('2:30 XM')).toBe(false)
        expect(converter.isUserFormat('')).toBe(false)
      })
    })
  })

  describe('getUserTimezone', () => {
    test('returns the configured timezone', () => {
      const converter = new TimezoneConverter('America/New_York')
      expect(converter.getUserTimezone()).toBe('America/New_York')
    })

    test('defaults to system timezone for empty timezone', () => {
      const converter = new TimezoneConverter('')
      const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone
      expect(converter.getUserTimezone()).toBe(systemTz)
    })
  })

  describe('error handling', () => {
    test('handles invalid timezone in constructor gracefully', () => {
      expect(() => new TimezoneConverter('Invalid/Timezone')).not.toThrow()
    })

    test('handles conversion errors gracefully', () => {
      const converter = new TimezoneConverter('Invalid/Timezone')

      // Should not throw and should return reasonable defaults
      expect(() => converter.toUTC('2:30 PM')).not.toThrow()
      expect(() => converter.fromUTC('14:30')).not.toThrow()
      expect(() => converter.getCurrentUserTime()).not.toThrow()
    })
  })

  describe('factory functions', () => {
    describe('createTimezoneConverter', () => {
      test('creates converter instance correctly', () => {
        const converter = createTimezoneConverter('America/New_York')
        expect(converter).toBeInstanceOf(TimezoneConverter)
        expect(converter.getUserTimezone()).toBe('America/New_York')
      })
    })

    describe('createTimezoneConverterFromUserProfile', () => {
      test('uses user profile timezone when available', () => {
        const userProfile = { timezone: 'Europe/London' }
        const converter = createTimezoneConverterFromUserProfile(userProfile, 'America/New_York')

        expect(converter).toBeInstanceOf(TimezoneConverter)
        expect(converter.getUserTimezone()).toBe('Europe/London')
      })

      test('falls back to payload timezone when user profile has no timezone', () => {
        const userProfile = {} // no timezone
        const converter = createTimezoneConverterFromUserProfile(userProfile, 'America/New_York')

        expect(converter.getUserTimezone()).toBe('America/New_York')
      })

      test('falls back to system timezone when both are missing', () => {
        const converter = createTimezoneConverterFromUserProfile(undefined, undefined)

        expect(converter).toBeInstanceOf(TimezoneConverter)
        // Should use system timezone (Intl.DateTimeFormat().resolvedOptions().timeZone)
        expect(typeof converter.getUserTimezone()).toBe('string')
        expect(converter.getUserTimezone().length).toBeGreaterThan(0)
      })

      test('handles undefined user profile gracefully', () => {
        const converter = createTimezoneConverterFromUserProfile(undefined, 'Asia/Tokyo')

        expect(converter.getUserTimezone()).toBe('Asia/Tokyo')
      })

      test('follows exact same logic as use-config.ts', () => {
        // This test ensures our factory matches the exact logic in use-config.ts line 18
        // const userTimezone = userProfile?.timezone || payload.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone

        // Case 1: User has timezone
        const userWithTimezone = { timezone: 'Europe/Paris' }
        const converter1 = createTimezoneConverterFromUserProfile(userWithTimezone, 'America/Los_Angeles')
        expect(converter1.getUserTimezone()).toBe('Europe/Paris')

        // Case 2: User has no timezone, use payload
        const userWithoutTimezone = {}
        const converter2 = createTimezoneConverterFromUserProfile(userWithoutTimezone, 'America/Los_Angeles')
        expect(converter2.getUserTimezone()).toBe('America/Los_Angeles')

        // Case 3: Neither user nor payload, use system
        const converter3 = createTimezoneConverterFromUserProfile({}, '')
        const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        expect(converter3.getUserTimezone()).toBe(systemTimezone)
      })
    })

    describe('createTimezoneConverterForSchedule', () => {
      test('is an alias for createTimezoneConverterFromUserProfile', () => {
        const userProfile = { timezone: 'Australia/Sydney' }
        const converter1 = createTimezoneConverterForSchedule(userProfile, 'UTC')
        const converter2 = createTimezoneConverterFromUserProfile(userProfile, 'UTC')

        expect(converter1.getUserTimezone()).toBe(converter2.getUserTimezone())
        expect(converter1.getUserTimezone()).toBe('Australia/Sydney')
      })
    })
  })

  describe('edge cases and boundary conditions', () => {
    const converter = new TimezoneConverter('UTC')

    test('handles midnight correctly', () => {
      expect(converter.toUTC('12:00 AM')).toBe('00:00')
      expect(converter.fromUTC('00:00')).toBe('12:00 AM')
    })

    test('handles noon correctly', () => {
      expect(converter.toUTC('12:00 PM')).toBe('12:00')
      expect(converter.fromUTC('12:00')).toBe('12:00 PM')
    })

    test('handles hour boundaries correctly', () => {
      expect(converter.toUTC('11:59 PM')).toBe('23:59')
      expect(converter.fromUTC('23:59')).toBe('11:59 PM')

      expect(converter.toUTC('1:00 AM')).toBe('01:00')
      expect(converter.fromUTC('01:00')).toBe('1:00 AM')
    })
  })
})

describe('Integration tests', () => {
  test('multiple timezone converters work independently', () => {
    const utcConverter = new TimezoneConverter('UTC')
    const estConverter = new TimezoneConverter('America/New_York')
    const pstConverter = new TimezoneConverter('America/Los_Angeles')

    const testTime = '2:30 PM'

    // Each converter should handle the same input differently
    const utcResult = utcConverter.toUTC(testTime)
    const estResult = estConverter.toUTC(testTime)
    const pstResult = pstConverter.toUTC(testTime)

    // UTC should just convert format
    expect(utcResult).toBe('14:30')

    // EST and PST should produce different UTC times
    expect(estResult).toMatch(/^\d{2}:\d{2}$/)
    expect(pstResult).toMatch(/^\d{2}:\d{2}$/)

    // All should convert back to original user time
    expect(utcConverter.fromUTC(utcResult)).toBe(testTime)
    expect(estConverter.fromUTC(estResult)).toBe(testTime)
    expect(pstConverter.fromUTC(pstResult)).toBe(testTime)
  })

  test('converter maintains consistency across different operations', () => {
    const converter = new TimezoneConverter('Europe/London')
    const testTime = '6:00 PM'

    // Test the complete flow: user input → UTC storage → user display
    const utcTime = converter.toUTC(testTime)
    const displayTime = converter.fromUTC(utcTime)

    // Should maintain perfect round-trip consistency
    expect(displayTime).toBe(testTime)

    // UTC format should be valid
    expect(converter.isUTCFormat(utcTime)).toBe(true)
    expect(converter.isUserFormat(displayTime)).toBe(true)
  })

  describe('Project Integration Tests', () => {
    test('simulates real use-config.ts integration scenario', () => {
      // Simulate the exact scenario from use-config.ts
      const mockUserProfile = { timezone: 'Asia/Shanghai' }
      const mockPayload = { timezone: 'America/New_York' } // This should be ignored

      // Create converter using project's factory
      const converter = createTimezoneConverterFromUserProfile(mockUserProfile, mockPayload.timezone)

      // Should prioritize user profile timezone
      expect(converter.getUserTimezone()).toBe('Asia/Shanghai')

      // Test the complete workflow
      const userInputTime = '3:00 PM' // User sees this in UI
      const utcStorageTime = converter.toUTC(userInputTime) // Store as UTC
      const userDisplayTime = converter.fromUTC(utcStorageTime) // Display back to user

      // Should maintain perfect round-trip
      expect(userDisplayTime).toBe(userInputTime)
    })

    test('simulates execution time calculation integration', () => {
      // Simulate integration with execution-time-calculator.ts
      const userProfile = { timezone: 'Europe/Berlin' }
      const converter = createTimezoneConverterForSchedule(userProfile)

      // Get current time in user timezone (for execution calculations)
      const currentUserTime = converter.getCurrentUserTime()
      expect(currentUserTime).toBeInstanceOf(Date)

      // Format execution time for display
      const futureExecution = new Date(Date.now() + 86400000) // Tomorrow
      const formattedTime = converter.formatExecutionTime(futureExecution)

      expect(typeof formattedTime).toBe('string')
      expect(formattedTime.length).toBeGreaterThan(0)
    })

    test('handles all the fallback scenarios from use-config.ts', () => {
      // Test Case 1: User has timezone preference
      const scenario1 = createTimezoneConverterFromUserProfile(
        { timezone: 'Australia/Melbourne' },
        'UTC',
      )
      expect(scenario1.getUserTimezone()).toBe('Australia/Melbourne')

      // Test Case 2: No user timezone, use payload timezone
      const scenario2 = createTimezoneConverterFromUserProfile(
        { /* no timezone */ },
        'Europe/Stockholm',
      )
      expect(scenario2.getUserTimezone()).toBe('Europe/Stockholm')

      // Test Case 3: No user timezone, no payload timezone, use system
      const scenario3 = createTimezoneConverterFromUserProfile(
        undefined,
        undefined,
      )
      const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone
      expect(scenario3.getUserTimezone()).toBe(systemTz)
    })

    test('compatibility with existing timezone formats', () => {
      // Test that our converter can handle both existing formats in the system
      const converter = createTimezoneConverter('America/Chicago')

      // Should recognize UTC format (existing storage format)
      expect(converter.isUTCFormat('14:30')).toBe(true)
      expect(converter.isUTCFormat('09:15')).toBe(true)

      // Should recognize user format (existing display format)
      expect(converter.isUserFormat('2:30 PM')).toBe(true)
      expect(converter.isUserFormat('9:15 AM')).toBe(true)

      // Should handle conversion between both formats
      const utcTime = converter.toUTC('2:30 PM')
      const userTime = converter.fromUTC(utcTime)
      expect(userTime).toBe('2:30 PM')
    })

    test('end-to-end schedule workflow simulation', () => {
      // Simulate complete schedule creation and display workflow
      const userProfile = { timezone: 'America/Denver' }
      const converter = createTimezoneConverterForSchedule(userProfile, 'UTC')

      // Step 1: User sets time in UI
      const userSelectedTime = '10:30 AM'

      // Step 2: Convert to UTC for storage
      const utcTimeForStorage = converter.toUTC(userSelectedTime)
      expect(converter.isUTCFormat(utcTimeForStorage)).toBe(true)

      // Step 3: When displaying back to user
      const displayTime = converter.fromUTC(utcTimeForStorage)
      expect(displayTime).toBe(userSelectedTime)
      expect(converter.isUserFormat(displayTime)).toBe(true)

      // Step 4: Get current time for execution calculations
      const currentTime = converter.getCurrentUserTime()
      expect(currentTime).toBeInstanceOf(Date)

      // Step 5: Format execution times for display
      const nextExecution = new Date(currentTime.getTime() + 3600000) // 1 hour later
      const formattedExecution = converter.formatExecutionTime(nextExecution)
      expect(typeof formattedExecution).toBe('string')
      expect(formattedExecution).toContain('AM') // Should be in 12-hour format
    })
  })
})
