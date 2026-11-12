import type { ScheduleTriggerNodeType } from '../../types'
import { BlockEnum } from '../../../../types'
import { getFormattedExecutionTimes, resolveTimezone } from '../execution-time-calculator'

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

describe('resolveTimezone', () => {
  const browserTimezone = () => {
    try {
      return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }

  it('returns a runtime-valid timezone instead of a non-IANA node value', () => {
    expect(resolveTimezone('GMT+8')).toBe(browserTimezone())
    expect(resolveTimezone('GMT+8')).not.toBe('GMT+8')
  })

  it('falls back to the browser timezone for an unset value', () => {
    expect(resolveTimezone(undefined)).toBe(browserTimezone())
  })

  it('passes through a valid IANA timezone unchanged', () => {
    expect(resolveTimezone('Asia/Shanghai')).toBe('Asia/Shanghai')
  })

  it('returns a value the runtime accepts as a timeZone option', () => {
    const resolved = resolveTimezone('GMT+8')
    expect(() =>
      new Intl.DateTimeFormat('en-US', { timeZone: resolved }).format(new Date()),
    ).not.toThrow()
    expect(() =>
      new Intl.DateTimeFormat('en-US', { timeZone: 'GMT+8' }).format(new Date()),
    ).toThrow()
  })
})
