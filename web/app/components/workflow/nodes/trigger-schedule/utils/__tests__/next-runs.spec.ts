import type { ScheduleTriggerNodeType } from '../../types'
import { BlockEnum } from '../../../../types'
import { getFormattedExecutionTimes, getNextExecutionTime } from '../execution-time-calculator'

// Expected runs below match calculate_next_run_at on the backend (croniter with zoneinfo).

const createData = (overrides: Partial<ScheduleTriggerNodeType>): ScheduleTriggerNodeType =>
  ({
    type: BlockEnum.TriggerSchedule,
    title: 'schedule',
    mode: 'visual',
    frequency: 'daily',
    timezone: 'UTC',
    ...overrides,
  }) as ScheduleTriggerNodeType

const runsAt = (now: string, data: ScheduleTriggerNodeType, count: number) => {
  vi.setSystemTime(new Date(now))
  // Intl may print a narrow no-break space before AM/PM.
  return getFormattedExecutionTimes(data, count).map((text) => text.replace(/\s/g, ' '))
}

describe('next runs', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('month end', () => {
    it('moves hourly runs to the first day of the next month', () => {
      const data = createData({
        frequency: 'hourly',
        timezone: 'Asia/Seoul',
        visual_config: { on_minute: 0 },
      })

      expect(runsAt('2026-10-31T13:30:00Z', data, 3)).toEqual([
        'October 31, 2026, 11:00 PM (UTC+9)',
        'November 1, 2026, 12:00 AM (UTC+9)',
        'November 1, 2026, 1:00 AM (UTC+9)',
      ])
    })

    it('moves the node card to January 1 after New Year midnight', () => {
      vi.setSystemTime(new Date('2026-12-31T14:30:00Z'))
      const data = createData({
        frequency: 'hourly',
        timezone: 'Asia/Seoul',
        visual_config: { on_minute: 0 },
      })

      expect(getNextExecutionTime(data).replace(/\s/g, ' ')).toBe('January 1, 2027, 12:00 AM')
    })

    it('finds February 29 in the next leap year', () => {
      const data = createData({
        mode: 'cron',
        cron_expression: '0 0 29 2 *',
        timezone: 'Asia/Seoul',
      })

      expect(runsAt('2026-03-01T00:00:00Z', data, 1)).toEqual([
        'February 29, 2028, 12:00 AM (UTC+9)',
      ])
    })
  })

  describe('DST start', () => {
    it('runs a daily job right after the clocks jump', () => {
      const data = createData({ timezone: 'America/New_York', visual_config: { time: '02:30 AM' } })

      expect(runsAt('2026-03-08T04:00:00Z', data, 2)).toEqual([
        'March 8, 2026, 3:00 AM (UTC-4)',
        'March 9, 2026, 2:30 AM (UTC-4)',
      ])
    })

    it('skips the missing slot of an hourly job', () => {
      const data = createData({
        frequency: 'hourly',
        timezone: 'America/New_York',
        visual_config: { on_minute: 30 },
      })

      expect(runsAt('2026-03-08T06:05:00Z', data, 2)).toEqual([
        'March 8, 2026, 1:30 AM (UTC-5)',
        'March 8, 2026, 3:30 AM (UTC-4)',
      ])
    })

    it('handles a 30-minute DST change', () => {
      const data = createData({
        frequency: 'hourly',
        timezone: 'Australia/Lord_Howe',
        visual_config: { on_minute: 15 },
      })

      expect(runsAt('2026-10-03T14:00:00Z', data, 3)).toEqual([
        'October 4, 2026, 1:15 AM (UTC+10:30)',
        'October 4, 2026, 2:30 AM (UTC+11)',
        'October 4, 2026, 3:15 AM (UTC+11)',
      ])
    })

    it('moves a daily London job to the first minute after the jump', () => {
      const data = createData({ timezone: 'Europe/London', visual_config: { time: '01:30 AM' } })

      expect(runsAt('2026-03-28T23:00:00Z', data, 2)).toEqual([
        'March 29, 2026, 2:00 AM (UTC+1)',
        'March 30, 2026, 1:30 AM (UTC+1)',
      ])
    })

    it('skips the missing hourly slot in a 45-minute offset zone', () => {
      const data = createData({
        frequency: 'hourly',
        timezone: 'Pacific/Chatham',
        visual_config: { on_minute: 0 },
      })

      expect(runsAt('2026-09-26T12:30:00Z', data, 2)).toEqual([
        'September 27, 2026, 2:00 AM (UTC+12:45)',
        'September 27, 2026, 4:00 AM (UTC+13:45)',
      ])
    })

    it('handles a change at midnight', () => {
      const data = createData({ timezone: 'America/Santiago', visual_config: { time: '12:30 AM' } })

      expect(runsAt('2026-09-05T12:00:00Z', data, 2)).toEqual([
        'September 6, 2026, 1:00 AM (UTC-3)',
        'September 7, 2026, 12:30 AM (UTC-3)',
      ])
    })
  })

  describe('DST end', () => {
    it('lists both runs of a daily job in the repeated hour', () => {
      const data = createData({ timezone: 'America/New_York', visual_config: { time: '01:30 AM' } })

      expect(runsAt('2026-11-01T04:00:00Z', data, 3)).toEqual([
        'November 1, 2026, 1:30 AM (UTC-4)',
        'November 1, 2026, 1:30 AM (UTC-5)',
        'November 2, 2026, 1:30 AM (UTC-5)',
      ])
    })

    it('lists both runs of an hourly job in the repeated hour', () => {
      const data = createData({
        frequency: 'hourly',
        timezone: 'America/New_York',
        visual_config: { on_minute: 30 },
      })

      expect(runsAt('2026-11-01T04:40:00Z', data, 3)).toEqual([
        'November 1, 2026, 1:30 AM (UTC-4)',
        'November 1, 2026, 1:30 AM (UTC-5)',
        'November 1, 2026, 2:30 AM (UTC-5)',
      ])
    })

    it('handles a zone with negative DST', () => {
      const data = createData({ timezone: 'Europe/Dublin', visual_config: { time: '01:30 AM' } })

      expect(runsAt('2026-10-24T23:00:00Z', data, 3)).toEqual([
        'October 25, 2026, 1:30 AM (UTC+1)',
        'October 25, 2026, 1:30 AM (UTC+0)',
        'October 26, 2026, 1:30 AM (UTC+0)',
      ])
    })
  })

  describe('visual and cron', () => {
    it('lists weekly runs in time order and matches the same cron', () => {
      const visual = createData({
        frequency: 'weekly',
        timezone: 'Asia/Seoul',
        visual_config: { time: '09:00 AM', weekdays: ['mon', 'fri', 'sun'] },
      })
      const cron = createData({
        mode: 'cron',
        cron_expression: '0 9 * * 0,1,5',
        timezone: 'Asia/Seoul',
      })
      const expected = [
        'January 8, 2027, 9:00 AM (UTC+9)',
        'January 10, 2027, 9:00 AM (UTC+9)',
        'January 11, 2027, 9:00 AM (UTC+9)',
        'January 15, 2027, 9:00 AM (UTC+9)',
        'January 17, 2027, 9:00 AM (UTC+9)',
      ]

      expect(runsAt('2027-01-04T15:00:00Z', cron, 5)).toEqual(expected)
      expect(runsAt('2027-01-04T15:00:00Z', visual, 5)).toEqual([
        'Friday, January 8, 2027, 9:00 AM (UTC+9)',
        'Sunday, January 10, 2027, 9:00 AM (UTC+9)',
        'Monday, January 11, 2027, 9:00 AM (UTC+9)',
        'Friday, January 15, 2027, 9:00 AM (UTC+9)',
        'Sunday, January 17, 2027, 9:00 AM (UTC+9)',
      ])
    })
  })

  describe('cron syntax', () => {
    const cronData = (cron_expression: string) =>
      createData({ mode: 'cron', cron_expression, timezone: 'Asia/Seoul' })

    it('reads a range with the same start and end as the whole range', () => {
      expect(runsAt('2026-10-12T03:17:42Z', cronData('0 18-18 * * *'), 2)).toEqual([
        'October 12, 2026, 1:00 PM (UTC+9)',
        'October 12, 2026, 2:00 PM (UTC+9)',
      ])
    })

    it('matches day of week only when day of month is a wildcard', () => {
      expect(runsAt('2026-10-12T03:17:42Z', cronData('* * * 4 3'), 2)).toEqual([
        'April 7, 2027, 12:00 AM (UTC+9)',
        'April 7, 2027, 12:01 AM (UTC+9)',
      ])
    })

    it('lists no runs when the backend cannot find one', () => {
      for (const expression of ['0 0 31 2 *', '0 9 1 * 1#2', '0 0 * * 5L'])
        expect(runsAt('2026-10-12T03:17:42Z', cronData(expression), 2)).toEqual([])
    })
  })

  describe('browser timezone', () => {
    it('never reads or writes browser-local date fields', () => {
      const data = createData({ timezone: 'America/New_York', visual_config: { time: '01:30 AM' } })
      const expected = runsAt('2026-11-01T04:00:00Z', data, 3)

      const localMethods = [
        'getFullYear',
        'getMonth',
        'getDate',
        'getDay',
        'getHours',
        'getMinutes',
        'setFullYear',
        'setMonth',
        'setDate',
        'setHours',
        'setMinutes',
      ] as const
      for (const method of localMethods) {
        vi.spyOn(Date.prototype, method).mockImplementation(() => {
          throw new Error(`browser-local ${method} used`)
        })
      }

      expect(runsAt('2026-11-01T04:00:00Z', data, 3)).toEqual(expected)
      expect(getNextExecutionTime(data)).not.toBe('--')
    })
  })
})
