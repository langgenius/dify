import { createTimezoneConverterForSchedule, createTimezoneConverterFromUserProfile } from '../utils/timezone-converter'
import { getNextExecutionTimes } from '../utils/execution-time-calculator'
import type { ScheduleTriggerNodeType } from '../types'
import type { UserProfileResponse } from '@/models/common'

/**
 * Integration tests for the unified timezone system
 * Tests the complete flow from UI configuration to execution time calculation
 */
describe('Timezone System Integration Tests', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    // Set a fixed time for consistent test results
    jest.setSystemTime(new Date('2024-02-15T08:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('End-to-End Timezone Flow', () => {
    test('complete workflow from UI to execution calculation', () => {
      // Simulate user profile with Pacific timezone
      const userProfile: UserProfileResponse = { timezone: 'America/Los_Angeles' }

      // Original schedule data (stored in UTC format)
      const schedulePayload: ScheduleTriggerNodeType = {
        mode: 'visual',
        frequency: 'daily',
        visual_config: {
          time: '14:30', // 2:30 PM UTC (stored format)
        },
        timezone: 'UTC', // Original timezone from payload
        enabled: true,
        id: 'test',
        type: 'trigger-schedule',
        data: {},
        position: { x: 0, y: 0 },
      }

      // Step 1: Simulate use-config behavior - convert UTC time to user timezone for UI
      const uiConverter = createTimezoneConverterFromUserProfile(userProfile, schedulePayload.timezone)

      // Should convert 14:30 UTC to user timezone (Pacific Standard Time in February)
      const uiDisplayTime = uiConverter.fromUTC('14:30')
      expect(uiDisplayTime).toBe('6:30 AM') // PST is UTC-8

      // Step 2: User modifies time in UI to 9:00 AM Pacific
      const userInputTime = '9:00 AM'

      // Step 3: Convert user input back to UTC for storage (simulate setInputs)
      const utcTimeForStorage = uiConverter.toUTC(userInputTime)
      expect(utcTimeForStorage).toBe('17:00') // 9:00 AM PST = 17:00 UTC (PST is UTC-8)

      // Step 4: Calculate execution times using the stored UTC time
      const modifiedSchedule: ScheduleTriggerNodeType = {
        ...schedulePayload,
        visual_config: {
          time: utcTimeForStorage,
        },
      }

      const executionTimes = getNextExecutionTimes(modifiedSchedule, 3, userProfile)

      // Step 5: Verify execution times are correct (stored as UTC Date objects)
      expect(executionTimes).toHaveLength(3)
      // Execution times are stored in UTC: 9:00 AM PST = 17:00 UTC
      expect(executionTimes[0].getUTCHours()).toBe(17) // 17:00 UTC
      expect(executionTimes[0].getUTCMinutes()).toBe(0)

      // Step 6: Format execution times for display
      const displayTimes = executionTimes.map(date =>
        uiConverter.formatExecutionTime(date, false),
      )

      displayTimes.forEach((displayTime) => {
        expect(displayTime).toContain('9:00 AM') // Should display in user timezone
        expect(displayTime).toContain('February') // Should show correct date
        expect(typeof displayTime).toBe('string') // Verify it's formatted correctly
      })
    })

    test('handles timezone transitions correctly', () => {
      const userProfile: UserProfileResponse = { timezone: 'Europe/London' }

      const schedulePayload: ScheduleTriggerNodeType = {
        mode: 'visual',
        frequency: 'weekly',
        visual_config: {
          time: '12:00 PM',
          weekdays: ['mon'],
        },
        timezone: userProfile.timezone,
        enabled: true,
        id: 'test',
        type: 'trigger-schedule',
        data: {},
        position: { x: 0, y: 0 },
      }

      // Test during different times of year for DST transitions
      const winterTime = new Date('2024-01-15T10:00:00.000Z')
      const summerTime = new Date('2024-07-15T10:00:00.000Z')

      // Winter execution (GMT+0)
      jest.setSystemTime(winterTime)
      const winterExecutions = getNextExecutionTimes(schedulePayload, 1, userProfile)

      // Summer execution (BST+1)
      jest.setSystemTime(summerTime)
      const summerExecutions = getNextExecutionTimes(schedulePayload, 1, userProfile)

      // Verify we got valid executions
      expect(winterExecutions).toHaveLength(1)
      expect(summerExecutions).toHaveLength(1)
      expect(winterExecutions[0]).toBeDefined()
      expect(summerExecutions[0]).toBeDefined()

      // Both should be scheduled for noon local time
      const converter = createTimezoneConverterForSchedule(userProfile)
      const winterDisplay = converter.formatExecutionTime(winterExecutions[0], false)
      const summerDisplay = converter.formatExecutionTime(summerExecutions[0], false)

      expect(winterDisplay).toContain('12:00 PM')
      expect(summerDisplay).toContain('12:00 PM')
    })

    test('maintains consistency across multiple converter instances', () => {
      const userProfile: UserProfileResponse = { timezone: 'Asia/Tokyo' }
      const testTime = '3:45 PM'

      // Create multiple converter instances
      const converter1 = createTimezoneConverterFromUserProfile(userProfile, 'UTC')
      const converter2 = createTimezoneConverterFromUserProfile(userProfile, 'America/New_York')

      // Both should prioritize user profile timezone
      expect(converter1.getUserTimezone()).toBe('Asia/Tokyo')
      expect(converter2.getUserTimezone()).toBe('Asia/Tokyo')

      // Both should produce identical conversions
      const utc1 = converter1.toUTC(testTime)
      const utc2 = converter2.toUTC(testTime)
      expect(utc1).toBe(utc2)

      const user1 = converter1.fromUTC(utc1)
      const user2 = converter2.fromUTC(utc2)
      expect(user1).toBe(user2)
      expect(user1).toBe(testTime)
    })

    test('handles edge cases in complete workflow', () => {
      const userProfile: UserProfileResponse = { timezone: 'America/New_York' }

      // Test midnight crossing
      const midnightSchedule: ScheduleTriggerNodeType = {
        mode: 'visual',
        frequency: 'daily',
        visual_config: {
          time: '11:30 PM',
        },
        timezone: 'America/New_York',
        enabled: true,
        id: 'test',
        type: 'trigger-schedule',
        data: {},
        position: { x: 0, y: 0 },
      }

      const converter = createTimezoneConverterFromUserProfile(userProfile)

      // Convert to UTC (should be next day in UTC)
      const utcTime = converter.toUTC('11:30 PM')
      expect(utcTime).toMatch(/^(04:30|03:30)$/) // Depends on DST (EST/EDT)

      // Calculate execution times using the UTC time
      const scheduleWithUTC: ScheduleTriggerNodeType = {
        ...midnightSchedule,
        visual_config: { time: utcTime },
      }
      const executions = getNextExecutionTimes(scheduleWithUTC, 2, userProfile)

      expect(executions).toHaveLength(2)

      // Format for display - should show original time
      const displayTimes = executions.map(date =>
        converter.formatExecutionTime(date, false),
      )

      // The timezone conversion is working correctly now - 11:30 PM EST shows as 11:30 PM
      displayTimes.forEach((displayTime) => {
        expect(displayTime).toContain('11:30 PM') // Verify correct time display
        expect(displayTime).toContain('February') // Verify date format
        expect(typeof displayTime).toBe('string') // Verify it's a valid string
      })
    })

    test('validates fallback behavior when user profile is missing', () => {
      const schedulePayload: ScheduleTriggerNodeType = {
        mode: 'visual',
        frequency: 'daily',
        visual_config: {
          time: '2:15 PM',
        },
        timezone: 'Europe/Paris',
        enabled: true,
        id: 'test',
        type: 'trigger-schedule',
        data: {},
        position: { x: 0, y: 0 },
      }

      // Test with undefined user profile
      const converter = createTimezoneConverterFromUserProfile(undefined, schedulePayload.timezone)
      expect(converter.getUserTimezone()).toBe('Europe/Paris')

      // Test with user profile without timezone
      const emptyProfile: UserProfileResponse = {}
      const converter2 = createTimezoneConverterFromUserProfile(emptyProfile, schedulePayload.timezone)
      expect(converter2.getUserTimezone()).toBe('Europe/Paris')

      // Both should work for execution time calculation
      const executions1 = getNextExecutionTimes(schedulePayload, 1, undefined)
      const executions2 = getNextExecutionTimes(schedulePayload, 1, emptyProfile)

      expect(executions1).toHaveLength(1)
      expect(executions2).toHaveLength(1)
      expect(executions1[0].getTime()).toBe(executions2[0].getTime())
    })

    test('round-trip consistency for all supported timezones', () => {
      const testTimezones = [
        'UTC',
        'America/New_York',
        'America/Los_Angeles',
        'Europe/London',
        'Europe/Paris',
        'Asia/Tokyo',
        'Asia/Shanghai',
        'Australia/Sydney',
      ]

      const testTimes = [
        '12:00 AM', // Midnight
        '6:00 AM', // Morning
        '12:00 PM', // Noon
        '6:00 PM', // Evening
        '11:59 PM', // Late night
      ]

      testTimezones.forEach((timezone) => {
        const userProfile: UserProfileResponse = { timezone }
        const converter = createTimezoneConverterFromUserProfile(userProfile)

        testTimes.forEach((testTime) => {
          // Round-trip test: user time -> UTC -> user time
          const utcTime = converter.toUTC(testTime)
          const roundTripTime = converter.fromUTC(utcTime)

          expect(roundTripTime).toBe(testTime)
        })
      })
    })
  })

  describe('Error Recovery and Resilience', () => {
    test('graceful handling of invalid timezone data', () => {
      const invalidProfile: UserProfileResponse = { timezone: 'Invalid/Timezone' }

      // Should fallback to system timezone without throwing
      expect(() => {
        const converter = createTimezoneConverterFromUserProfile(invalidProfile, 'UTC')
        converter.toUTC('2:00 PM')
        converter.fromUTC('14:00')
        converter.getCurrentUserTime()
      }).not.toThrow()
    })

    test('handles malformed time inputs gracefully', () => {
      const converter = createTimezoneConverterFromUserProfile({ timezone: 'UTC' })

      const invalidTimes = [
        '',
        '25:00 AM',
        '12:60 PM',
        'invalid time',
        '2:30 XM',
      ]

      invalidTimes.forEach((invalidTime) => {
        expect(() => {
          const result = converter.toUTC(invalidTime)
          expect(typeof result).toBe('string') // Should return string, not throw
        }).not.toThrow()
      })
    })

    test('maintains functionality when dayjs plugins fail', () => {
      const converter = createTimezoneConverterFromUserProfile(
        { timezone: 'UTC' },
        'Invalid/Timezone',
      )

      // Should still work for basic operations
      expect(converter.toUTC('2:30 PM')).toBe('14:30')
      expect(converter.fromUTC('14:30')).toBe('2:30 PM')
      expect(() => converter.getCurrentUserTime()).not.toThrow()
    })
  })
})
