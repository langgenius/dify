import { getNextExecutionTimes } from '../utils/execution-time-calculator'
import type { ScheduleTriggerNodeType } from '../types'

const createMonthlyConfig = (monthlyDays: (number | 'last')[], time = '10:30 AM'): ScheduleTriggerNodeType => ({
  mode: 'visual',
  frequency: 'monthly',
  visual_config: {
    time,
    monthly_days: monthlyDays,
  },
  timezone: 'UTC',
  id: 'test',
  type: 'trigger-schedule',
  data: {},
  position: { x: 0, y: 0 },
})

describe('Monthly Multi-Select Execution Time Calculator', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2024-01-15T08:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('Multi-select functionality', () => {
    test('calculates execution times for multiple days in same month', () => {
      const config = createMonthlyConfig([1, 15, 30])
      const times = getNextExecutionTimes(config, 5)

      expect(times).toHaveLength(5)
      expect(times[0].getDate()).toBe(15)
      expect(times[0].getMonth()).toBe(0)
      expect(times[1].getDate()).toBe(30)
      expect(times[1].getMonth()).toBe(0)
      expect(times[2].getDate()).toBe(1)
      expect(times[2].getMonth()).toBe(1)
    })

    test('handles last day with multiple selections', () => {
      const config = createMonthlyConfig([1, 'last'])
      const times = getNextExecutionTimes(config, 4)

      expect(times[0].getDate()).toBe(31)
      expect(times[0].getMonth()).toBe(0)
      expect(times[1].getDate()).toBe(1)
      expect(times[1].getMonth()).toBe(1)
      expect(times[2].getDate()).toBe(29)
      expect(times[2].getMonth()).toBe(1)
    })

    test('skips invalid days in months with fewer days', () => {
      const config = createMonthlyConfig([30, 31])
      jest.setSystemTime(new Date('2024-01-01T08:00:00Z'))
      const times = getNextExecutionTimes(config, 6)

      const febTimes = times.filter(t => t.getMonth() === 1)
      expect(febTimes.length).toBe(0)

      const marchTimes = times.filter(t => t.getMonth() === 2)
      expect(marchTimes.length).toBe(2)
      expect(marchTimes[0].getDate()).toBe(30)
      expect(marchTimes[1].getDate()).toBe(31)
    })

    test('sorts execution times chronologically', () => {
      const config = createMonthlyConfig([25, 5, 15])
      const times = getNextExecutionTimes(config, 6)

      for (let i = 1; i < times.length; i++)
        expect(times[i].getTime()).toBeGreaterThan(times[i - 1].getTime())
    })

    test('handles single day selection', () => {
      const config = createMonthlyConfig([15])
      const times = getNextExecutionTimes(config, 3)

      expect(times).toHaveLength(3)
      expect(times[0].getDate()).toBe(15)
      expect(times[1].getDate()).toBe(15)
      expect(times[2].getDate()).toBe(15)

      for (let i = 1; i < times.length; i++)
        expect(times[i].getTime()).toBeGreaterThan(times[i - 1].getTime())
    })
  })

  describe('Single day configuration', () => {
    test('supports single day selection', () => {
      const config = createMonthlyConfig([15])
      const times = getNextExecutionTimes(config, 3)

      expect(times).toHaveLength(3)
      expect(times[0].getDate()).toBe(15)
      expect(times[1].getDate()).toBe(15)
      expect(times[2].getDate()).toBe(15)
    })

    test('supports last day selection', () => {
      const config = createMonthlyConfig(['last'])
      const times = getNextExecutionTimes(config, 3)

      expect(times[0].getDate()).toBe(31)
      expect(times[0].getMonth()).toBe(0)
      expect(times[1].getDate()).toBe(29)
      expect(times[1].getMonth()).toBe(1)
    })

    test('falls back to day 1 when no configuration provided', () => {
      const config: ScheduleTriggerNodeType = {
        mode: 'visual',
        frequency: 'monthly',
        visual_config: {
          time: '10:30 AM',
        },
        timezone: 'UTC',
        id: 'test',
        type: 'trigger-schedule',
        data: {},
        position: { x: 0, y: 0 },
      }

      const times = getNextExecutionTimes(config, 2)

      expect(times).toHaveLength(2)
      expect(times[0].getDate()).toBe(1)
      expect(times[1].getDate()).toBe(1)
    })
  })

  describe('Edge cases', () => {
    test('handles empty monthly_days array', () => {
      const config = createMonthlyConfig([])
      const times = getNextExecutionTimes(config, 2)

      expect(times).toHaveLength(2)
      expect(times[0].getDate()).toBe(1)
      expect(times[1].getDate()).toBe(1)
    })

    test('handles execution time that has already passed today', () => {
      jest.setSystemTime(new Date('2024-01-15T12:00:00Z'))
      const config = createMonthlyConfig([15], '10:30 AM')
      const times = getNextExecutionTimes(config, 2)

      expect(times[0].getMonth()).toBe(1)
      expect(times[0].getDate()).toBe(15)
    })

    test('limits search to reasonable number of months', () => {
      const config = createMonthlyConfig([29, 30, 31])
      jest.setSystemTime(new Date('2024-03-01T08:00:00Z'))
      const times = getNextExecutionTimes(config, 50)

      expect(times.length).toBeGreaterThan(0)
      expect(times.length).toBeLessThanOrEqual(50)
    })

    test('handles duplicate days in selection', () => {
      const config = createMonthlyConfig([15, 15, 15])
      const times = getNextExecutionTimes(config, 4)

      const uniqueDates = new Set(times.map(t => t.getTime()))
      expect(uniqueDates.size).toBe(times.length)
    })

    test('correctly handles leap year February', () => {
      const config = createMonthlyConfig([29])
      jest.setSystemTime(new Date('2024-01-01T08:00:00Z'))
      const times = getNextExecutionTimes(config, 3)

      expect(times[0].getDate()).toBe(29)
      expect(times[0].getMonth()).toBe(0)
      expect(times[1].getDate()).toBe(29)
      expect(times[1].getMonth()).toBe(1)
    })

    test('handles non-leap year February', () => {
      const config = createMonthlyConfig([29])
      jest.setSystemTime(new Date('2023-01-01T08:00:00Z'))
      const times = getNextExecutionTimes(config, 3)

      expect(times[0].getDate()).toBe(29)
      expect(times[0].getMonth()).toBe(0)
      expect(times[1].getDate()).toBe(29)
      expect(times[1].getMonth()).toBe(2)
    })
  })

  describe('Time handling', () => {
    test('respects specified execution time', () => {
      const config = createMonthlyConfig([1], '2:45 PM')
      const times = getNextExecutionTimes(config, 1)

      expect(times[0].getHours()).toBe(14)
      expect(times[0].getMinutes()).toBe(45)
    })

    test('handles AM/PM conversion correctly', () => {
      const configAM = createMonthlyConfig([1], '6:30 AM')
      const configPM = createMonthlyConfig([1], '6:30 PM')

      const timesAM = getNextExecutionTimes(configAM, 1)
      const timesPM = getNextExecutionTimes(configPM, 1)

      expect(timesAM[0].getHours()).toBe(6)
      expect(timesPM[0].getHours()).toBe(18)
    })

    test('handles 12 AM and 12 PM correctly', () => {
      const config12AM = createMonthlyConfig([1], '12:00 AM')
      const config12PM = createMonthlyConfig([1], '12:00 PM')

      const times12AM = getNextExecutionTimes(config12AM, 1)
      const times12PM = getNextExecutionTimes(config12PM, 1)

      expect(times12AM[0].getHours()).toBe(0)
      expect(times12PM[0].getHours()).toBe(12)
    })
  })
})
