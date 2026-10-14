import type { ScheduleTriggerNodeType } from '../../types'
import { BlockEnum } from '../../../../types'
import { getFormattedExecutionTimes, getNextExecutionTime } from '../execution-time-calculator'

const createHourlyData = (): ScheduleTriggerNodeType =>
  ({
    type: BlockEnum.TriggerSchedule,
    title: 'schedule',
    mode: 'visual',
    frequency: 'hourly',
    timezone: 'Asia/Seoul',
    visual_config: { on_minute: 0 },
  }) as ScheduleTriggerNodeType

describe('hourly runs across the end of a month', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('moves to the first day of the next month after midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T13:30:00Z'))

    const times = getFormattedExecutionTimes(createHourlyData(), 3)

    expect(times[0]).toMatch(/October 31, 2026, 11:00\sPM/)
    expect(times[1]).toMatch(/November 1, 2026, 12:00\sAM/)
    expect(times[2]).toMatch(/November 1, 2026, 1:00\sAM/)
  })

  it('moves to January 1 of the next year after New Year midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-12-31T14:30:00Z'))

    expect(getNextExecutionTime(createHourlyData())).toMatch(/January 1, 2027, 12:00\sAM/)
  })
})
