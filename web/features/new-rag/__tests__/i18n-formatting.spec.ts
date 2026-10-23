import { compactNumber, formatDuration, formatMetricChange } from '../overview/overview-format'
import { formatQualityEvaluationCreatedAt, formatQualityUpdatedAt } from '../quality/quality-model'

describe('knowledge-space locale formatting', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats relative times with the selected application locale', () => {
    expect(formatQualityUpdatedAt('2026-08-19T10:00:00.000Z', 'zh-CN')).toBe('2小时前')
    expect(formatQualityEvaluationCreatedAt('2026-08-19T11:30:00.000Z', '刚刚', 'zh-CN')).toBe(
      '30分钟前',
    )
  })

  it('formats metrics and units with the selected application locale', () => {
    expect(compactNumber(1234, 'de-DE')).toBe('1.234')
    expect(formatDuration(90, 'zh-CN')).toBe('2分钟')
    expect(formatMetricChange(25, 'de-DE')).toEqual({
      direction: 'increase',
      label: '+25 %',
    })
  })
})
