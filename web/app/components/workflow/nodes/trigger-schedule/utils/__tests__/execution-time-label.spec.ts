import type { ScheduleTriggerNodeType } from '../../types'
import { BlockEnum } from '../../../../types'
import { getFormattedExecutionTimes } from '../execution-time-calculator'

describe('execution time offset label', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the offset in effect on each run date across the end of DST', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'))

    const data = {
      type: BlockEnum.TriggerSchedule,
      title: 'schedule',
      mode: 'visual',
      frequency: 'daily',
      timezone: 'America/New_York',
      visual_config: { time: '12:00 AM' },
    } as ScheduleTriggerNodeType

    const times = getFormattedExecutionTimes(data, 4)

    expect(times[0]).toContain('October 31, 2026')
    expect(times[0]).toContain('(UTC-4)')
    expect(times[1]).toContain('November 1, 2026')
    expect(times[1]).toContain('(UTC-4)')
    expect(times[2]).toContain('November 2, 2026')
    expect(times[2]).toContain('(UTC-5)')
  })

  it('labels the repeated hour by its real offset when DST ends', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T03:00:00Z'))

    const data = {
      type: BlockEnum.TriggerSchedule,
      title: 'schedule',
      mode: 'cron',
      cron_expression: '30 * * * *',
      timezone: 'America/New_York',
    } as ScheduleTriggerNodeType

    const times = getFormattedExecutionTimes(data, 5)

    expect(times[2]).toMatch(/November 1, 2026, 1:30\sAM \(UTC-4\)/)
    expect(times[3]).toMatch(/November 1, 2026, 1:30\sAM \(UTC-5\)/)
  })
})
