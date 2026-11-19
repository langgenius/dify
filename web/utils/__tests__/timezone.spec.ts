import { convertTimezoneToOffsetStr } from '../timezone'

describe('convertTimezoneToOffsetStr', () => {
  it('follows daylight saving time for the given date', () => {
    expect(convertTimezoneToOffsetStr('America/New_York', new Date('2026-07-01T12:00:00Z'))).toBe(
      'UTC-4',
    )
    expect(convertTimezoneToOffsetStr('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(
      'UTC-5',
    )
  })

  it('keeps minutes for half-hour offsets', () => {
    expect(convertTimezoneToOffsetStr('Asia/Kolkata', new Date('2026-07-01T12:00:00Z'))).toBe(
      'UTC+5:30',
    )
    expect(convertTimezoneToOffsetStr('America/St_Johns', new Date('2026-01-15T12:00:00Z'))).toBe(
      'UTC-3:30',
    )
  })

  it('returns UTC+0 for UTC, a missing timezone, and an unknown timezone', () => {
    expect(convertTimezoneToOffsetStr('UTC')).toBe('UTC+0')
    expect(convertTimezoneToOffsetStr(undefined)).toBe('UTC+0')
    expect(convertTimezoneToOffsetStr('Not/AZone')).toBe('UTC+0')
  })
})
