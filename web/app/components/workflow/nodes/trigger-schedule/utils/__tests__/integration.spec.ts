import type { ScheduleTriggerNodeType } from '../../types'
import { BlockEnum } from '../../../../types'
import { getNextRunInstants, isValidCronExpression } from '../cron-parser'
import { getNextExecutionTime, getNextExecutionTimes } from '../execution-time-calculator'
import { dayOfWeek, toWall } from '../time-model'

// Cron parsing and the execution time calculator working together
describe('cron-parser + execution-time-calculator integration', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  const createCronData = (
    overrides: Partial<ScheduleTriggerNodeType> = {},
  ): ScheduleTriggerNodeType =>
    ({
      type: BlockEnum.TriggerSchedule,
      title: 'test-schedule',
      mode: 'cron',
      frequency: 'daily',
      timezone: 'UTC',
      ...overrides,
    }) as ScheduleTriggerNodeType

  // Clock reading of each run in the schedule timezone
  const wallsOf = (data: ScheduleTriggerNodeType, count: number) =>
    getNextExecutionTimes(data, count).map((date) => {
      const wall = toWall(date.getTime(), data.timezone!)
      return { ...wall, weekday: dayOfWeek(wall.year, wall.month, wall.day) }
    })

  describe('backward compatibility validation', () => {
    it('returns the same runs from the parser and the calculator', () => {
      const expressions = [
        '15 10 1 * *', // Monthly 1st at 10:15
        '0 0 * * 0', // Weekly Sunday midnight
        '*/5 * * * *', // Every 5 minutes
        '0 9-17 * * 1-5', // Business hours weekdays
        '30 14 * * 1', // Monday 14:30
        '0 0 1,15 * *', // 1st and 15th midnight
      ]

      expressions.forEach((expression) => {
        expect(isValidCronExpression(expression)).toBe(true)

        const direct = getNextRunInstants(expression, 'UTC', 5)
        const data = createCronData({ cron_expression: expression })
        const viaCalculator = getNextExecutionTimes(data, 5)

        expect(direct).toHaveLength(5)
        expect(viaCalculator.map((date) => date.getTime())).toEqual(direct)
      })
    })

    it('reads the clock in the schedule timezone', () => {
      ;['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/London'].forEach((timezone) => {
        const walls = wallsOf(createCronData({ cron_expression: '0 12 * * *', timezone }), 5)

        expect(walls).toHaveLength(5)
        walls.forEach((wall) => {
          expect(wall.hour).toBe(12)
          expect(wall.minute).toBe(0)
        })
      })
    })

    it('returns no runs for an invalid expression', () => {
      const invalidExpressions = [
        '', // Empty string
        '   ', // Whitespace only
        '60 10 1 * *', // Invalid minute
        '15 25 1 * *', // Invalid hour
        '15 10 32 * *', // Invalid day
        '15 10 1 13 *', // Invalid month
        '15 10 1', // Too few fields
        '15 10 1 * * *', // Too many fields
        'invalid expression', // Completely invalid
      ]

      invalidExpressions.forEach((expression) => {
        expect(isValidCronExpression(expression)).toBe(false)
        expect(getNextRunInstants(expression, 'UTC', 5)).toEqual([])

        const data = createCronData({ cron_expression: expression })
        expect(getNextExecutionTimes(data, 5)).toEqual([])
        expect(getNextExecutionTime(data)).toBe('--')
      })
    })
  })

  describe('enhanced features integration', () => {
    it('supports month and day names', () => {
      const cases = [
        { expr: '0 9 1 JAN *', months: [1], day: 1, hour: 9, minute: 0 },
        { expr: '0 15 * * MON', weekday: 1, hour: 15, minute: 0 },
        { expr: '30 10 15 JUN,DEC *', months: [6, 12], day: 15, hour: 10, minute: 30 },
        { expr: '0 12 * JAN-MAR *', months: [1, 2, 3], hour: 12, minute: 0 },
      ]

      cases.forEach(({ expr, months, day, weekday, hour, minute }) => {
        expect(isValidCronExpression(expr)).toBe(true)

        const walls = wallsOf(createCronData({ cron_expression: expr }), 3)
        expect(walls).toHaveLength(3)
        walls.forEach((wall) => {
          expect(wall.hour).toBe(hour)
          expect(wall.minute).toBe(minute)
          if (months) expect(months).toContain(wall.month)
          if (day !== undefined) expect(wall.day).toBe(day)
          if (weekday !== undefined) expect(wall.weekday).toBe(weekday)
        })
      })
    })

    it('supports predefined expressions', () => {
      const cases = [
        { expr: '@daily' },
        { expr: '@weekly', weekday: 0 },
        { expr: '@monthly', day: 1 },
        { expr: '@yearly', day: 1, month: 1 },
      ]

      cases.forEach(({ expr, weekday, day, month }) => {
        expect(isValidCronExpression(expr)).toBe(true)

        const walls = wallsOf(createCronData({ cron_expression: expr }), 3)
        expect(walls.length).toBeGreaterThan(0)
        walls.forEach((wall) => {
          expect(wall.hour).toBe(0)
          expect(wall.minute).toBe(0)
          if (weekday !== undefined) expect(wall.weekday).toBe(weekday)
          if (day !== undefined) expect(wall.day).toBe(day)
          if (month !== undefined) expect(wall.month).toBe(month)
        })
      })
    })

    it('supports special characters', () => {
      // ? for day of month, 7 for Sunday, L for the last day of the month
      const walls = (expr: string) => wallsOf(createCronData({ cron_expression: expr }), 2)

      expect(walls('0 9 ? * 1').map((wall) => wall.weekday)).toEqual([1, 1])
      expect(walls('0 12 * * 7').map((wall) => wall.weekday)).toEqual([0, 0])
      expect(walls('0 15 L * *').map((wall) => wall.day)).toEqual([31, 29])
    })
  })

  describe('timezone edge cases', () => {
    it('handles zones with unusual offsets', () => {
      const scenarios = [
        { tz: 'Asia/Kolkata', expr: '30 14 * * *', hour: 14, minute: 30 }, // UTC+5:30
        { tz: 'Australia/Adelaide', expr: '0 8 * * *', hour: 8, minute: 0 }, // UTC+9:30/+10:30
        { tz: 'Pacific/Kiritimati', expr: '0 12 * * *', hour: 12, minute: 0 }, // UTC+14
      ]

      scenarios.forEach(({ tz, expr, hour, minute }) => {
        const walls = wallsOf(createCronData({ cron_expression: expr, timezone: tz }), 2)
        expect(walls).toHaveLength(2)
        walls.forEach((wall) => {
          expect(wall.hour).toBe(hour)
          expect(wall.minute).toBe(minute)
        })
      })
    })
  })

  describe('performance and reliability', () => {
    it('handles high-frequency expressions quickly', () => {
      ;['*/1 * * * *', '*/5 * * * *', '0,15,30,45 * * * *'].forEach((expr) => {
        const start = performance.now()
        const runs = getNextExecutionTimes(createCronData({ cron_expression: expr }), 5)
        const end = performance.now()

        expect(runs).toHaveLength(5)
        expect(end - start).toBeLessThan(100)
      })
    })

    it('handles complex expressions', () => {
      ;['15,45 8-18 1,15 JAN-MAR MON-FRI', '30 9 L * *'].forEach((expr) => {
        expect(isValidCronExpression(expr)).toBe(true)
        const runs = getNextExecutionTimes(
          createCronData({ cron_expression: expr, timezone: 'America/New_York' }),
          3,
        )
        expect(runs).toHaveLength(3)
        expect(runs[0]!.getTime()).toBeLessThan(runs[1]!.getTime())
      })
    })
  })

  describe('format compatibility', () => {
    it('formats the next execution time for the node', () => {
      const testCases = [
        { expr: '0 9 * * *', timezone: 'UTC' },
        { expr: '30 14 * * 1-5', timezone: 'America/New_York' },
        { expr: '@daily', timezone: 'Asia/Tokyo' },
      ]

      testCases.forEach(({ expr, timezone }) => {
        const timeString = getNextExecutionTime(createCronData({ cron_expression: expr, timezone }))

        expect(timeString).not.toBe('--')
        expect(timeString).toMatch(/\d+:\d+/)
        expect(timeString).toMatch(/AM|PM/)
        expect(timeString).toMatch(/\d{4}/)
      })
    })
  })
})
