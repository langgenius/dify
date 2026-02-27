import dayjs, {
  convertTimezoneToOffsetStr,
  getDateWithTimezone,
  isDayjsObject,
  toDayjs,
} from './dayjs'

describe('dayjs utilities', () => {
  const timezone = 'UTC'

  it('toDayjs parses time-only strings with timezone support', () => {
    const result = toDayjs('18:45', { timezone })
    expect(result).toBeDefined()
    expect(result?.format('HH:mm')).toBe('18:45')
    expect(result?.utcOffset()).toBe(getDateWithTimezone({ timezone }).utcOffset())
  })

  it('toDayjs parses 12-hour time strings', () => {
    const tz = 'America/New_York'
    const result = toDayjs('07:15 PM', { timezone: tz })
    expect(result).toBeDefined()
    expect(result?.format('HH:mm')).toBe('19:15')
    expect(result?.utcOffset()).toBe(getDateWithTimezone({ timezone: tz }).utcOffset())
  })

  it('isDayjsObject detects dayjs instances', () => {
    const date = dayjs()
    expect(isDayjsObject(date)).toBe(true)
    expect(isDayjsObject(getDateWithTimezone({ timezone }))).toBe(true)
    expect(isDayjsObject('2024-01-01')).toBe(false)
    expect(isDayjsObject({})).toBe(false)
  })

  it('toDayjs parses datetime strings in target timezone', () => {
    const value = '2024-05-01 12:00:00'
    const tz = 'America/New_York'

    const result = toDayjs(value, { timezone: tz })

    expect(result).toBeDefined()
    expect(result?.hour()).toBe(12)
    expect(result?.format('YYYY-MM-DD HH:mm')).toBe('2024-05-01 12:00')
  })

  it('toDayjs parses ISO datetime strings in target timezone', () => {
    const value = '2024-05-01T14:30:00'
    const tz = 'Europe/London'

    const result = toDayjs(value, { timezone: tz })

    expect(result).toBeDefined()
    expect(result?.hour()).toBe(14)
    expect(result?.minute()).toBe(30)
  })

  it('toDayjs handles dates without time component', () => {
    const value = '2024-05-01'
    const tz = 'America/Los_Angeles'

    const result = toDayjs(value, { timezone: tz })

    expect(result).toBeDefined()
    expect(result?.format('YYYY-MM-DD')).toBe('2024-05-01')
    expect(result?.hour()).toBe(0)
    expect(result?.minute()).toBe(0)
  })
})

describe('convertTimezoneToOffsetStr', () => {
  it('should return default UTC+0 for undefined timezone', () => {
    expect(convertTimezoneToOffsetStr(undefined)).toBe('UTC+0')
  })

  it('should return default UTC+0 for invalid timezone', () => {
    expect(convertTimezoneToOffsetStr('Invalid/Timezone')).toBe('UTC+0')
  })

  it('should handle whole hour positive offsets without leading zeros', () => {
    expect(convertTimezoneToOffsetStr('Asia/Shanghai')).toBe('UTC+8')
    expect(convertTimezoneToOffsetStr('Pacific/Auckland')).toBe('UTC+12')
    expect(convertTimezoneToOffsetStr('Pacific/Apia')).toBe('UTC+13')
  })

  it('should handle whole hour negative offsets without leading zeros', () => {
    expect(convertTimezoneToOffsetStr('Pacific/Niue')).toBe('UTC-11')
    expect(convertTimezoneToOffsetStr('Pacific/Honolulu')).toBe('UTC-10')
    expect(convertTimezoneToOffsetStr('America/New_York')).toBe('UTC-5')
  })

  it('should handle zero offset', () => {
    expect(convertTimezoneToOffsetStr('Europe/London')).toBe('UTC+0')
    expect(convertTimezoneToOffsetStr('UTC')).toBe('UTC+0')
  })

  it('should handle half-hour offsets (30 minutes)', () => {
    // India Standard Time: UTC+5:30
    expect(convertTimezoneToOffsetStr('Asia/Kolkata')).toBe('UTC+5:30')
    // Australian Central Time: UTC+9:30
    expect(convertTimezoneToOffsetStr('Australia/Adelaide')).toBe('UTC+9:30')
    expect(convertTimezoneToOffsetStr('Australia/Darwin')).toBe('UTC+9:30')
  })

  it('should handle 45-minute offsets', () => {
    // Chatham Time: UTC+12:45
    expect(convertTimezoneToOffsetStr('Pacific/Chatham')).toBe('UTC+12:45')
  })

  it('should preserve leading zeros in minute part for non-zero minutes', () => {
    // Ensure +05:30 is displayed as "UTC+5:30", not "UTC+5:3"
    const result = convertTimezoneToOffsetStr('Asia/Kolkata')
    expect(result).toMatch(/UTC[+-]\d+:30/)
    expect(result).not.toMatch(/UTC[+-]\d+:3[^0]/)
  })
})
