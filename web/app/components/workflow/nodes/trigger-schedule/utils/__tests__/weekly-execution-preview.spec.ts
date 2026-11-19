import type { ScheduleTriggerNodeType } from '../../types'
import { BlockEnum } from '../../../../types'
import {
  getFormattedExecutionTimes,
  getNextExecutionTime,
  getNextExecutionTimes,
} from '../execution-time-calculator'

const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const createWeeklyData = (
  selectedDays: string[],
  timezone = 'Asia/Seoul',
): ScheduleTriggerNodeType => ({
  type: BlockEnum.TriggerSchedule,
  title: 'schedule',
  desc: '',
  mode: 'visual',
  frequency: 'weekly',
  timezone,
  visual_config: { time: '9:00 AM', weekdays: selectedDays },
})

const wallTime = (date: Date) => [
  date.getFullYear(),
  date.getMonth() + 1,
  date.getDate(),
  date.getHours(),
  date.getMinutes(),
]

describe('weekly schedule execution preview', () => {
  afterEach(() => vi.useRealTimers())

  it('shows Monday as the next run after Sunday morning', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T01:00:00Z'))

    const data = createWeeklyData(['sun', 'mon'])
    expect(getNextExecutionTime(data)).toBe('Monday, October 26, 2026, 9:00 AM')
    expect(getNextExecutionTimes(data, 9).map(wallTime)).toEqual([
      [2026, 10, 26, 9, 0],
      [2026, 11, 1, 9, 0],
      [2026, 11, 2, 9, 0],
      [2026, 11, 8, 9, 0],
      [2026, 11, 9, 9, 0],
      [2026, 11, 15, 9, 0],
      [2026, 11, 16, 9, 0],
      [2026, 11, 22, 9, 0],
      [2026, 11, 23, 9, 0],
    ])
    expect(getFormattedExecutionTimes(data, 5)[4]).toContain('Monday, November 9, 2026, 9:00 AM')
  })

  it.each([
    { time: '12:00 AM', cron: '0 0' },
    { time: '12:00 PM', cron: '0 12' },
    { time: '11:59 PM', cron: '59 23' },
  ])('keeps the next five runs in order at $time', ({ time, cron }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T01:00:00Z'))

    const data: ScheduleTriggerNodeType = {
      ...createWeeklyData(['sun', 'mon']),
      visual_config: { time, weekdays: ['sun', 'mon'] },
    }
    const cronData: ScheduleTriggerNodeType = {
      ...data,
      mode: 'cron',
      cron_expression: `${cron} * * 0,1`,
    }

    expect(getNextExecutionTimes(data, 5).map(wallTime)).toEqual(
      getNextExecutionTimes(cronData, 5).map(wallTime),
    )
  })

  it.each([
    '2026-10-24T23:59:00Z', // Sunday before 9 AM in Seoul
    '2026-10-25T00:00:00Z', // Sunday at 9 AM in Seoul
    '2026-10-25T01:00:00Z', // Sunday after 9 AM in Seoul
    '2026-12-31T15:30:00Z', // New Year in Seoul
  ])('matches the cron schedule for every weekday set at %s', (now) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))

    for (let mask = 1; mask < 1 << weekdays.length; mask++) {
      const selectedDays = weekdays.filter((_, index) => mask & (1 << index))
      const cronData: ScheduleTriggerNodeType = {
        ...createWeeklyData(selectedDays),
        mode: 'cron',
        cron_expression: `0 9 * * ${selectedDays.map((day) => weekdays.indexOf(day)).join(',')}`,
      }

      for (const count of [1, 5]) {
        expect(getNextExecutionTimes(createWeeklyData(selectedDays), count).map(wallTime)).toEqual(
          getNextExecutionTimes(cronData, count).map(wallTime),
        )
      }
    }
  })

  it.each([
    { timezone: 'America/New_York', now: '2026-10-25T14:00:00Z' }, // DST ends next Sunday
    { timezone: 'Pacific/Kiritimati', now: '2026-12-31T11:00:00Z' }, // New Year
  ])('matches cron across a calendar change in $timezone', ({ timezone, now }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))

    for (let mask = 1; mask < 1 << weekdays.length; mask++) {
      const selectedDays = weekdays.filter((_, index) => mask & (1 << index))
      const cronData: ScheduleTriggerNodeType = {
        ...createWeeklyData(selectedDays, timezone),
        mode: 'cron',
        cron_expression: `0 9 * * ${selectedDays.map((day) => weekdays.indexOf(day)).join(',')}`,
      }

      expect(
        getNextExecutionTimes(createWeeklyData(selectedDays, timezone), 5).map(wallTime),
      ).toEqual(getNextExecutionTimes(cronData, 5).map(wallTime))
    }
  })

  it('returns unique runs in date order for repeated and reversed weekdays', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T01:00:00Z'))

    expect(getNextExecutionTimes(createWeeklyData(['mon', 'sun', 'mon']), 3).map(wallTime)).toEqual(
      [
        [2026, 10, 26, 9, 0],
        [2026, 11, 1, 9, 0],
        [2026, 11, 2, 9, 0],
      ],
    )
    expect(getNextExecutionTimes(createWeeklyData([]), 5)).toEqual([])
    expect(getNextExecutionTimes(createWeeklyData(['sun']), 0)).toEqual([])
  })
})
