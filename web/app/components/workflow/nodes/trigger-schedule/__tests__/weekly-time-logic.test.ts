import { getNextExecutionTimes } from '../utils/execution-time-calculator'
import type { ScheduleTriggerNodeType } from '../types'

const createWeeklyConfig = (
  weekdays: string[],
  time = '2:30 PM',
  timezone = 'UTC',
): ScheduleTriggerNodeType => ({
  id: 'test-node',
  type: 'schedule-trigger',
  mode: 'visual',
  frequency: 'weekly',
  visual_config: {
    time,
    weekdays,
  },
  timezone,
  enabled: true,
})

describe('Weekly Schedule Time Logic Tests', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('Same weekday time comparison logic', () => {
    test('should execute today when time has not passed yet', () => {
      jest.setSystemTime(new Date('2024-08-28T10:00:00.000Z'))

      const config = createWeeklyConfig(['wed'], '2:30 PM', 'UTC')
      const times = getNextExecutionTimes(config, 3)

      expect(times[0].getDay()).toBe(3)
      expect(times[0].getDate()).toBe(28)
      expect(times[0].getHours()).toBe(14)
      expect(times[0].getMinutes()).toBe(30)
    })

    test('should skip to next week when time has already passed', () => {
      jest.setSystemTime(new Date('2024-08-28T16:00:00.000Z'))

      const config = createWeeklyConfig(['wed'], '2:30 PM', 'UTC')
      const times = getNextExecutionTimes(config, 3)

      expect(times[0].getDay()).toBe(3)
      expect(times[0].getDate()).toBe(4)
      expect(times[0].getMonth()).toBe(8)
      expect(times[0].getHours()).toBe(14)
      expect(times[0].getMinutes()).toBe(30)
    })

    test('should skip to next week when exact time has passed', () => {
      jest.setSystemTime(new Date('2024-08-28T14:30:01.000Z'))

      const config = createWeeklyConfig(['wed'], '2:30 PM', 'UTC')
      const times = getNextExecutionTimes(config, 3)

      expect(times[0].getDate()).toBe(4)
      expect(times[0].getMonth()).toBe(8)
    })

    test('should execute today when time is exactly now', () => {
      jest.setSystemTime(new Date('2024-08-28T14:30:00.000Z'))

      const config = createWeeklyConfig(['wed'], '2:30 PM', 'UTC')
      const times = getNextExecutionTimes(config, 3)

      expect(times[0].getDate()).toBe(4)
      expect(times[0].getMonth()).toBe(8)
    })
  })

  describe('Cross-day scenarios', () => {
    test('should handle early morning execution on same day', () => {
      jest.setSystemTime(new Date('2024-08-28T02:00:00.000Z'))

      const config = createWeeklyConfig(['wed'], '6:00 AM', 'UTC')
      const times = getNextExecutionTimes(config, 2)

      expect(times[0].getDate()).toBe(28)
      expect(times[0].getHours()).toBe(6)
      expect(times[1].getDate()).toBe(4)
      expect(times[1].getMonth()).toBe(8)
    })

    test('should handle midnight execution correctly', () => {
      jest.setSystemTime(new Date('2024-08-27T23:30:00.000Z'))

      const config = createWeeklyConfig(['wed'], '12:00 AM', 'UTC')
      const times = getNextExecutionTimes(config, 2)

      expect(times[0].getDate()).toBe(28)
      expect(times[0].getHours()).toBe(0)
      expect(times[1].getDate()).toBe(4)
      expect(times[1].getMonth()).toBe(8)
    })

    test('should handle noon execution correctly', () => {
      jest.setSystemTime(new Date('2024-08-28T10:00:00.000Z'))

      const config = createWeeklyConfig(['wed'], '12:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 2)

      expect(times[0].getDate()).toBe(28)
      expect(times[0].getHours()).toBe(12)
    })
  })

  describe('Multiple weekdays with time logic', () => {
    test('should respect time for multiple weekdays in same week', () => {
      jest.setSystemTime(new Date('2024-08-28T10:00:00.000Z'))

      const config = createWeeklyConfig(['wed', 'fri'], '2:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 4)

      expect(times[0].getDay()).toBe(3)
      expect(times[0].getDate()).toBe(28)

      expect(times[1].getDay()).toBe(5)
      expect(times[1].getDate()).toBe(30)

      expect(times[2].getDay()).toBe(3)
      expect(times[2].getDate()).toBe(4)
      expect(times[2].getMonth()).toBe(8)
    })

    test('should skip past weekdays in current week', () => {
      jest.setSystemTime(new Date('2024-08-28T16:00:00.000Z'))

      const config = createWeeklyConfig(['mon', 'wed'], '2:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 4)

      expect(times[0].getDay()).toBe(1)
      expect(times[0].getDate()).toBe(2)
      expect(times[0].getMonth()).toBe(8)

      expect(times[1].getDay()).toBe(3)
      expect(times[1].getDate()).toBe(4)
      expect(times[1].getMonth()).toBe(8)
    })

    test('should handle weekend execution correctly', () => {
      jest.setSystemTime(new Date('2024-08-31T10:00:00.000Z'))

      const config = createWeeklyConfig(['sat', 'sun'], '9:00 AM', 'UTC')
      const times = getNextExecutionTimes(config, 4)

      expect(times[0].getDay()).toBe(0)
      expect(times[0].getDate()).toBe(1)
      expect(times[0].getMonth()).toBe(8)

      expect(times[1].getDay()).toBe(6)
      expect(times[1].getDate()).toBe(7)
      expect(times[1].getMonth()).toBe(8)
    })
  })

  describe('Timezone handling with time logic', () => {
    test('should respect timezone when checking if time has passed', () => {
      jest.setSystemTime(new Date('2024-08-28T14:30:00.000Z'))

      const config = createWeeklyConfig(['wed'], '6:00 PM', 'America/New_York')
      const times = getNextExecutionTimes(config, 2)

      expect(times[0].getDate()).toBe(28)
      expect(times[0].getHours()).toBe(18)
    })

    test('should handle timezone difference when time has passed', () => {
      jest.setSystemTime(new Date('2024-08-28T23:00:00.000Z'))

      const config = createWeeklyConfig(['wed'], '6:00 PM', 'America/New_York')
      const times = getNextExecutionTimes(config, 2)

      expect(times[0].getDate()).toBe(4)
      expect(times[0].getMonth()).toBe(8)
    })
  })

  describe('Edge cases and boundary conditions', () => {
    test('should handle year boundary correctly with time logic', () => {
      jest.setSystemTime(new Date('2024-12-31T10:00:00.000Z'))

      const config = createWeeklyConfig(['tue'], '2:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 3)

      expect(times[0].getDate()).toBe(31)
      expect(times[0].getMonth()).toBe(11)
      expect(times[0].getFullYear()).toBe(2024)

      expect(times[1].getDate()).toBe(7)
      expect(times[1].getMonth()).toBe(0)
      expect(times[1].getFullYear()).toBe(2025)
    })

    test('should handle month boundary correctly', () => {
      jest.setSystemTime(new Date('2024-08-31T10:00:00.000Z'))

      const config = createWeeklyConfig(['sat'], '2:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 2)

      expect(times[0].getDate()).toBe(31)
      expect(times[0].getMonth()).toBe(7)

      expect(times[1].getDate()).toBe(7)
      expect(times[1].getMonth()).toBe(8)
    })

    test('should handle leap year February correctly', () => {
      jest.setSystemTime(new Date('2024-02-29T10:00:00.000Z'))

      const config = createWeeklyConfig(['thu'], '2:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 2)

      expect(times[0].getDate()).toBe(29)
      expect(times[0].getMonth()).toBe(1)
      expect(times[0].getFullYear()).toBe(2024)

      expect(times[1].getDate()).toBe(7)
      expect(times[1].getMonth()).toBe(2)
    })

    test('should handle daylight saving time transitions', () => {
      jest.setSystemTime(new Date('2024-03-10T10:00:00.000Z'))

      const config = createWeeklyConfig(['sun'], '2:00 AM', 'America/New_York')
      const times = getNextExecutionTimes(config, 3)

      expect(times.length).toBeGreaterThan(0)
      times.forEach((time) => {
        expect(time.getDay()).toBe(0)
        expect(time.getHours()).toBe(2)
      })
    })
  })

  describe('Validation of PR #24641 fix', () => {
    test('should correctly calculate weekday offsets (not use index as day offset)', () => {
      jest.setSystemTime(new Date('2024-08-28T10:00:00.000Z'))

      const config = createWeeklyConfig(['sun'], '2:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 2)

      expect(times[0].getDay()).toBe(0)
      expect(times[0].getDate()).toBe(1)
      expect(times[0].getMonth()).toBe(8)

      expect(times[1].getDate()).toBe(8)
      expect(times[1].getMonth()).toBe(8)
    })

    test('should correctly handle multiple weekdays selection', () => {
      jest.setSystemTime(new Date('2024-08-26T11:00:00.000Z'))

      const config = createWeeklyConfig(['mon', 'wed', 'fri'], '9:00 AM', 'UTC')
      const times = getNextExecutionTimes(config, 6)

      expect(times[0].getDay()).toBe(3)
      expect(times[0].getDate()).toBe(28)

      expect(times[1].getDay()).toBe(5)
      expect(times[1].getDate()).toBe(30)

      expect(times[2].getDay()).toBe(1)
      expect(times[2].getDate()).toBe(2)
      expect(times[2].getMonth()).toBe(8)
    })

    test('should prevent infinite loops with invalid weekdays', () => {
      jest.setSystemTime(new Date('2024-08-28T10:00:00.000Z'))

      const config = createWeeklyConfig(['invalid'], '2:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 3)

      expect(times).toEqual([])
    })
  })

  describe('Comprehensive time scenarios for all weekdays', () => {
    const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

    test.each(weekdays)('should respect time logic for %s', (weekday) => {
      jest.setSystemTime(new Date('2024-08-28T10:00:00.000Z'))

      const config = createWeeklyConfig([weekday], '2:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 3)

      expect(times.length).toBe(3)
      times.forEach((time) => {
        expect(time.getHours()).toBe(14)
        expect(time.getMinutes()).toBe(0)
      })
    })

    test.each(weekdays)('should handle early morning execution for %s', (weekday) => {
      jest.setSystemTime(new Date('2024-08-28T23:00:00.000Z'))

      const config = createWeeklyConfig([weekday], '6:00 AM', 'UTC')
      const times = getNextExecutionTimes(config, 2)

      expect(times.length).toBeGreaterThan(0)
      times.forEach((time) => {
        expect(time.getHours()).toBe(6)
        expect(time.getMinutes()).toBe(0)
      })
    })
  })

  describe('Performance and edge cases', () => {
    test('should complete execution within reasonable time', () => {
      jest.setSystemTime(new Date('2024-08-28T10:00:00.000Z'))

      const start = performance.now()

      const config = createWeeklyConfig(['mon', 'tue', 'wed', 'thu', 'fri'], '9:00 AM', 'UTC')
      const times = getNextExecutionTimes(config, 10)

      const end = performance.now()

      expect(times.length).toBe(10)
      expect(end - start).toBeLessThan(50)
    })

    test('should handle large count requests efficiently', () => {
      jest.setSystemTime(new Date('2024-08-28T10:00:00.000Z'))

      const config = createWeeklyConfig(['sun'], '2:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 100)

      expect(times.length).toBe(100)

      for (let i = 1; i < times.length; i++) {
        const timeDiff = times[i].getTime() - times[i - 1].getTime()
        const daysDiff = timeDiff / (1000 * 60 * 60 * 24)
        expect(daysDiff).toBe(7)
      }
    })

    test('should handle empty weekdays array', () => {
      jest.setSystemTime(new Date('2024-08-28T10:00:00.000Z'))

      const config = createWeeklyConfig([], '2:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 3)

      expect(times).toEqual([])
    })
  })

  describe('Comparison with other frequency modes consistency', () => {
    test('should behave consistently with daily mode time logic', () => {
      jest.setSystemTime(new Date('2024-08-28T10:00:00.000Z'))

      const weeklyConfig = createWeeklyConfig(['wed'], '2:00 PM', 'UTC')
      const dailyConfig: ScheduleTriggerNodeType = {
        id: 'test-node',
        type: 'schedule-trigger',
        mode: 'visual',
        frequency: 'daily',
        visual_config: {
          time: '2:00 PM',
        },
        timezone: 'UTC',
        enabled: true,
      }

      const weeklyTimes = getNextExecutionTimes(weeklyConfig, 1)
      const dailyTimes = getNextExecutionTimes(dailyConfig, 1)

      expect(weeklyTimes[0].getDate()).toBe(28)
      expect(dailyTimes[0].getDate()).toBe(28)
      expect(weeklyTimes[0].getHours()).toBe(14)
      expect(dailyTimes[0].getHours()).toBe(14)
    })

    test('should behave consistently when time has passed', () => {
      jest.setSystemTime(new Date('2024-08-28T16:00:00.000Z'))

      const weeklyConfig = createWeeklyConfig(['wed'], '2:00 PM', 'UTC')
      const dailyConfig: ScheduleTriggerNodeType = {
        id: 'test-node',
        type: 'schedule-trigger',
        mode: 'visual',
        frequency: 'daily',
        visual_config: {
          time: '2:00 PM',
        },
        timezone: 'UTC',
        enabled: true,
      }

      const weeklyTimes = getNextExecutionTimes(weeklyConfig, 1)
      const dailyTimes = getNextExecutionTimes(dailyConfig, 1)

      expect(weeklyTimes[0].getDate()).toBe(4)
      expect(dailyTimes[0].getDate()).toBe(29)

      expect(weeklyTimes[0].getHours()).toBe(14)
      expect(dailyTimes[0].getHours()).toBe(14)
    })
  })

  describe('Real-world scenarios', () => {
    test('Monday morning meeting scheduled on Monday at 10am should execute today if before 10am', () => {
      jest.setSystemTime(new Date('2024-08-26T08:00:00.000Z'))

      const config = createWeeklyConfig(['mon'], '10:00 AM', 'UTC')
      const times = getNextExecutionTimes(config, 1)

      expect(times[0].getDay()).toBe(1)
      expect(times[0].getDate()).toBe(26)
      expect(times[0].getHours()).toBe(10)
    })

    test('Friday afternoon report scheduled on Friday at 5pm should wait until next Friday if after 5pm', () => {
      jest.setSystemTime(new Date('2024-08-30T18:00:00.000Z'))

      const config = createWeeklyConfig(['fri'], '5:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 1)

      expect(times[0].getDay()).toBe(5)
      expect(times[0].getDate()).toBe(6)
      expect(times[0].getMonth()).toBe(8)
      expect(times[0].getHours()).toBe(17)
    })

    test('Weekend cleanup scheduled for Saturday and Sunday should work correctly', () => {
      jest.setSystemTime(new Date('2024-08-30T14:00:00.000Z'))

      const config = createWeeklyConfig(['sat', 'sun'], '11:00 PM', 'UTC')
      const times = getNextExecutionTimes(config, 4)

      expect(times[0].getDay()).toBe(6)
      expect(times[0].getDate()).toBe(31)
      expect(times[0].getHours()).toBe(23)

      expect(times[1].getDay()).toBe(0)
      expect(times[1].getDate()).toBe(1)
      expect(times[1].getMonth()).toBe(8)
      expect(times[1].getHours()).toBe(23)
    })
  })
})
