import { convertLocalSecondsToUTCDaySeconds, convertUTCDaySecondsToLocalSeconds } from '../utils'

describe('auto-update daily clock conversion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should convert local seconds to UTC day seconds correctly', () => {
    const localTimezone = 'Asia/Shanghai'
    const utcSeconds = convertLocalSecondsToUTCDaySeconds(0, localTimezone)
    expect(utcSeconds).toBe((24 - 8) * 3600)
  })

  it('should convert local seconds to UTC day seconds for a specific time', () => {
    const localTimezone = 'Asia/Shanghai'
    expect(
      convertUTCDaySecondsToLocalSeconds(
        convertLocalSecondsToUTCDaySeconds(0, localTimezone),
        localTimezone,
      ),
    ).toBe(0)
  })

  it.each([
    ['2026-11-02T12:00:00Z', 16200],
    ['2026-03-09T12:00:00Z', 12600],
  ])('displays 23:30 across the DST transition preceding %s', (now, utcSeconds) => {
    vi.setSystemTime(new Date(now))
    expect(convertUTCDaySecondsToLocalSeconds(utcSeconds, 'America/New_York')).toBe(84600)
  })

  it.each([
    ['2026-11-01T12:00:00Z', 70200],
    ['2026-03-08T12:00:00Z', 66600],
  ])('saves and restores a 14:30 wall time on the DST transition at %s', (now, utcSeconds) => {
    vi.setSystemTime(new Date(now))
    const saved = convertLocalSecondsToUTCDaySeconds(52200, 'America/New_York')
    expect(saved).toBe(utcSeconds)
    expect(convertUTCDaySecondsToLocalSeconds(saved, 'America/New_York')).toBe(52200)
  })

  it.each([
    ['2026-11-01T12:00:00Z', 16200],
    ['2026-03-08T12:00:00Z', 12600],
  ])('preserves 23:30 when saving crosses the UTC date boundary at %s', (now, utcSeconds) => {
    vi.setSystemTime(new Date(now))
    const saved = convertLocalSecondsToUTCDaySeconds(84600, 'America/New_York')
    expect(saved).toBe(utcSeconds)
    expect(convertUTCDaySecondsToLocalSeconds(saved, 'America/New_York')).toBe(84600)
  })
})
