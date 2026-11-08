import type { ScheduleTriggerNodeType } from '../../types'
import { BlockEnum } from '../../../../types'
import { getFormattedExecutionTimes } from '../execution-time-calculator'

describe('invalid timezone string in the node data', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not throw in visual daily mode for a non-IANA timezone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-08T06:00:00Z'))

    // Timezone strings like this reach the frontend through hand-edited DSL imports.
    const data: ScheduleTriggerNodeType = {
      type: BlockEnum.TriggerSchedule,
      title: 'schedule',
      desc: '',
      mode: 'visual',
      frequency: 'daily',
      timezone: 'GMT+8',
      visual_config: { time: '9:00 AM' },
    }

    expect(() => getFormattedExecutionTimes(data, 1)).not.toThrow()
  })

  it('does not throw in visual hourly mode for a non-IANA timezone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-08T06:00:00Z'))

    const data: ScheduleTriggerNodeType = {
      type: BlockEnum.TriggerSchedule,
      title: 'schedule',
      desc: '',
      mode: 'visual',
      frequency: 'hourly',
      timezone: 'Not/AZone',
      visual_config: { on_minute: 30 },
    }

    expect(() => getFormattedExecutionTimes(data, 1)).not.toThrow()
  })

  it('does not throw in visual weekly mode for a non-IANA timezone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-08T06:00:00Z'))

    const data: ScheduleTriggerNodeType = {
      type: BlockEnum.TriggerSchedule,
      title: 'schedule',
      desc: '',
      mode: 'visual',
      frequency: 'weekly',
      timezone: 'UTC+2',
      visual_config: { time: '9:00 AM', weekdays: ['mon'] },
    }

    expect(() => getFormattedExecutionTimes(data, 1)).not.toThrow()
  })
})
