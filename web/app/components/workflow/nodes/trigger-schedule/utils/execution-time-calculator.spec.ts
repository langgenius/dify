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
})
