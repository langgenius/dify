import type { ScheduleTriggerNodeType } from '../../types'
import { BlockEnum } from '../../../../types'
import { getNextExecutionTime, getNextExecutionTimes } from '../execution-time-calculator'
import { toWall } from '../time-model'

const createCronData = (cron_expression: string, timezone = 'UTC'): ScheduleTriggerNodeType => ({
  type: BlockEnum.TriggerSchedule,
  title: 'Schedule',
  desc: '',
  mode: 'cron',
  cron_expression,
  timezone,
})

// The calculator returns real instants. Read each one as the clock in the schedule timezone.
const wallTime = (timezone: string) => (date: Date) => {
  const { year, month, day, hour, minute } = toWall(date.getTime(), timezone)
  return [year, month, day, hour, minute]
}

describe('cron schedule execution preview', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it.each([
    {
      expression: '*/5 * * * *',
      expected: [
        [2024, 1, 15, 10, 5],
        [2024, 1, 15, 10, 10],
        [2024, 1, 15, 10, 15],
      ],
    },
    {
      expression: '0 9-17 * * 1-5',
      expected: [
        [2024, 1, 15, 11, 0],
        [2024, 1, 15, 12, 0],
        [2024, 1, 15, 13, 0],
      ],
    },
    {
      expression: '0 0 1,15 * *',
      expected: [
        [2024, 2, 1, 0, 0],
        [2024, 2, 15, 0, 0],
        [2024, 3, 1, 0, 0],
      ],
    },
    {
      expression: '30 10 15 JUN,DEC *',
      expected: [
        [2024, 6, 15, 10, 30],
        [2024, 12, 15, 10, 30],
        [2025, 6, 15, 10, 30],
      ],
    },
    {
      expression: '0 15 * * MON',
      expected: [
        [2024, 1, 15, 15, 0],
        [2024, 1, 22, 15, 0],
        [2024, 1, 29, 15, 0],
      ],
    },
    {
      expression: '0 15 L * *',
      expected: [
        [2024, 1, 31, 15, 0],
        [2024, 2, 29, 15, 0],
        [2024, 3, 31, 15, 0],
      ],
    },
  ])('previews the next three runs for $expression', ({ expression, expected }) => {
    expect(getNextExecutionTimes(createCronData(expression), 3).map(wallTime('UTC'))).toEqual(
      expected,
    )
  })

  it.each([
    { expression: '@daily', expected: [2024, 1, 16, 0, 0] },
    { expression: '@weekly', expected: [2024, 1, 21, 0, 0] },
    { expression: '@monthly', expected: [2024, 2, 1, 0, 0] },
    { expression: '@yearly', expected: [2025, 1, 1, 0, 0] },
    { expression: '0 9 ? * 1', expected: [2024, 1, 22, 9, 0] },
    { expression: '0 12 * * 7', expected: [2024, 1, 21, 12, 0] },
  ])('supports $expression', ({ expression, expected }) => {
    expect(getNextExecutionTimes(createCronData(expression), 1).map(wallTime('UTC'))).toEqual([
      expected,
    ])
  })

  it.each([
    { timezone: 'UTC', expected: [2024, 1, 15, 12, 0] },
    { timezone: 'America/New_York', expected: [2024, 1, 15, 12, 0] },
    { timezone: 'Asia/Tokyo', expected: [2024, 1, 16, 12, 0] },
    { timezone: 'Asia/Kolkata', expected: [2024, 1, 16, 12, 0] },
    { timezone: 'Australia/Adelaide', expected: [2024, 1, 16, 12, 0] },
    { timezone: 'Pacific/Kiritimati', expected: [2024, 1, 16, 12, 0] },
  ])('chooses the next local noon in $timezone', ({ timezone, expected }) => {
    expect(
      getNextExecutionTimes(createCronData('0 12 * * *', timezone), 1).map(wallTime(timezone)),
    ).toEqual([expected])
  })

  it('previews the daylight-saving gap at 3 AM, then returns to 2 AM', () => {
    vi.setSystemTime(new Date('2024-03-08T10:00:00Z'))
    expect(
      getNextExecutionTimes(createCronData('0 2 * * *', 'America/New_York'), 3).map(
        wallTime('America/New_York'),
      ),
    ).toEqual([
      [2024, 3, 9, 2, 0],
      [2024, 3, 10, 3, 0],
      [2024, 3, 11, 2, 0],
    ])
  })

  it.each([
    '',
    '   ',
    '60 10 1 * *',
    '15 25 1 * *',
    '15 10 32 * *',
    '15 10 1 13 *',
    '15 10 1',
    '15 10 1 * * *',
    'invalid expression',
  ])('shows no schedule for invalid expression %j', (expression) => {
    const data = createCronData(expression)
    expect(getNextExecutionTimes(data)).toEqual([])
    expect(getNextExecutionTime(data)).toBe('--')
  })

  it('formats the next run using the selected timezone calendar date', () => {
    expect(getNextExecutionTime(createCronData('@daily', 'Asia/Tokyo'))).toBe(
      'January 16, 2024, 12:00 AM',
    )
  })
})