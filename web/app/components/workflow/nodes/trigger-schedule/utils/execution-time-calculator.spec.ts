import { formatExecutionTime, getDefaultDateTime, getFormattedExecutionTimes, getNextExecutionTime, getNextExecutionTimes } from './execution-time-calculator'
import type { ScheduleTriggerNodeType } from '../types'

const createMockData = (overrides: Partial<ScheduleTriggerNodeType> = {}): ScheduleTriggerNodeType => ({
  id: 'test-node',
  type: 'schedule-trigger',
  mode: 'visual',
  frequency: 'daily',
  visual_config: {
    time: '2:30 PM',
  },
  timezone: 'UTC',
  enabled: true,
  ...overrides,
})

describe('execution-time-calculator', () => {
  describe('formatExecutionTime', () => {
    test('formats time with weekday by default', () => {
      const date = new Date(2024, 0, 16, 14, 30)
      const result = formatExecutionTime(date, 'UTC')

      expect(result).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
      expect(result).toContain('January 16, 2024')
      expect(result).toMatch(/\d{1,2}:\d{2} (AM|PM)/)
    })

    test('formats time without weekday when specified', () => {
      const date = new Date(2024, 0, 16, 14, 30)
      const result = formatExecutionTime(date, 'UTC', false)

      expect(result).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
      expect(result).toContain('January 16, 2024')
      expect(result).toMatch(/\d{1,2}:\d{2} (AM|PM)/)
    })

    test('handles different timezones correctly', () => {
      const date = new Date(Date.UTC(2024, 0, 16, 18, 0))
      const utcResult = formatExecutionTime(date, 'UTC')
      const easternResult = formatExecutionTime(date, 'America/New_York')

      expect(utcResult).toBeDefined()
      expect(easternResult).toBeDefined()
      expect(utcResult).not.toBe(easternResult)
    })

    test('handles invalid timezone gracefully', () => {
      const date = new Date(2024, 0, 16, 14, 30)
      const result = formatExecutionTime(date, 'Invalid/Timezone')

      expect(result).toBeDefined()
      expect(typeof result).toBe('string')
    })
  })

  describe('getNextExecutionTimes - hourly frequency', () => {
    test('generates sequential hourly times with specified minute', () => {
      const data = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 30 },
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result).toHaveLength(5)
      expect(result[0].getHours()).toBe(0)
      expect(result[0].getMinutes()).toBe(30)
      expect(result[1].getHours()).toBe(1)
      expect(result[1].getMinutes()).toBe(30)
      expect(result[4].getHours()).toBe(4)
      expect(result[4].getMinutes()).toBe(30)
    })

    test('defaults to minute 0 when on_minute not specified', () => {
      const data = createMockData({
        frequency: 'hourly',
        visual_config: {},
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      result.forEach((date) => {
        expect(date.getMinutes()).toBe(0)
      })
    })

    test('handles boundary minute values', () => {
      const data0 = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 0 },
      })
      const data59 = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 59 },
      })

      const result0 = getNextExecutionTimes(data0, 2)
      const result59 = getNextExecutionTimes(data59, 2)

      expect(result0[0].getMinutes()).toBe(0)
      expect(result0[1].getMinutes()).toBe(0)
      expect(result59[0].getMinutes()).toBe(59)
      expect(result59[1].getMinutes()).toBe(59)
    })

    test('uses user timezone for base date calculation', () => {
      const utcData = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 15 },
        timezone: 'UTC',
      })
      const easternData = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 15 },
        timezone: 'America/New_York',
      })

      const utcResult = getNextExecutionTimes(utcData, 1)
      const easternResult = getNextExecutionTimes(easternData, 1)

      expect(utcResult[0].getMinutes()).toBe(15)
      expect(easternResult[0].getMinutes()).toBe(15)
    })
  })

  describe('getNextExecutionTimes - daily frequency', () => {
    test('generates daily times with configured time', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '9:15 AM' },
      })

      const result = getNextExecutionTimes(data, 4)

      expect(result).toHaveLength(4)
      result.forEach((date, index) => {
        expect(date.getHours()).toBe(9)
        expect(date.getMinutes()).toBe(15)
        if (index > 0)
          expect(date.getDate()).toBe(result[0].getDate() + index)
      })
    })

    test('handles AM/PM conversion correctly', () => {
      const dataAM = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:30 AM' },
      })
      const dataPM = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:30 PM' },
      })

      const resultAM = getNextExecutionTimes(dataAM, 1)
      const resultPM = getNextExecutionTimes(dataPM, 1)

      expect(resultAM[0].getHours()).toBe(0)
      expect(resultAM[0].getMinutes()).toBe(30)
      expect(resultPM[0].getHours()).toBe(12)
      expect(resultPM[0].getMinutes()).toBe(30)
    })

    test('handles edge case times', () => {
      const data1159PM = createMockData({
        frequency: 'daily',
        visual_config: { time: '11:59 PM' },
      })
      const data1201AM = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:01 AM' },
      })

      const result1159PM = getNextExecutionTimes(data1159PM, 1)
      const result1201AM = getNextExecutionTimes(data1201AM, 1)

      expect(result1159PM[0].getHours()).toBe(23)
      expect(result1159PM[0].getMinutes()).toBe(59)
      expect(result1201AM[0].getHours()).toBe(0)
      expect(result1201AM[0].getMinutes()).toBe(1)
    })

    test('defaults to 11:30 AM when time not specified', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: {},
      })

      const result = getNextExecutionTimes(data, 1)

      expect(result[0].getHours()).toBe(11)
      expect(result[0].getMinutes()).toBe(30)
    })

    test('uses user timezone for date calculation', () => {
      const utcData = createMockData({
        frequency: 'daily',
        visual_config: { time: '6:00 PM' },
        timezone: 'UTC',
      })
      const tokyoData = createMockData({
        frequency: 'daily',
        visual_config: { time: '6:00 PM' },
        timezone: 'Asia/Tokyo',
      })

      const utcResult = getNextExecutionTimes(utcData, 2)
      const tokyoResult = getNextExecutionTimes(tokyoData, 2)

      expect(utcResult).toHaveLength(2)
      expect(tokyoResult).toHaveLength(2)
      expect(utcResult[0].getHours()).toBe(18)
      expect(tokyoResult[0].getHours()).toBe(18)
    })
  })

  describe('getNextExecutionTimes - weekly frequency', () => {
    test('generates weekly times for single day', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '3:45 PM',
          weekdays: ['tue'],
        },
      })

      const result = getNextExecutionTimes(data, 4)

      expect(result).toHaveLength(4)
      result.forEach((date) => {
        expect(date.getDay()).toBe(2) // Tuesday
        expect(date.getHours()).toBe(15)
        expect(date.getMinutes()).toBe(45)
      })
    })

    test('generates weekly times for multiple days', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '10:00 AM',
          weekdays: ['mon', 'wed', 'fri'],
        },
      })

      const result = getNextExecutionTimes(data, 6)

      expect(result).toHaveLength(6)
      result.forEach((date) => {
        expect([1, 3, 5]).toContain(date.getDay())
        expect(date.getHours()).toBe(10)
        expect(date.getMinutes()).toBe(0)
      })
    })

    test('sorts results chronologically', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '2:00 PM',
          weekdays: ['fri', 'mon', 'wed'],
        },
      })

      const result = getNextExecutionTimes(data, 6)

      for (let i = 1; i < result.length; i++)
        expect(result[i].getTime()).toBeGreaterThan(result[i - 1].getTime())
    })

    test('handles all days of week', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '8:30 AM',
          weekdays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
        },
      })

      const result = getNextExecutionTimes(data, 7)

      const days = result.map(date => date.getDay()).sort()
      expect(days).toEqual([0, 1, 2, 3, 4, 5, 6])
    })

    test('defaults to sunday when weekdays not specified', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: { time: '12:00 PM' },
      })

      const result = getNextExecutionTimes(data, 3)

      result.forEach((date) => {
        expect(date.getDay()).toBe(0) // Sunday
      })
    })

    test('returns empty array for empty weekdays', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '12:00 PM',
          weekdays: [],
        },
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result).toHaveLength(0)
    })
  })

  describe('getNextExecutionTimes - monthly frequency', () => {
    test('generates monthly times for specific day', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '4:20 PM',
          monthly_days: [15],
        },
      })

      const result = getNextExecutionTimes(data, 4)

      expect(result).toHaveLength(4)
      result.forEach((date, index) => {
        expect(date.getDate()).toBe(15)
        expect(date.getHours()).toBe(16)
        expect(date.getMinutes()).toBe(20)
        if (index > 0)
          expect(date.getMonth()).toBeGreaterThan(result[index - 1].getMonth())
      })
    })

    test('handles last day of month', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '11:00 PM',
          monthly_days: ['last'],
        },
      })

      const result = getNextExecutionTimes(data, 4)

      expect(result).toHaveLength(4)
      result.forEach((date) => {
        const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0)
        expect(date.getDate()).toBe(nextMonth.getDate())
        expect(date.getHours()).toBe(23)
        expect(date.getMinutes()).toBe(0)
      })
    })

    test('handles multiple monthly days', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '7:30 AM',
          monthly_days: [1, 15, 'last'],
        },
      })

      const result = getNextExecutionTimes(data, 6)

      expect(result).toHaveLength(6)
      result.forEach((date) => {
        expect(date.getHours()).toBe(7)
        expect(date.getMinutes()).toBe(30)
        expect([1, 15]).toContain(date.getDate())
        || expect(date.getDate()).toBeGreaterThan(28) // last day
      })
    })

    test('skips invalid days for short months', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '1:00 PM',
          monthly_days: [31],
        },
      })

      const result = getNextExecutionTimes(data, 12)

      result.forEach((date) => {
        expect(date.getDate()).toBe(31)
        expect([0, 2, 4, 6, 7, 9, 11]).toContain(date.getMonth()) // months with 31 days
      })
    })

    test('removes duplicate days within same month', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '9:00 AM',
          monthly_days: [15, 15, 15],
        },
      })

      const result = getNextExecutionTimes(data, 4)

      const firstMonthDates = result.filter(date => date.getMonth() === result[0].getMonth())
      expect(firstMonthDates).toHaveLength(1)
    })

    test('defaults to day 1 when monthly_days not specified', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: { time: '5:45 PM' },
      })

      const result = getNextExecutionTimes(data, 3)

      result.forEach((date) => {
        expect(date.getDate()).toBe(1)
      })
    })

    test('defaults to day 1 when monthly_days is empty', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '5:45 PM',
          monthly_days: [],
        },
      })

      const result = getNextExecutionTimes(data, 3)

      result.forEach((date) => {
        expect(date.getDate()).toBe(1)
      })
    })
  })

  describe('getNextExecutionTimes - cron mode', () => {
    test('uses cron parser for valid expressions', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: '30 14 * * *',
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result.length).toBeGreaterThan(0)
      result.forEach((date) => {
        expect(date.getHours()).toBe(14)
        expect(date.getMinutes()).toBe(30)
      })
    })

    test('returns empty array for invalid cron expression', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: 'invalid cron',
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result).toEqual([])
    })

    test('returns empty array for empty cron expression', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: '',
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result).toEqual([])
    })

    test('returns empty array for missing cron expression', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: undefined as any,
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result).toEqual([])
    })

    test('handles complex cron expressions', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: '0 */6 * * 1-5',
      })

      const result = getNextExecutionTimes(data, 10)

      expect(result.length).toBeGreaterThan(0)
      result.forEach((date) => {
        expect(date.getMinutes()).toBe(0)
        expect([0, 6, 12, 18]).toContain(date.getHours())
        expect([1, 2, 3, 4, 5]).toContain(date.getDay()) // Monday to Friday
      })
    })
  })

  describe('getNextExecutionTimes - fallback behavior', () => {
    test('handles unknown frequency by returning sequential days', () => {
      const data = createMockData({
        frequency: 'unknown' as any,
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result).toHaveLength(3)
      expect(result[1].getDate()).toBe(result[0].getDate() + 1)
      expect(result[2].getDate()).toBe(result[1].getDate() + 1)
    })

    test('returns empty array for zero count', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 PM' },
      })

      const result = getNextExecutionTimes(data, 0)

      expect(result).toEqual([])
    })

    test('handles negative count gracefully', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 PM' },
      })

      const result = getNextExecutionTimes(data, -1)

      expect(result).toEqual([])
    })
  })

  describe('getFormattedExecutionTimes', () => {
    test('formats execution times correctly', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:30 PM' },
        timezone: 'UTC',
      })

      const result = getFormattedExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      result.forEach((timeStr) => {
        expect(timeStr).toContain('2:30 PM')
        expect(timeStr).toMatch(/\d{4}/) // contains year
      })
    })

    test('includes weekday for weekly frequency', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '10:00 AM',
          weekdays: ['tue'],
        },
        timezone: 'UTC',
      })

      const result = getFormattedExecutionTimes(data, 2)

      result.forEach((timeStr) => {
        expect(timeStr).toMatch(/^Tue/)
      })
    })

    test('excludes weekday for non-weekly frequencies', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '10:00 AM' },
        timezone: 'UTC',
      })

      const result = getFormattedExecutionTimes(data, 2)

      result.forEach((timeStr) => {
        expect(timeStr).not.toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/)
      })
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
        visual_config: { time: '3:15 PM' },
        timezone: 'UTC',
      })

      const result = getNextExecutionTime(data)

      expect(result).toContain('3:15 PM')
      expect(result).toMatch(/\d{4}/)
    })

    test('returns fallback time when no execution times available', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: 'invalid',
        timezone: 'UTC',
      })

      const result = getNextExecutionTime(data)

      expect(result).toBeDefined()
      expect(result).toMatch(/\d{4}/)
    })

    test('applies correct weekday formatting', () => {
      const weeklyData = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '4:00 PM',
          weekdays: ['fri'],
        },
        timezone: 'UTC',
      })

      const dailyData = createMockData({
        frequency: 'daily',
        visual_config: { time: '4:00 PM' },
        timezone: 'UTC',
      })

      const weeklyResult = getNextExecutionTime(weeklyData)
      const dailyResult = getNextExecutionTime(dailyData)

      expect(weeklyResult).toMatch(/^Fri/)
      expect(dailyResult).not.toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/)
    })
  })

  describe('getDefaultDateTime', () => {
    test('returns fixed default datetime', () => {
      const defaultDate = getDefaultDateTime()

      expect(defaultDate.getFullYear()).toBe(2024)
      expect(defaultDate.getMonth()).toBe(0) // January
      expect(defaultDate.getDate()).toBe(2)
      expect(defaultDate.getHours()).toBe(11)
      expect(defaultDate.getMinutes()).toBe(30)
      expect(defaultDate.getSeconds()).toBe(0)
      expect(defaultDate.getMilliseconds()).toBe(0)
    })
  })

  describe('error handling and edge cases', () => {
    test('handles missing visual_config gracefully', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: undefined,
      })

      expect(() => getNextExecutionTimes(data, 1)).not.toThrow()
      const result = getNextExecutionTimes(data, 1)
      expect(result).toHaveLength(1)
    })

    test('handles malformed time strings gracefully', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: 'invalid time format' },
      })

      expect(() => getNextExecutionTimes(data, 1)).not.toThrow()
    })

    test('handles invalid timezone gracefully', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 PM' },
        timezone: 'Invalid/Timezone',
      })

      expect(() => getFormattedExecutionTimes(data, 1)).not.toThrow()
      const result = getFormattedExecutionTimes(data, 1)
      expect(result).toHaveLength(1)
    })

    test('handles very large count values', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 PM' },
      })

      const result = getNextExecutionTimes(data, 1000)
      expect(result).toHaveLength(1000)
    })

    test('handles edge case monthly days consistently', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '12:00 PM',
          monthly_days: [29, 30, 31, 'last'],
        },
      })

      const result = getNextExecutionTimes(data, 24) // 2 years worth
      expect(result.length).toBeGreaterThan(0)

      // February should only have 'last' day executions
      const februaryExecutions = result.filter(date => date.getMonth() === 1)
      februaryExecutions.forEach((date) => {
        expect(date.getDate()).toBeGreaterThanOrEqual(28)
      })
    })

    test('timezone conversion preserves configured time semantics', () => {
      const utcData = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 PM' },
        timezone: 'UTC',
      })

      const nyData = createMockData({
        frequency: 'daily',
        visual_config: { time: '12:00 PM' },
        timezone: 'America/New_York',
      })

      const utcTimes = getNextExecutionTimes(utcData, 1)
      const nyTimes = getNextExecutionTimes(nyData, 1)

      // Both should be at 12:00 in their respective local representation
      expect(utcTimes[0].getHours()).toBe(12)
      expect(nyTimes[0].getHours()).toBe(12)

      // But when formatted in their respective timezones, both should show 12:00 PM
      const utcFormatted = getFormattedExecutionTimes(utcData, 1)
      const nyFormatted = getFormattedExecutionTimes(nyData, 1)

      expect(utcFormatted[0]).toContain('12:00 PM')
      expect(nyFormatted[0]).toContain('12:00 PM')
    })
  })
})
