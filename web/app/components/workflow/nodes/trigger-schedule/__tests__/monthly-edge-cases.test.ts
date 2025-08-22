import { getNextExecutionTimes } from '../utils/execution-time-calculator'
import type { ScheduleTriggerNodeType } from '../types'

const createMonthlyConfig = (monthly_days: (number | 'last')[], time = '10:30 AM', timezone = 'UTC'): ScheduleTriggerNodeType => ({
  mode: 'visual',
  frequency: 'monthly',
  visual_config: {
    time,
    monthly_days,
  },
  timezone,
  enabled: true,
})

describe('Monthly Edge Cases', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2024-02-15T08:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('31st day selection logic', () => {
    test('31st day skips months without 31 days', () => {
      const config = createMonthlyConfig([31])
      const times = getNextExecutionTimes(config, 5)

      const expectedMonths = times.map(date => date.getMonth() + 1)

      expect(expectedMonths).not.toContain(2)
      expect(expectedMonths).not.toContain(4)
      expect(expectedMonths).not.toContain(6)
      expect(expectedMonths).not.toContain(9)
      expect(expectedMonths).not.toContain(11)

      times.forEach((date) => {
        expect(date.getDate()).toBe(31)
      })
    })

    test('30th day skips February', () => {
      const config = createMonthlyConfig([30])
      const times = getNextExecutionTimes(config, 5)

      const expectedMonths = times.map(date => date.getMonth() + 1)
      expect(expectedMonths).not.toContain(2)

      times.forEach((date) => {
        expect(date.getDate()).toBe(30)
      })
    })

    test('29th day works in all months', () => {
      const config = createMonthlyConfig([29])
      const times = getNextExecutionTimes(config, 12)

      const months = times.map(date => date.getMonth() + 1)
      expect(months).toContain(1)
      expect(months).toContain(3)
      expect(months).toContain(4)
      expect(months).toContain(5)
      expect(months).toContain(6)
      expect(months).toContain(7)
      expect(months).toContain(8)
      expect(months).toContain(9)
      expect(months).toContain(10)
      expect(months).toContain(11)
      expect(months).toContain(12)
    })

    test('29th day skips February in non-leap years', () => {
      jest.setSystemTime(new Date('2023-01-15T08:00:00.000Z'))

      const config = createMonthlyConfig([29])
      const times = getNextExecutionTimes(config, 12)

      const februaryExecutions = times.filter(date => date.getMonth() === 1)
      expect(februaryExecutions).toHaveLength(0)
    })

    test('29th day includes February in leap years', () => {
      jest.setSystemTime(new Date('2024-01-15T08:00:00.000Z'))

      const config = createMonthlyConfig([29])
      const times = getNextExecutionTimes(config, 12)

      const februaryExecutions = times.filter(date => date.getMonth() === 1)
      expect(februaryExecutions).toHaveLength(1)
      expect(februaryExecutions[0].getDate()).toBe(29)
    })
  })

  describe('last day vs specific day distinction', () => {
    test('31st selection is different from last day in short months', () => {
      const config31 = createMonthlyConfig([31])
      const configLast = createMonthlyConfig(['last'])

      const times31 = getNextExecutionTimes(config31, 12)
      const timesLast = getNextExecutionTimes(configLast, 12)

      const months31 = times31.map(date => date.getMonth() + 1)
      const monthsLast = timesLast.map(date => date.getMonth() + 1)

      expect(months31).not.toContain(2)
      expect(monthsLast).toContain(2)

      expect(months31).not.toContain(4)
      expect(monthsLast).toContain(4)
    })

    test('31st and last day both work correctly in 31-day months', () => {
      const config31 = createMonthlyConfig([31])
      const configLast = createMonthlyConfig(['last'])

      const times31 = getNextExecutionTimes(config31, 5)
      const timesLast = getNextExecutionTimes(configLast, 5)

      const march31 = times31.find(date => date.getMonth() === 2)
      const marchLast = timesLast.find(date => date.getMonth() === 2)

      expect(march31?.getDate()).toBe(31)
      expect(marchLast?.getDate()).toBe(31)
    })

    test('mixed selection with 31st and last behaves correctly', () => {
      const config = createMonthlyConfig([31, 'last'])
      const times = getNextExecutionTimes(config, 12)

      const februaryExecutions = times.filter(date => date.getMonth() === 1)
      expect(februaryExecutions).toHaveLength(1)
      expect(februaryExecutions[0].getDate()).toBe(29)

      const marchExecutions = times.filter(date => date.getMonth() === 2)
      expect(marchExecutions).toHaveLength(2)
      expect(marchExecutions.map(d => d.getDate()).sort()).toEqual([31, 31])
    })
  })

  describe('current month offset calculation', () => {
    test('skips current month when no valid days exist', () => {
      jest.setSystemTime(new Date('2024-02-15T08:00:00.000Z'))

      const config = createMonthlyConfig([31])
      const times = getNextExecutionTimes(config, 3)

      times.forEach((date) => {
        expect(date.getMonth()).toBeGreaterThan(1)
      })
    })

    test('includes current month when valid days exist', () => {
      jest.setSystemTime(new Date('2024-03-15T08:00:00.000Z'))

      const config = createMonthlyConfig([31])
      const times = getNextExecutionTimes(config, 3)

      const currentMonthExecution = times.find(date => date.getMonth() === 2)
      expect(currentMonthExecution).toBeDefined()
      expect(currentMonthExecution?.getDate()).toBe(31)
    })
  })

  describe('sorting and deduplication', () => {
    test('handles duplicate selections correctly', () => {
      const config = createMonthlyConfig([15, 15, 15])
      const times = getNextExecutionTimes(config, 5)

      const marchExecutions = times.filter(date => date.getMonth() === 2)
      expect(marchExecutions).toHaveLength(1)
    })

    test('sorts multiple days within same month', () => {
      jest.setSystemTime(new Date('2024-03-01T08:00:00.000Z'))

      const config = createMonthlyConfig([31, 15, 1])
      const times = getNextExecutionTimes(config, 5)

      const marchExecutions = times.filter(date => date.getMonth() === 2).sort((a, b) => a.getDate() - b.getDate())
      expect(marchExecutions.map(d => d.getDate())).toEqual([1, 15, 31])
    })
  })
})
