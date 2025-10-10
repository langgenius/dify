import dayjs from './dayjs'
import {
  getDateWithTimezone,
  isDayjsObject,
  toDayjs,
} from './dayjs'

describe('dayjs utilities', () => {
  const timezone = 'UTC'

  test('toDayjs parses time-only strings with timezone support', () => {
    const result = toDayjs('18:45', { timezone })
    expect(result).toBeDefined()
    expect(result?.format('HH:mm')).toBe('18:45')
    expect(result?.utcOffset()).toBe(getDateWithTimezone({ timezone }).utcOffset())
  })

  test('toDayjs parses 12-hour time strings', () => {
    const tz = 'America/New_York'
    const result = toDayjs('07:15 PM', { timezone: tz })
    expect(result).toBeDefined()
    expect(result?.format('HH:mm')).toBe('19:15')
    expect(result?.utcOffset()).toBe(getDateWithTimezone({ timezone: tz }).utcOffset())
  })

  test('isDayjsObject detects dayjs instances', () => {
    const date = dayjs()
    expect(isDayjsObject(date)).toBe(true)
    expect(isDayjsObject(getDateWithTimezone({ timezone }))).toBe(true)
    expect(isDayjsObject('2024-01-01')).toBe(false)
    expect(isDayjsObject({})).toBe(false)
  })

  test('toDayjs parses datetime strings in target timezone', () => {
    const value = '2024-05-01 12:00:00'
    const tz = 'America/New_York'

    const result = toDayjs(value, { timezone: tz })

    expect(result).toBeDefined()
    expect(result?.hour()).toBe(12)
    expect(result?.format('YYYY-MM-DD HH:mm')).toBe('2024-05-01 12:00')
  })

  test('toDayjs parses ISO datetime strings in target timezone', () => {
    const value = '2024-05-01T14:30:00'
    const tz = 'Europe/London'

    const result = toDayjs(value, { timezone: tz })

    expect(result).toBeDefined()
    expect(result?.hour()).toBe(14)
    expect(result?.minute()).toBe(30)
  })

  test('toDayjs handles dates without time component', () => {
    const value = '2024-05-01'
    const tz = 'America/Los_Angeles'

    const result = toDayjs(value, { timezone: tz })

    expect(result).toBeDefined()
    expect(result?.format('YYYY-MM-DD')).toBe('2024-05-01')
    expect(result?.hour()).toBe(0)
    expect(result?.minute()).toBe(0)
  })
})
