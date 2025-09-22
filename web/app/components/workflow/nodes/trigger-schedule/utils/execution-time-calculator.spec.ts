import {
  getDefaultDateTime,
  getNextExecutionTime,
  getNextExecutionTimes,
} from './execution-time-calculator'
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
  ...overrides,
})

describe('execution-time-calculator', () => {
  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2024-01-15T10:00:00Z'))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('getDefaultDateTime', () => {
    it('returns consistent default datetime', () => {
      const defaultDate = getDefaultDateTime()
      expect(defaultDate.getFullYear()).toBe(2024)
      expect(defaultDate.getMonth()).toBe(0)
      expect(defaultDate.getDate()).toBe(2)
    })
  })

  describe('daily frequency', () => {
    it('generates daily executions at configured time', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '9:15 AM' },
        timezone: 'UTC',
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      expect(result[0].getHours()).toBe(9)
      expect(result[0].getMinutes()).toBe(15)
    })

    it('skips today if time has passed', () => {
      jest.setSystemTime(new Date('2024-01-15T15:00:00Z'))

      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '2:30 PM' },
        timezone: 'UTC',
      })

      const result = getNextExecutionTimes(data, 2)
      expect(result[0].getDate()).toBe(16) // Tomorrow
    })
  })

  describe('hourly frequency', () => {
    it('generates hourly executions', () => {
      const data = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 30 },
        timezone: 'UTC',
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result).toHaveLength(2)
      expect(result[0].getMinutes()).toBe(30)
      expect(result[1].getMinutes()).toBe(30)
    })
  })

  describe('cron mode', () => {
    it('handles valid cron expressions', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: '30 14 * * *',
        timezone: 'UTC',
      })

      const result = getNextExecutionTimes(data, 2)

      expect(result.length).toBeGreaterThan(0)
      if (result.length > 0) {
        expect(result[0].getHours()).toBe(14)
        expect(result[0].getMinutes()).toBe(30)
      }
    })

    it('returns empty for invalid cron', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: 'invalid',
        timezone: 'UTC',
      })

      const result = getNextExecutionTimes(data, 2)
      expect(result).toEqual([])
    })
  })

  describe('getNextExecutionTime', () => {
    it('returns formatted time string', () => {
      const data = createMockData({
        frequency: 'daily',
        visual_config: { time: '3:15 PM' },
        timezone: 'UTC',
      })

      const result = getNextExecutionTime(data)

      expect(result).toContain('3:15 PM')
      expect(result).toContain('2024')
    })
  })

  describe('edge cases', () => {
    it('handles zero count', () => {
      const data = createMockData()
      const result = getNextExecutionTimes(data, 0)
      expect(result).toEqual([])
    })

    it('handles missing visual_config', () => {
      const data = createMockData({
        visual_config: undefined,
      })

      expect(() => getNextExecutionTimes(data, 1)).not.toThrow()
    })
  })

  describe('timezone handling and cron integration', () => {
    beforeEach(() => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2024-01-15T10:00:00Z'))
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('cron mode timezone consistency', () => {
      // Test the exact integration path with cron-parser
      const data = createMockData({
        mode: 'cron',
        cron_expression: '0 9 * * 1-5', // 9 AM weekdays
        timezone: 'America/New_York',
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result.length).toBeGreaterThan(0)
      result.forEach((date) => {
        // Should be weekdays
        expect(date.getDay()).toBeGreaterThanOrEqual(1)
        expect(date.getDay()).toBeLessThanOrEqual(5)

        // Should be 9 AM in the target timezone representation
        expect(date.getHours()).toBe(9)
        expect(date.getMinutes()).toBe(0)

        // Should be Date objects
        expect(date).toBeInstanceOf(Date)
      })
    })

    it('cron mode with enhanced syntax', () => {
      // Test new cron syntax features work through execution-time-calculator
      const testCases = [
        {
          expression: '@daily',
          expectedHour: 0,
          expectedMinute: 0,
        },
        {
          expression: '0 15 * * MON',
          expectedHour: 15,
          expectedMinute: 0,
        },
        {
          expression: '30 10 1 JAN *',
          expectedHour: 10,
          expectedMinute: 30,
        },
      ]

      testCases.forEach(({ expression, expectedHour, expectedMinute }) => {
        const data = createMockData({
          mode: 'cron',
          cron_expression: expression,
          timezone: 'UTC',
        })

        const result = getNextExecutionTimes(data, 1)

        if (result.length > 0) {
          expect(result[0].getHours()).toBe(expectedHour)
          expect(result[0].getMinutes()).toBe(expectedMinute)
        }
      })
    })

    it('timezone consistency across different modes', () => {
      const timezone = 'Europe/London'

      // Test visual mode with timezone
      const visualData = createMockData({
        mode: 'visual',
        frequency: 'daily',
        visual_config: { time: '2:00 PM' },
        timezone,
      })

      // Test cron mode with same timezone
      const cronData = createMockData({
        mode: 'cron',
        cron_expression: '0 14 * * *', // 2:00 PM
        timezone,
      })

      const visualResult = getNextExecutionTimes(visualData, 1)
      const cronResult = getNextExecutionTimes(cronData, 1)

      expect(visualResult).toHaveLength(1)
      expect(cronResult).toHaveLength(1)

      // Both should show 2 PM (14:00) in their timezone representation
      expect(visualResult[0].getHours()).toBe(14)
      expect(cronResult[0].getHours()).toBe(14)
    })

    it('DST boundary handling in cron mode', () => {
      // Test around DST transition
      jest.setSystemTime(new Date('2024-03-08T10:00:00Z')) // Before DST in US

      const data = createMockData({
        mode: 'cron',
        cron_expression: '0 2 * * *', // 2 AM daily
        timezone: 'America/New_York',
      })

      const result = getNextExecutionTimes(data, 5)

      expect(result.length).toBeGreaterThan(0)
      // During DST spring forward, 2 AM becomes 3 AM
      // This is correct behavior - the cron-parser library handles DST properly
      result.forEach((date) => {
        // Should be either 2 AM (non-DST days) or 3 AM (DST transition day)
        expect([2, 3]).toContain(date.getHours())
        expect(date.getMinutes()).toBe(0)
      })
    })

    it('invalid cron expression handling', () => {
      const data = createMockData({
        mode: 'cron',
        cron_expression: '',
        timezone: 'UTC',
      })

      const result = getNextExecutionTimes(data, 5)
      expect(result).toEqual([])

      // Test getNextExecutionTime with invalid cron
      const timeString = getNextExecutionTime(data)
      expect(timeString).toBe('--')
    })

    it('cron vs visual mode consistency check', () => {
      // Compare equivalent expressions in both modes
      const cronDaily = createMockData({
        mode: 'cron',
        cron_expression: '0 0 * * *', // Daily at midnight
        timezone: 'UTC',
      })

      const visualDaily = createMockData({
        mode: 'visual',
        frequency: 'daily',
        visual_config: { time: '12:00 AM' },
        timezone: 'UTC',
      })

      const cronResult = getNextExecutionTimes(cronDaily, 1)
      const visualResult = getNextExecutionTimes(visualDaily, 1)

      if (cronResult.length > 0 && visualResult.length > 0) {
        expect(cronResult[0].getHours()).toBe(visualResult[0].getHours())
        expect(cronResult[0].getMinutes()).toBe(visualResult[0].getMinutes())
      }
    })
  })

  describe('weekly and monthly frequency timezone handling', () => {
    beforeEach(() => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2024-01-15T10:00:00Z'))
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('weekly frequency with timezone', () => {
      const data = createMockData({
        frequency: 'weekly',
        visual_config: {
          time: '9:00 AM',
          weekdays: ['mon', 'wed', 'fri'],
        },
        timezone: 'Asia/Tokyo',
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result.length).toBeGreaterThan(0)
      result.forEach((date) => {
        expect([1, 3, 5]).toContain(date.getDay()) // Mon, Wed, Fri
        expect(date.getHours()).toBe(9)
        expect(date.getMinutes()).toBe(0)
      })
    })

    it('monthly frequency with timezone', () => {
      const data = createMockData({
        frequency: 'monthly',
        visual_config: {
          time: '11:30 AM',
          monthly_days: [1, 15, 'last'],
        },
        timezone: 'America/Los_Angeles',
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result.length).toBeGreaterThan(0)
      result.forEach((date) => {
        expect(date.getHours()).toBe(11)
        expect(date.getMinutes()).toBe(30)
        // Should be on specified days (1st, 15th, or last day of month)
        const day = date.getDate()
        const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
        expect(day === 1 || day === 15 || day === lastDay).toBe(true)
      })
    })

    it('hourly frequency with timezone', () => {
      const data = createMockData({
        frequency: 'hourly',
        visual_config: { on_minute: 45 },
        timezone: 'Europe/Berlin',
      })

      const result = getNextExecutionTimes(data, 3)

      expect(result.length).toBeGreaterThan(0)
      result.forEach((date) => {
        expect(date.getMinutes()).toBe(45)
        expect(date.getSeconds()).toBe(0)
      })
    })
  })
})
