import { formatExecutionTime, getDefaultDateTime, getFormattedExecutionTimes, getNextExecutionTime, getNextExecutionTimes } from './execution-time-calculator'
import type { ScheduleTriggerNodeType } from '../types'

const createMockData = (overrides: Partial<ScheduleTriggerNodeType> = {}): ScheduleTriggerNodeType => ({
  id: 'test-node',
  type: 'schedule-trigger',
  mode: 'visual',
  frequency: 'weekly',
  visual_config: {
    time: '11:30 AM',
    weekdays: ['sun'],
  },
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  enabled: true,
  ...overrides,
})

describe('execution-time-calculator', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(2024, 0, 15, 10, 0, 0))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('formatExecutionTime', () => {
    const testTimezone = 'America/New_York'

    test('formats time with weekday by default', () => {
      const date = new Date(2024, 0, 16, 14, 30)
      const result = formatExecutionTime(date, testTimezone)

      expect(result).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
      expect(result).toContain('January 16, 2024')
    })

    test('formats time without weekday when specified', () => {
      const date = new Date(2024, 0, 16, 14, 30)
      const result = formatExecutionTime(date, testTimezone, false)

      expect(result).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
      expect(result).toContain('January 16, 2024')
    })

    test('handles different timezones correctly', () => {
      const date = new Date(2024, 0, 16, 14, 30)
      const utcResult = formatExecutionTime(date, 'UTC')
      const easternResult = formatExecutionTime(date, 'America/New_York')

      expect(utcResult).toBeDefined()
      expect(easternResult).toBeDefined()
    })
  })

  describe('getNextExecutionTimes - hourly frequency', () => {
    test('calculates hourly executions at specified minute', () => {
      const data = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 30 },
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      result.forEach((date) => {
        expect(date.getMinutes()).toBe(30)
      })
    })

    test('handles current minute less than target minute', () => {
      jest.setSystemTime(new Date(2024, 0, 15, 10, 15, 0))

      const data = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 30 },
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result[0].getHours()).toBe(10)
      expect(result[0].getMinutes()).toBe(30)
      expect(result[1].getHours()).toBe(11)
      expect(result[1].getMinutes()).toBe(30)
    })

    test('handles current minute greater than target minute', () => {
      jest.setSystemTime(new Date(2024, 0, 15, 10, 45, 0))

      const data = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 30 },
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result[0].getHours()).toBe(11)
      expect(result[0].getMinutes()).toBe(30)
      expect(result[1].getHours()).toBe(12)
      expect(result[1].getMinutes()).toBe(30)
    })

    test('defaults to minute 0 when on_minute not specified', () => {
      const data = createMockData({
        frequency: 'hourly',
        visual_config: {},
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result[0].getMinutes()).toBe(0)
    })

    test('handles boundary minute values', () => {
      const data1 = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 0 },
      })
      const data59 = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 59 },
      })

      const result1 = getNextExecutionTimes(data1, 1)
      const result59 = getNextExecutionTimes(data59, 1)

      expect(result1[0].getMinutes()).toBe(0)
      expect(result59[0].getMinutes()).toBe(59)
    })
  })

  describe('getNextExecutionTimes - daily frequency', () => {
    test('calculates next daily executions', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:30 PM' },
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      result.forEach((date) => {
        expect(date.getHours()).toBe(14)
        expect(date.getMinutes()).toBe(30)
      })
      expect(result[1].getDate()).toBe(result[0].getDate() + 1)
    })

    test('handles past time by moving to next day', () => {
      jest.setSystemTime(new Date(2024, 0, 15, 15, 0, 0))

      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:30 PM' },
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result[0].getDate()).toBe(16)
    })

    test('handles timezone-aware time comparison correctly', () => {
      // Simulate user scenario: Aug 23, 6:00 PM, setting 11:30 AM
      jest.setSystemTime(new Date(2024, 7, 23, 18, 0, 0)) // Aug 23, 6:00 PM

      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '11:30 AM' },
      })

      const result = getNextExecutionTimes(data, 1)

      // Should be tomorrow (Aug 24) since 11:30 AM has already passed today
      expect(result[0].getDate()).toBe(24)
    })

    test('handles future time on same day correctly', () => {
      // Simulate: Aug 23, 11:29 AM, setting 11:30 AM
      jest.setSystemTime(new Date(2024, 7, 23, 11, 29, 0))

      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '11:30 AM' },
      })

      const result = getNextExecutionTimes(data, 1)

      // Should be today (Aug 23) since 11:30 AM hasn't passed yet
      expect(result[0].getDate()).toBe(23)
    })

    test('handles AM/PM conversion correctly', () => {
      const dataAM = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 AM' },
      })
      const dataPM = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 PM' },
      })

      const resultAM = getNextExecutionTimes(dataAM, 1)
      const resultPM = getNextExecutionTimes(dataPM, 1)

      expect(resultAM[0].getHours()).toBe(0)
      expect(resultPM[0].getHours()).toBe(12)
    })
  })

  describe('getNextExecutionTimes - weekly frequency', () => {
    test('calculates weekly executions for multiple days', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '2:30 PM',
          weekdays: ['mon', 'wed', 'fri'],
        },
      })

      const result = getNextExecutionTimes(data, 6)

      result.forEach((date) => {
        expect([1, 3, 5]).toContain(date.getDay())
        expect(date.getHours()).toBe(14)
        expect(date.getMinutes()).toBe(30)
      })
    })

    test('calculates weekly executions for single day', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '2:30 PM',
          weekdays: ['sun'],
        },
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      result.forEach((date) => {
        expect(date.getDay()).toBe(0)
      })
    })

    test('handles current day execution', () => {
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

    test('sorts results chronologically', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '9:00 AM',
          weekdays: ['fri', 'mon', 'wed'],
        },
      })

      const result = getNextExecutionTimes(data, 6)

      for (let i = 1; i < result.length; i++)
        expect(result[i].getTime()).toBeGreaterThan(result[i - 1].getTime())
    })
  })

  describe('getNextExecutionTimes - monthly frequency', () => {
    test('calculates monthly executions for specific day', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '2:30 PM',
          monthly_days: [15],
        },
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      result.forEach((date) => {
        expect(date.getDate()).toBe(15)
        expect(date.getHours()).toBe(14)
        expect(date.getMinutes()).toBe(30)
      })
    })

    test('handles last day of month', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '11:30 AM',
          monthly_days: ['last'],
        },
      })

      const result = getNextExecutionTimes(data, 4)

      expect(result[0].getDate()).toBe(31)
      expect(result[1].getDate()).toBe(29)
      expect(result[2].getDate()).toBe(31)
      expect(result[3].getDate()).toBe(30)
    })

    test('handles multiple monthly days', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '10:00 AM',
          monthly_days: [1, 15, 'last'],
        },
      })

      const result = getNextExecutionTimes(data, 6)

      expect(result).toHaveLength(6)
      result.forEach((date) => {
        expect(date.getHours()).toBe(10)
        expect(date.getMinutes()).toBe(0)
      })
    })

    test('defaults to day 1 when monthly_days not specified', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: { time: '10:00 AM' },
      })

      const result = getNextExecutionTimes(data, 2)

      result.forEach((date) => {
        expect(date.getDate()).toBe(1)
      })
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

    test('filters past cron times based on user timezone', () => {
      // Mock system time to 2 PM (14:00)
      jest.setSystemTime(new Date(2024, 7, 23, 14, 0, 0))

      const data = createMockData({
        mode: 'cron',
        cron_expression: '0 12 * * *', // Every day at 12 PM (noon)
      })

      const result = getNextExecutionTimes(data, 1, { timezone: 'UTC' })

      // Should get tomorrow at 12 PM since today's 12 PM has passed
      expect(result).toHaveLength(1)
      expect(result[0].getDate()).toBe(24) // Tomorrow
      expect(result[0].getUTCHours()).toBe(12)
    })

    test('includes today cron time if it has not passed yet', () => {
      // Mock system time to 10 AM
      jest.setSystemTime(new Date(2024, 7, 23, 10, 0, 0))

      const data = createMockData({
        mode: 'cron',
        cron_expression: '0 12 * * *', // Every day at 12 PM (noon)
      })

      const result = getNextExecutionTimes(data, 1, { timezone: 'UTC' })

      // Should get today at 12 PM since it hasn't passed yet
      expect(result).toHaveLength(1)
      expect(result[0].getDate()).toBe(23) // Today
      expect(result[0].getUTCHours()).toBe(12)
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
        timezone: 'UTC',
      })

      const result = getFormattedExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      result.forEach((timeStr) => {
        expect(timeStr).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
        expect(timeStr).toContain('2024')
      })
    })

    test('formats weekly execution times with weekday', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '2:30 PM',
          weekdays: ['sun'],
        },
        timezone: 'UTC',
      })

      const result = getFormattedExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      result.forEach((timeStr) => {
        expect(timeStr).toMatch(/^Sun/)
        expect(timeStr).toContain('2024')
      })
    })

    test('formats hourly execution times without weekday', () => {
      const data = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 15 },
        timezone: 'UTC',
      })

      const result = getFormattedExecutionTimes(data, 1)

      expect(result).toHaveLength(1)
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
        timezone: 'UTC',
      })

      const result = getNextExecutionTime(data)

      expect(result).toContain('2024')
    })

    test('returns current time when no execution times available', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: 'invalid',
        timezone: 'UTC',
      })

      const result = getNextExecutionTime(data)

      expect(result).toContain('2024')
    })

    test('applies correct weekday formatting based on frequency', () => {
      const weeklyData = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '2:30 PM',
          weekdays: ['sun'],
        },
        timezone: 'UTC',
      })

      const dailyData = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:30 PM' },
        timezone: 'UTC',
      })

      const weeklyResult = getNextExecutionTime(weeklyData)
      const dailyResult = getNextExecutionTime(dailyData)

      expect(weeklyResult).toMatch(/^Sun/)
      expect(dailyResult).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
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

    test('default datetime is tomorrow at 11:30 AM', () => {
      const today = new Date()
      const defaultDate = getDefaultDateTime()

      expect(defaultDate.getDate()).toBe(today.getDate() + 1)
      expect(defaultDate.getHours()).toBe(11)
      expect(defaultDate.getMinutes()).toBe(30)
    })
  })

  describe('timezone handling', () => {
    test('handles different timezones in execution calculations', () => {
      const utcData = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 PM' },
        timezone: 'UTC',
      })

      const easternData = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 PM' },
        timezone: 'America/New_York',
      })

      const utcResult = getNextExecutionTimes(utcData, 1)
      const easternResult = getNextExecutionTimes(easternData, 1)

      expect(utcResult).toHaveLength(1)
      expect(easternResult).toHaveLength(1)
    })

    test('formats times correctly for different timezones', () => {
      const date = new Date(2024, 0, 16, 12, 0, 0)

      const utcFormatted = formatExecutionTime(date, 'UTC')
      const easternFormatted = formatExecutionTime(date, 'America/New_York')

      expect(utcFormatted).toBeDefined()
      expect(easternFormatted).toBeDefined()
      expect(utcFormatted).not.toBe(easternFormatted)
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

    test('hourly frequency handles missing on_minute', () => {
      const data = createMockData({
        frequency: 'hourly',
        visual_config: {},
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result).toHaveLength(1)
      expect(result[0].getMinutes()).toBe(0)
    })

    test('weekly frequency handles empty weekdays', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '2:30 PM',
          weekdays: [],
        },
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(0)
    })

    test('monthly frequency handles invalid monthly_days', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '2:30 PM',
          monthly_days: [],
        },
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      result.forEach((date) => {
        expect(date.getDate()).toBe(1)
      })
    })
  })

  describe('backend field mapping', () => {
    test('hourly mode only sends on_minute field', () => {
      const data = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 45 },
        timezone: 'America/New_York',
      })

      expect(data.visual_config?.on_minute).toBe(45)
      expect(data.visual_config?.time).toBeUndefined()
      expect(data.visual_config?.weekdays).toBeUndefined()
      expect(data.visual_config?.monthly_days).toBeUndefined()
      expect(data.timezone).toBe('America/New_York')
    })

    test('daily mode only sends time field', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '3:15 PM' },
        timezone: 'UTC',
      })

      expect(data.visual_config?.time).toBe('3:15 PM')
      expect(data.visual_config?.on_minute).toBeUndefined()
      expect(data.visual_config?.weekdays).toBeUndefined()
      expect(data.visual_config?.monthly_days).toBeUndefined()
      expect(data.timezone).toBe('UTC')
    })

    test('weekly mode sends time and weekdays fields', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '9:00 AM',
          weekdays: ['mon', 'wed', 'fri'],
        },
        timezone: 'Europe/London',
      })

      expect(data.visual_config?.time).toBe('9:00 AM')
      expect(data.visual_config?.weekdays).toEqual(['mon', 'wed', 'fri'])
      expect(data.visual_config?.on_minute).toBeUndefined()
      expect(data.visual_config?.monthly_days).toBeUndefined()
      expect(data.timezone).toBe('Europe/London')
    })

    test('monthly mode sends time and monthly_days fields', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '12:00 PM',
          monthly_days: [1, 15, 'last'],
        },
        timezone: 'Asia/Tokyo',
      })

      expect(data.visual_config?.time).toBe('12:00 PM')
      expect(data.visual_config?.monthly_days).toEqual([1, 15, 'last'])
      expect(data.visual_config?.on_minute).toBeUndefined()
      expect(data.visual_config?.weekdays).toBeUndefined()
      expect(data.timezone).toBe('Asia/Tokyo')
    })

    test('cron mode only sends cron_expression', () => {
      const data: ScheduleTriggerNodeType = {
        id: 'test-node',
        type: 'schedule-trigger',
        mode: 'cron',
        cron_expression: '0 */6 * * *',
        timezone: 'America/Los_Angeles',
        enabled: true,
      }

      expect(data.cron_expression).toBe('0 */6 * * *')
      expect(data.visual_config?.time).toBeUndefined()
      expect(data.visual_config?.on_minute).toBeUndefined()
      expect(data.visual_config?.weekdays).toBeUndefined()
      expect(data.visual_config?.monthly_days).toBeUndefined()
      expect(data.timezone).toBe('America/Los_Angeles')
    })

    test('all modes include basic trigger fields', () => {
      const data = createMockData({
        id: 'trigger-123',
        type: 'schedule-trigger',
        enabled: false,
        frequency: 'daily',
        mode: 'visual',
        timezone: 'UTC',
      })

      expect(data.id).toBe('trigger-123')
      expect(data.type).toBe('schedule-trigger')
      expect(data.enabled).toBe(false)
      expect(data.frequency).toBe('daily')
      expect(data.mode).toBe('visual')
      expect(data.timezone).toBe('UTC')
    })
  })

  describe('timezone conversion', () => {
    test('execution times are calculated in user timezone', () => {
      const easternData = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 PM' },
        timezone: 'America/New_York',
      })

      const pacificData = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 PM' },
        timezone: 'America/Los_Angeles',
      })

      const easternTimes = getNextExecutionTimes(easternData, 1)
      const pacificTimes = getNextExecutionTimes(pacificData, 1)

      expect(easternTimes).toHaveLength(1)
      expect(pacificTimes).toHaveLength(1)
    })

    test('formatted times display in user timezone', () => {
      // Mock system time to ensure consistent test results
      jest.setSystemTime(new Date('2024-01-15T10:00:00.000Z'))

      const utcData = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:00 PM' },
        timezone: 'UTC',
      })

      const easternData = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:00 PM' },
        timezone: 'America/New_York',
      })

      const utcFormatted = getFormattedExecutionTimes(utcData, 1)
      const easternFormatted = getFormattedExecutionTimes(easternData, 1)

      expect(utcFormatted).toHaveLength(1)
      expect(easternFormatted).toHaveLength(1)

      // Both should show 2:00 PM in their respective timezones, but at different UTC times
      // UTC 2:00 PM shows in UTC, Eastern 2:00 PM shows in Eastern timezone
      expect(utcFormatted[0]).toContain('2:00 PM')
      expect(easternFormatted[0]).toContain('2:00 PM')

      // The key difference should be in the date part or timezone handling
      // At minimum they should format consistently within their timezones
      expect(typeof utcFormatted[0]).toBe('string')
      expect(typeof easternFormatted[0]).toBe('string')
      expect(utcFormatted[0].length).toBeGreaterThan(0)
      expect(easternFormatted[0].length).toBeGreaterThan(0)
    })

    test('handles timezone edge cases', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '11:59 PM' },
        timezone: 'Pacific/Honolulu',
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result).toHaveLength(1)
      // Hawaii 11:59 PM = UTC 09:59 AM (next day due to -10 hour offset)
      expect(result[0].getUTCHours()).toBe(9)
      expect(result[0].getUTCMinutes()).toBe(59)
    })
  })
})
