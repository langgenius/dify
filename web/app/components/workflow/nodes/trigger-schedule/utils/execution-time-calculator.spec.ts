import { formatExecutionTime, getDefaultDateTime, getFormattedExecutionTimes, getNextExecutionTime, getNextExecutionTimes } from './execution-time-calculator'
import type { ScheduleTriggerNodeType } from '../types'

const createMockData = (overrides: Partial<ScheduleTriggerNodeType> = {}): ScheduleTriggerNodeType => ({
  id: 'test-node',
  type: 'schedule-trigger',
  mode: 'visual',
  frequency: 'daily',
  visual_config: {
    time: '11:30 AM',
    weekdays: ['sun'],
    recur_every: 1,
    recur_unit: 'hours',
  },
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, // Use system timezone for consistent tests
  enabled: true,
  ...overrides,
})

describe('execution-time-calculator', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(2024, 0, 15, 10, 0, 0)) // Local time: 2024-01-15 10:00:00
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('formatExecutionTime', () => {
    test('formats time with weekday by default', () => {
      const date = new Date(2024, 0, 16, 14, 30)
      const result = formatExecutionTime(date)

      expect(result).toBe('Tue, January 16, 2024 2:30 PM')
    })

    test('formats time without weekday when specified', () => {
      const date = new Date(2024, 0, 16, 14, 30)
      const result = formatExecutionTime(date, false)

      expect(result).toBe('January 16, 2024 2:30 PM')
    })

    test('handles morning times correctly', () => {
      const date = new Date(2024, 0, 16, 9, 15)
      const result = formatExecutionTime(date)

      expect(result).toBe('Tue, January 16, 2024 9:15 AM')
    })

    test('handles midnight correctly', () => {
      const date = new Date(2024, 0, 16, 0, 0)
      const result = formatExecutionTime(date)

      expect(result).toBe('Tue, January 16, 2024 12:00 AM')
    })
  })

  describe('getNextExecutionTimes - daily frequency', () => {
    test('calculates next 5 daily executions', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:30 PM' },
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result).toHaveLength(5)
      expect(result[0].getHours()).toBe(14)
      expect(result[0].getMinutes()).toBe(30)
      expect(result[1].getDate()).toBe(result[0].getDate() + 1)
    })

    test('handles past time by moving to next day', () => {
      jest.setSystemTime(new Date(2024, 0, 15, 15, 0, 0)) // 3:00 PM local time

      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:30 PM' },
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result[0].getDate()).toBe(16)
    })

    test('handles AM/PM conversion correctly', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '11:30 PM' },
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result[0].getHours()).toBe(23)
      expect(result[0].getMinutes()).toBe(30)
    })

    test('handles 12 AM correctly', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 AM' },
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result[0].getHours()).toBe(0)
    })

    test('handles 12 PM correctly', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 PM' },
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result[0].getHours()).toBe(12)
    })
  })

  describe('getNextExecutionTimes - weekly frequency', () => {
    test('calculates next 5 weekly executions for Sunday', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '2:30 PM',
          weekdays: ['sun'],
        },
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result).toHaveLength(5)
      result.forEach((date) => {
        expect(date.getDay()).toBe(0)
        expect(date.getHours()).toBe(14)
        expect(date.getMinutes()).toBe(30)
      })
    })

    test('calculates next execution for Monday from Monday', () => {
      jest.setSystemTime(new Date(2024, 0, 15, 10, 0))

      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '2:30 PM',
          weekdays: ['mon'],
        },
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result[0].getDate()).toBe(15)
      expect(result[1].getDate()).toBe(22)
    })

    test('moves to next week when current day time has passed', () => {
      jest.setSystemTime(new Date(2024, 0, 15, 15, 0, 0)) // Monday 3:00 PM local time

      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '2:30 PM',
          weekdays: ['mon'],
        },
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result[0].getDate()).toBe(22)
    })

    test('handles different weekdays correctly', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '9:00 AM',
          weekdays: ['fri'],
        },
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result[0].getDay()).toBe(5)
    })
  })

  describe('getNextExecutionTimes - hourly frequency', () => {
    test('calculates hourly intervals correctly', () => {
      const startTime = new Date(2024, 0, 15, 12, 0, 0) // Local time 12:00 PM

      const data = createMockData({
        frequency: 'hourly',
        visual_config: {
          datetime: startTime.toISOString(),
          recur_every: 2,
          recur_unit: 'hours',
        },
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      expect(result[0].getTime() - startTime.getTime()).toBe(2 * 60 * 60 * 1000)
      expect(result[1].getTime() - startTime.getTime()).toBe(4 * 60 * 60 * 1000)
      expect(result[2].getTime() - startTime.getTime()).toBe(6 * 60 * 60 * 1000)
    })

    test('calculates minute intervals correctly', () => {
      const startTime = new Date(2024, 0, 15, 12, 0, 0) // Local time 12:00 PM

      const data = createMockData({
        frequency: 'hourly',
        visual_config: {
          datetime: startTime.toISOString(),
          recur_every: 30,
          recur_unit: 'minutes',
        },
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      expect(result[0].getTime() - startTime.getTime()).toBe(30 * 60 * 1000)
      expect(result[1].getTime() - startTime.getTime()).toBe(60 * 60 * 1000)
    })

    test('handles past start time by calculating next interval', () => {
      jest.setSystemTime(new Date(2024, 0, 15, 14, 30, 0)) // Local time 2:30 PM
      const startTime = new Date(2024, 0, 15, 12, 0, 0) // Local time 12:00 PM

      const data = createMockData({
        frequency: 'hourly',
        visual_config: {
          datetime: startTime.toISOString(),
          recur_every: 1,
          recur_unit: 'hours',
        },
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result[0].getHours()).toBe(15)
      expect(result[1].getHours()).toBe(16)
    })

    test('uses current time as default start time', () => {
      const data = createMockData({
        frequency: 'hourly',
        visual_config: {
          recur_every: 1,
          recur_unit: 'hours',
        },
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result[0].getTime()).toBeGreaterThan(Date.now())
    })

    test('minute intervals should not have duplicates when recur_every changes', () => {
      const startTime = new Date(2024, 0, 15, 12, 0, 0)

      // Test with recur_every = 2 minutes
      const data2 = createMockData({
        frequency: 'hourly',
        visual_config: {
          datetime: startTime.toISOString(),
          recur_every: 2,
          recur_unit: 'minutes',
        },
      })

      const result2 = getNextExecutionTimes(data2, 5)

      // Check for no duplicates in result2
      const timestamps2 = result2.map(date => date.getTime())
      const uniqueTimestamps2 = new Set(timestamps2)
      expect(timestamps2.length).toBe(uniqueTimestamps2.size)

      // Check intervals are correct for 2-minute intervals
      for (let i = 1; i < result2.length; i++) {
        const timeDiff = result2[i].getTime() - result2[i - 1].getTime()
        expect(timeDiff).toBe(2 * 60 * 1000) // 2 minutes in milliseconds
      }
    })

    test('hourly intervals should handle recur_every changes correctly', () => {
      const startTime = new Date(2024, 0, 15, 12, 0, 0)

      // Test with recur_every = 3 hours
      const data = createMockData({
        frequency: 'hourly',
        visual_config: {
          datetime: startTime.toISOString(),
          recur_every: 3,
          recur_unit: 'hours',
        },
      })

      const result = getNextExecutionTimes(data, 4)

      // Check for no duplicates
      const timestamps = result.map(date => date.getTime())
      const uniqueTimestamps = new Set(timestamps)
      expect(timestamps.length).toBe(uniqueTimestamps.size)

      // Check intervals are correct for 3-hour intervals
      for (let i = 1; i < result.length; i++) {
        const timeDiff = result[i].getTime() - result[i - 1].getTime()
        expect(timeDiff).toBe(3 * 60 * 60 * 1000) // 3 hours in milliseconds
      }
    })

    test('uses time field when datetime is not available for hourly frequency', () => {
      jest.setSystemTime(new Date(2024, 0, 15, 9, 0, 0)) // 9:00 AM

      const data = createMockData({
        frequency: 'hourly',
        visual_config: {
          time: '11:30 AM',
          recur_every: 1,
          recur_unit: 'hours',
        },
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      expect(result[0].getHours()).toBe(12) // next hour after 11:30 AM
      expect(result[0].getMinutes()).toBe(30)
      expect(result[1].getHours()).toBe(13)
      expect(result[1].getMinutes()).toBe(30)
      expect(result[2].getHours()).toBe(14)
      expect(result[2].getMinutes()).toBe(30)
    })

    test('prioritizes datetime over time field for hourly frequency', () => {
      const specificDateTime = new Date(2024, 0, 15, 14, 15, 0)

      const data = createMockData({
        frequency: 'hourly',
        visual_config: {
          time: '11:30 AM',
          datetime: specificDateTime.toISOString(),
          recur_every: 2,
          recur_unit: 'hours',
        },
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      expect(result[0].getHours()).toBe(16) // 2 hours after 14:15
      expect(result[0].getMinutes()).toBe(15)
      expect(result[1].getHours()).toBe(18) // 4 hours after 14:15
      expect(result[1].getMinutes()).toBe(15)
    })

    test('handles past time correctly when using time field for hourly frequency', () => {
      jest.setSystemTime(new Date(2024, 0, 15, 13, 0, 0)) // 1:00 PM

      const data = createMockData({
        frequency: 'hourly',
        visual_config: {
          time: '11:30 AM',
          recur_every: 2,
          recur_unit: 'hours',
        },
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      expect(result[0].getTime()).toBeGreaterThan(Date.now())

      const timeDiff = result[1].getTime() - result[0].getTime()
      expect(timeDiff).toBe(2 * 60 * 60 * 1000) // 2 hours
    })

    test('handles PM times correctly when using time field for hourly frequency', () => {
      jest.setSystemTime(new Date(2024, 0, 15, 9, 0, 0)) // 9:00 AM

      const data = createMockData({
        frequency: 'hourly',
        visual_config: {
          time: '2:30 PM',
          recur_every: 1,
          recur_unit: 'hours',
        },
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      expect(result[0].getHours()).toBe(15) // next hour after 2:30 PM
      expect(result[0].getMinutes()).toBe(30)
      expect(result[1].getHours()).toBe(16)
      expect(result[1].getMinutes()).toBe(30)
    })

    test('handles 12 AM correctly when using time field for hourly frequency', () => {
      jest.setSystemTime(new Date(2024, 0, 15, 22, 0, 0)) // 10:00 PM

      const data = createMockData({
        frequency: 'hourly',
        visual_config: {
          time: '12:00 AM',
          recur_every: 1,
          recur_unit: 'hours',
        },
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      expect(result[0].getHours()).toBe(23) // next hour after 12:00 AM (next day)
      expect(result[0].getMinutes()).toBe(0)
      expect(result[1].getHours()).toBe(0) // following hour (next day)
      expect(result[1].getMinutes()).toBe(0)
    })

    test('handles 12 PM correctly when using time field for hourly frequency', () => {
      jest.setSystemTime(new Date(2024, 0, 15, 9, 0, 0)) // 9:00 AM

      const data = createMockData({
        frequency: 'hourly',
        visual_config: {
          time: '12:00 PM',
          recur_every: 1,
          recur_unit: 'hours',
        },
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      expect(result[0].getHours()).toBe(13) // next hour after 12:00 PM
      expect(result[0].getMinutes()).toBe(0)
      expect(result[1].getHours()).toBe(14)
      expect(result[1].getMinutes()).toBe(0)
    })
  })

  describe('getNextExecutionTimes - cron mode', () => {
    test('uses cron parser for cron expressions', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: '0 12 * * *',
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      result.forEach((date) => {
        expect(date.getHours()).toBe(12)
        expect(date.getMinutes()).toBe(0)
      })
    })

    test('returns empty array for invalid cron expression', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: 'invalid',
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result).toEqual([])
    })

    test('returns empty array for missing cron expression', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: '',
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result).toEqual([])
    })
  })

  describe('getNextExecutionTimes - once frequency', () => {
    test('returns selected datetime for once frequency', () => {
      const selectedTime = new Date(2024, 0, 20, 15, 30, 0) // January 20, 2024 3:30 PM
      const data = createMockData({
        frequency: 'once',
        visual_config: {
          datetime: selectedTime.toISOString(),
        },
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result).toHaveLength(1)
      expect(result[0].getTime()).toBe(selectedTime.getTime())
    })

    test('returns empty array when no datetime selected for once frequency', () => {
      const data = createMockData({
        frequency: 'once',
        visual_config: {},
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result).toEqual([])
    })
  })

  describe('getNextExecutionTimes - fallback behavior', () => {
    test('handles unknown frequency by returning next days', () => {
      const data = createMockData({
        frequency: 'unknown' as any,
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      expect(result[0].getDate()).toBe(16)
      expect(result[1].getDate()).toBe(17)
      expect(result[2].getDate()).toBe(18)
    })
  })

  describe('getFormattedExecutionTimes', () => {
    test('formats daily execution times without weekday', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:30 PM' },
      })

      const result = getFormattedExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      expect(result[0]).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
      expect(result[0]).toMatch(/January \d+, 2024 2:30 PM/)
    })

    test('formats weekly execution times with weekday', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '2:30 PM',
          weekdays: ['sun'],
        },
      })

      const result = getFormattedExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      expect(result[0]).toMatch(/^Sun, January \d+, 2024 2:30 PM/)
    })

    test('formats hourly execution times without weekday', () => {
      const data = createMockData({
        frequency: 'hourly',
        visual_config: {
          datetime: new Date(2024, 0, 16, 14, 0, 0).toISOString(), // Local time 2:00 PM
          recur_every: 2,
          recur_unit: 'hours',
        },
      })

      const result = getFormattedExecutionTimes(data, 1)

      expect(result[0]).toMatch(/January 16, 2024 4:00 PM/)
      expect(result[0]).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
    })

    test('returns empty array when no execution times', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: 'invalid',
      })

      const result = getFormattedExecutionTimes(data, 5)

      expect(result).toEqual([])
    })
  })

  describe('getNextExecutionTime', () => {
    test('returns first formatted execution time', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:30 PM' },
      })

      const result = getNextExecutionTime(data)

      expect(result).toMatch(/January \d+, 2024 2:30 PM/)
    })

    test('returns current time when no execution times available for non-once frequencies', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: 'invalid',
      })

      const result = getNextExecutionTime(data)

      expect(result).toMatch(/January 15, 2024 10:00 AM/)
    })

    test('returns default datetime for once frequency when no datetime configured', () => {
      const data = createMockData({
        frequency: 'once',
        visual_config: {},
      })

      const result = getNextExecutionTime(data)

      expect(result).toMatch(/January 16, 2024 11:30 AM/)
    })

    test('returns configured datetime for once frequency when available', () => {
      const selectedTime = new Date(2024, 0, 20, 15, 30, 0)
      const data = createMockData({
        frequency: 'once',
        visual_config: {
          datetime: selectedTime.toISOString(),
        },
      })

      const result = getNextExecutionTime(data)

      expect(result).toMatch(/January 20, 2024 3:30 PM/)
    })

    test('applies correct weekday formatting based on frequency', () => {
      const weeklyData = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '2:30 PM',
          weekdays: ['sun'],
        },
      })

      const dailyData = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:30 PM' },
      })

      const weeklyResult = getNextExecutionTime(weeklyData)
      const dailyResult = getNextExecutionTime(dailyData)

      expect(weeklyResult).toMatch(/^Sun,/)
      expect(dailyResult).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
    })
  })

  describe('edge cases and error handling', () => {
    test('handles missing visual_config gracefully', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: undefined,
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result).toHaveLength(1)
    })

    test('uses default values for missing config properties', () => {
      const data = createMockData({
        frequency: 'hourly',
        visual_config: {},
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result).toHaveLength(1)
    })

    test('handles malformed time strings gracefully', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: 'invalid time' },
      })

      expect(() => getNextExecutionTimes(data, 1)).not.toThrow()
    })

    test('returns reasonable defaults for zero count', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:30 PM' },
      })

      const result = getNextExecutionTimes(data, 0)

      expect(result).toEqual([])
    })

    test('daily frequency should not have duplicate dates', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:30 PM' },
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result).toHaveLength(5)

      // Check that each date is unique and consecutive
      for (let i = 1; i < result.length; i++) {
        const prevDate = result[i - 1].getDate()
        const currDate = result[i].getDate()
        expect(currDate).not.toBe(prevDate) // No duplicates
        expect(currDate - prevDate).toBe(1) // Should be consecutive days
      }
    })
  })

  describe('getNextExecutionTimes - monthly frequency', () => {
    test('returns monthly execution times for specific day', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '2:30 PM',
          monthly_day: 15,
        },
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      result.forEach((date) => {
        expect(date.getDate()).toBe(15)
        expect(date.getHours()).toBe(14)
        expect(date.getMinutes()).toBe(30)
      })

      expect(result[0].getMonth()).toBe(0) // January
      expect(result[1].getMonth()).toBe(1) // February
      expect(result[2].getMonth()).toBe(2) // March
    })

    test('returns monthly execution times for last day', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '11:30 AM',
          monthly_day: 'last',
        },
      })

      const result = getNextExecutionTimes(data, 4)

      expect(result).toHaveLength(4)
      result.forEach((date) => {
        expect(date.getHours()).toBe(11)
        expect(date.getMinutes()).toBe(30)
      })

      expect(result[0].getDate()).toBe(31) // January 31
      expect(result[1].getDate()).toBe(29) // February 29 (2024 is leap year)
      expect(result[2].getDate()).toBe(31) // March 31
      expect(result[3].getDate()).toBe(30) // April 30
    })

    test('handles day 31 in months with fewer days', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '3:00 PM',
          monthly_day: 31,
        },
      })

      const result = getNextExecutionTimes(data, 4)

      expect(result).toHaveLength(4)
      expect(result[0].getDate()).toBe(31) // January 31
      expect(result[1].getDate()).toBe(29) // February 29 (can't have 31)
      expect(result[2].getDate()).toBe(31) // March 31
      expect(result[3].getDate()).toBe(30) // April 30 (can't have 31)
    })

    test('handles day 30 in February', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '9:00 AM',
          monthly_day: 30,
        },
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      expect(result[0].getDate()).toBe(30) // January 30
      expect(result[1].getDate()).toBe(29) // February 29 (max in 2024)
      expect(result[2].getDate()).toBe(30) // March 30
    })

    test('skips to next month if current month execution has passed', () => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date(2024, 0, 20, 15, 0, 0)) // January 20, 2024 3:00 PM

      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '2:30 PM',
          monthly_day: 15, // Already passed in January
        },
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      expect(result[0].getMonth()).toBe(1) // February (skip January)
      expect(result[1].getMonth()).toBe(2) // March
      expect(result[2].getMonth()).toBe(3) // April

      jest.useRealTimers()
    })

    test('includes current month if execution time has not passed', () => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date(2024, 0, 10, 10, 0, 0)) // January 10, 2024 10:00 AM

      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '2:30 PM',
          monthly_day: 15, // Still upcoming in January
        },
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      expect(result[0].getMonth()).toBe(0) // January (current month)
      expect(result[1].getMonth()).toBe(1) // February
      expect(result[2].getMonth()).toBe(2) // March

      jest.useRealTimers()
    })

    test('handles AM/PM time conversion correctly', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '11:30 PM',
          monthly_day: 1,
        },
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      result.forEach((date) => {
        expect(date.getHours()).toBe(23) // 11 PM in 24-hour format
        expect(date.getMinutes()).toBe(30)
        expect(date.getDate()).toBe(1)
      })
    })

    test('formats monthly execution times without weekday', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '2:30 PM',
          monthly_day: 15,
        },
      })

      const result = getFormattedExecutionTimes(data, 1)

      expect(result).toHaveLength(1)
      expect(result[0]).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
      expect(result[0]).toMatch(/January 15, 2024 2:30 PM/)
    })

    test('uses default day 1 when monthly_day is not specified', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '10:00 AM',
        },
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      result.forEach((date) => {
        expect(date.getDate()).toBe(1)
        expect(date.getHours()).toBe(10)
        expect(date.getMinutes()).toBe(0)
      })
    })
  })

  describe('getDefaultDateTime', () => {
    test('returns consistent default datetime', () => {
      const defaultDate = getDefaultDateTime()

      expect(defaultDate.getHours()).toBe(11)
      expect(defaultDate.getMinutes()).toBe(30)
      expect(defaultDate.getSeconds()).toBe(0)
      expect(defaultDate.getMilliseconds()).toBe(0)
      expect(defaultDate.getDate()).toBe(new Date().getDate() + 1)
    })

    test('default datetime matches DateTimePicker fallback behavior', () => {
      const data = createMockData({
        frequency: 'once',
        visual_config: {},
      })

      const nextExecutionTime = getNextExecutionTime(data)
      const defaultDate = getDefaultDateTime()
      const expectedFormat = formatExecutionTime(defaultDate, false)

      expect(nextExecutionTime).toBe(expectedFormat)
    })
  })
})
