import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import {
  clearMonthMapCache,
  cloneTime,
  convertTimezoneToOffsetStr,
  formatDateForOutput,
  getDateWithTimezone,
  getDaysInMonth,
  getHourIn12Hour,
  isDayjsObject,
  parseDateWithFormat,
  toDayjs,
} from '../dayjs'

dayjs.extend(utc)
dayjs.extend(timezone)

// ── cloneTime ──────────────────────────────────────────────────────────────
describe('cloneTime', () => {
  it('copies hour and minute from source to target, preserving target date', () => {
    const target = dayjs('2024-03-15')
    const source = dayjs('2020-01-01T09:30:00')
    const result = cloneTime(target, source)
    expect(result.format('YYYY-MM-DD')).toBe('2024-03-15')
    expect(result.hour()).toBe(9)
    expect(result.minute()).toBe(30)
  })
})

// ── getDaysInMonth ─────────────────────────────────────────────────────────
describe('getDaysInMonth', () => {
  beforeEach(() => clearMonthMapCache())

  it('returns cells for a typical month view', () => {
    const date = dayjs('2024-01-01')
    const days = getDaysInMonth(date)
    expect(days.length).toBeGreaterThanOrEqual(28)
    expect(days.some(d => d.isCurrentMonth)).toBe(true)
    expect(days.some(d => !d.isCurrentMonth)).toBe(true)
  })

  it('returns cached result on second call', () => {
    const date = dayjs('2024-02-01')
    const first = getDaysInMonth(date)
    const second = getDaysInMonth(date)
    expect(first).toBe(second) // same reference
  })

  it('clears cache properly', () => {
    const date = dayjs('2024-03-01')
    const first = getDaysInMonth(date)
    clearMonthMapCache()
    const second = getDaysInMonth(date)
    expect(first).not.toBe(second) // different reference after clearing
  })
})

// ── getHourIn12Hour ─────────────────────────────────────────────────────────
describe('getHourIn12Hour', () => {
  it('returns 12 for midnight (hour=0)', () => {
    expect(getHourIn12Hour(dayjs().set('hour', 0))).toBe(12)
  })

  it('returns hour-12 for hours >= 12', () => {
    expect(getHourIn12Hour(dayjs().set('hour', 12))).toBe(0)
    expect(getHourIn12Hour(dayjs().set('hour', 15))).toBe(3)
    expect(getHourIn12Hour(dayjs().set('hour', 23))).toBe(11)
  })

  it('returns hour as-is for AM hours (1-11)', () => {
    expect(getHourIn12Hour(dayjs().set('hour', 1))).toBe(1)
    expect(getHourIn12Hour(dayjs().set('hour', 11))).toBe(11)
  })
})

// ── getDateWithTimezone ─────────────────────────────────────────────────────
describe('getDateWithTimezone', () => {
  it('returns a clone of now when neither date nor timezone given', () => {
    const result = getDateWithTimezone({})
    expect(dayjs.isDayjs(result)).toBe(true)
  })

  it('returns current tz date when only timezone given', () => {
    const result = getDateWithTimezone({ timezone: 'UTC' })
    expect(dayjs.isDayjs(result)).toBe(true)
    expect(result.utcOffset()).toBe(0)
  })

  it('returns date in given timezone when both date and timezone given', () => {
    const date = dayjs.utc('2024-06-01T12:00:00Z')
    const result = getDateWithTimezone({ date, timezone: 'UTC' })
    expect(result.hour()).toBe(12)
  })

  it('returns clone of given date when no timezone given', () => {
    const date = dayjs('2024-01-15T08:30:00')
    const result = getDateWithTimezone({ date })
    expect(result.isSame(date)).toBe(true)
  })
})

// ── isDayjsObject ───────────────────────────────────────────────────────────
describe('isDayjsObject', () => {
  it('detects dayjs instances', () => {
    expect(isDayjsObject(dayjs())).toBe(true)
    expect(isDayjsObject(getDateWithTimezone({ timezone: 'UTC' }))).toBe(true)
    expect(isDayjsObject('2024-01-01')).toBe(false)
    expect(isDayjsObject({})).toBe(false)
    expect(isDayjsObject(null)).toBe(false)
    expect(isDayjsObject(undefined)).toBe(false)
  })
})

// ── toDayjs ────────────────────────────────────────────────────────────────
describe('toDayjs', () => {
  const tz = 'UTC'

  it('returns undefined for undefined value', () => {
    expect(toDayjs(undefined)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(toDayjs('')).toBeUndefined()
  })

  it('applies timezone to an existing Dayjs object', () => {
    const date = dayjs('2024-06-01T12:00:00')
    const result = toDayjs(date, { timezone: 'UTC' })
    expect(dayjs.isDayjs(result)).toBe(true)
  })

  it('returns the Dayjs object as-is when no timezone given', () => {
    const date = dayjs('2024-06-01')
    const result = toDayjs(date)
    expect(dayjs.isDayjs(result)).toBe(true)
  })

  it('returns undefined for non-string non-Dayjs value', () => {
    // @ts-expect-error testing invalid input
    expect(toDayjs(12345)).toBeUndefined()
  })

  it('parses 24h time-only strings', () => {
    const result = toDayjs('18:45', { timezone: tz })
    expect(result?.format('HH:mm')).toBe('18:45')
  })

  it('parses time-only strings with seconds', () => {
    const result = toDayjs('09:30:45', { timezone: tz })
    expect(result?.hour()).toBe(9)
    expect(result?.minute()).toBe(30)
    expect(result?.second()).toBe(45)
  })

  it('parses time-only strings with 3-digit milliseconds', () => {
    const result = toDayjs('08:00:00.500', { timezone: tz })
    expect(result?.millisecond()).toBe(500)
  })

  it('parses time-only strings with 3-digit ms - normalizeMillisecond exact branch', () => {
    // normalizeMillisecond: length === 3 → Number('567') = 567
    const result = toDayjs('08:00:00.567', { timezone: tz })
    expect(result).toBeDefined()
    expect(result?.hour()).toBe(8)
    expect(result?.second()).toBe(0)
  })

  it('parses time-only strings with <3-digit milliseconds (pads)', () => {
    const result = toDayjs('08:00:00.5', { timezone: tz })
    expect(result?.millisecond()).toBe(500)
  })

  it('parses 12-hour time strings (PM)', () => {
    const result = toDayjs('07:15 PM', { timezone: 'America/New_York' })
    expect(result?.format('HH:mm')).toBe('19:15')
  })

  it('parses 12-hour time strings (AM)', () => {
    const result = toDayjs('12:00 AM', { timezone: tz })
    expect(result?.hour()).toBe(0)
  })

  it('parses 12-hour time strings with seconds', () => {
    const result = toDayjs('03:30:15 PM', { timezone: tz })
    expect(result?.hour()).toBe(15)
    expect(result?.second()).toBe(15)
  })

  it('parses datetime strings via common formats', () => {
    const result = toDayjs('2024-05-01 12:00:00', { timezone: tz })
    expect(result?.format('YYYY-MM-DD')).toBe('2024-05-01')
  })

  it('parses ISO datetime strings', () => {
    const result = toDayjs('2024-05-01T14:30:00', { timezone: 'Europe/London' })
    expect(result?.hour()).toBe(14)
  })

  it('parses dates with an explicit format option', () => {
    // Use unambiguous format: YYYY/MM/DD + value 2024/05/01
    const result = toDayjs('2024/05/01', { format: 'YYYY/MM/DD', timezone: tz })
    expect(result?.format('YYYY-MM-DD')).toBe('2024-05-01')
  })

  it('falls through to other formats when explicit format fails', () => {
    // '2024-05-01' doesn't match 'DD/MM/YYYY' but will match common formats
    const result = toDayjs('2024-05-01', { format: 'DD/MM/YYYY', timezone: tz })
    expect(result?.format('YYYY-MM-DD')).toBe('2024-05-01')
  })

  it('falls through to common formats when explicit format fails without timezone', () => {
    const result = toDayjs('2024-05-01', { format: 'DD/MM/YYYY' })
    expect(result?.format('YYYY-MM-DD')).toBe('2024-05-01')
  })

  it('returns undefined when explicit format parsing fails and no fallback matches', () => {
    const result = toDayjs('not-a-date-value', { format: 'YYYY/MM/DD' })
    expect(result).toBeUndefined()
  })

  it('uses custom formats array', () => {
    const result = toDayjs('2024/05/01', { formats: ['YYYY/MM/DD'] })
    expect(result?.format('YYYY-MM-DD')).toBe('2024-05-01')
  })

  it('returns undefined for completely invalid string', () => {
    const result = toDayjs('not-a-valid-date-at-all!!!')
    expect(result).toBeUndefined()
  })

  it('parses date-only strings without time', () => {
    const result = toDayjs('2024-05-01', { timezone: 'America/Los_Angeles' })
    expect(result?.format('YYYY-MM-DD')).toBe('2024-05-01')
    expect(result?.hour()).toBe(0)
    expect(result?.minute()).toBe(0)
  })

  it('uses timezone fallback parser for non-standard datetime strings', () => {
    const result = toDayjs('May 1, 2024 2:30 PM', { timezone: 'America/New_York' })
    expect(result?.isValid()).toBe(true)
    expect(result?.year()).toBe(2024)
    expect(result?.month()).toBe(4)
    expect(result?.date()).toBe(1)
    expect(result?.utcOffset()).toBe(dayjs.tz('2024-05-01', 'America/New_York').utcOffset())
  })

  it('uses timezone fallback parser when custom formats are empty', () => {
    const result = toDayjs('2024-05-01T14:30:00Z', {
      timezone: 'America/New_York',
      formats: [],
    })
    expect(result?.isValid()).toBe(true)
    expect(result?.utcOffset()).toBe(dayjs.tz('2024-05-01', 'America/New_York').utcOffset())
  })
})

// ── parseDateWithFormat ────────────────────────────────────────────────────
describe('parseDateWithFormat', () => {
  it('returns null for empty string', () => {
    expect(parseDateWithFormat('')).toBeNull()
  })

  it('parses with explicit format', () => {
    // Use YYYY/MM/DD which is unambiguous
    const result = parseDateWithFormat('2024/05/01', 'YYYY/MM/DD')
    expect(result?.format('YYYY-MM-DD')).toBe('2024-05-01')
  })

  it('returns null for invalid string with explicit format', () => {
    expect(parseDateWithFormat('not-a-date', 'YYYY-MM-DD')).toBeNull()
  })

  it('parses using common formats (YYYY-MM-DD)', () => {
    const result = parseDateWithFormat('2024-05-01')
    expect(result?.format('YYYY-MM-DD')).toBe('2024-05-01')
  })

  it('parses using common formats (YYYY/MM/DD)', () => {
    const result = parseDateWithFormat('2024/05/01')
    expect(result?.format('YYYY-MM-DD')).toBe('2024-05-01')
  })

  it('parses ISO datetime strings via common formats', () => {
    const result = parseDateWithFormat('2024-05-01T14:30:00')
    expect(result?.hour()).toBe(14)
  })

  it('returns null for completely unparseable string', () => {
    expect(parseDateWithFormat('ZZZZ-ZZ-ZZ')).toBeNull()
  })
})

// ── formatDateForOutput ────────────────────────────────────────────────────
describe('formatDateForOutput', () => {
  it('returns empty string for invalid date', () => {
    expect(formatDateForOutput(dayjs('invalid'))).toBe('')
  })

  it('returns date-only format by default (includeTime=false)', () => {
    const date = dayjs('2024-05-01T12:30:00')
    expect(formatDateForOutput(date)).toBe('2024-05-01')
  })

  it('returns ISO datetime string when includeTime=true', () => {
    const date = dayjs('2024-05-01T12:30:00')
    const result = formatDateForOutput(date, true)
    expect(result).toMatch(/^2024-05-01T12:30:00/)
  })
})

// ── convertTimezoneToOffsetStr ─────────────────────────────────────────────
describe('convertTimezoneToOffsetStr', () => {
  it('returns default UTC+0 for undefined timezone', () => {
    expect(convertTimezoneToOffsetStr(undefined)).toBe('UTC+0')
  })

  it('returns default UTC+0 for invalid timezone', () => {
    expect(convertTimezoneToOffsetStr('Invalid/Timezone')).toBe('UTC+0')
  })

  it('handles positive whole-hour offsets', () => {
    expect(convertTimezoneToOffsetStr('Asia/Shanghai')).toBe('UTC+8')
    expect(convertTimezoneToOffsetStr('Pacific/Auckland')).toBe('UTC+12')
    expect(convertTimezoneToOffsetStr('Pacific/Apia')).toBe('UTC+13')
  })

  it('handles negative whole-hour offsets', () => {
    expect(convertTimezoneToOffsetStr('Pacific/Niue')).toBe('UTC-11')
    expect(convertTimezoneToOffsetStr('Pacific/Honolulu')).toBe('UTC-10')
    expect(convertTimezoneToOffsetStr('America/New_York')).toBe('UTC-5')
  })

  it('handles zero offset', () => {
    expect(convertTimezoneToOffsetStr('Europe/London')).toBe('UTC+0')
    expect(convertTimezoneToOffsetStr('UTC')).toBe('UTC+0')
  })

  it('handles half-hour offsets', () => {
    expect(convertTimezoneToOffsetStr('Asia/Kolkata')).toBe('UTC+5:30')
    expect(convertTimezoneToOffsetStr('Australia/Adelaide')).toBe('UTC+9:30')
    expect(convertTimezoneToOffsetStr('Australia/Darwin')).toBe('UTC+9:30')
  })

  it('handles 45-minute offsets', () => {
    expect(convertTimezoneToOffsetStr('Pacific/Chatham')).toBe('UTC+12:45')
  })

  it('preserves leading zeros in minute part', () => {
    const result = convertTimezoneToOffsetStr('Asia/Kolkata')
    expect(result).toMatch(/UTC[+-]\d+:30/)
    expect(result).not.toMatch(/UTC[+-]\d+:3[^0]/)
  })
})
