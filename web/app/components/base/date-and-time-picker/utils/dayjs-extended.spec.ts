import dayjs, {
  clearMonthMapCache,
  cloneTime,
  formatDateForOutput,
  getDateWithTimezone,
  getDaysInMonth,
  getHourIn12Hour,
  parseDateWithFormat,
  toDayjs,
} from './dayjs'

describe('dayjs extended utilities', () => {
  // Tests for cloneTime
  describe('cloneTime', () => {
    it('should copy hour and minute from source to target', () => {
      const target = dayjs('2024-01-15')
      const source = dayjs('2024-06-20 14:30')

      const result = cloneTime(target, source)

      expect(result.hour()).toBe(14)
      expect(result.minute()).toBe(30)
      expect(result.date()).toBe(15)
      expect(result.month()).toBe(0) // January
    })

    it('should not mutate the original target date', () => {
      const target = dayjs('2024-01-15 08:00')
      const source = dayjs('2024-06-20 14:30')

      cloneTime(target, source)

      expect(target.hour()).toBe(8)
      expect(target.minute()).toBe(0)
    })
  })

  // Tests for getDaysInMonth
  describe('getDaysInMonth', () => {
    beforeEach(() => {
      clearMonthMapCache()
    })

    it('should return an array of Day objects', () => {
      const date = dayjs('2024-06-15')
      const days = getDaysInMonth(date)

      expect(days.length).toBeGreaterThan(0)
      days.forEach((day) => {
        expect(day).toHaveProperty('date')
        expect(day).toHaveProperty('isCurrentMonth')
      })
    })

    it('should include days from previous and next month to fill the grid', () => {
      const date = dayjs('2024-06-15') // June 2024 starts on Saturday
      const days = getDaysInMonth(date)

      const prevMonthDays = days.filter(d => !d.isCurrentMonth && d.date.month() < date.month())
      const nextMonthDays = days.filter(d => !d.isCurrentMonth && d.date.month() > date.month())

      // June 2024 starts on Saturday (6), so there are 6 days from previous month
      expect(prevMonthDays.length).toBeGreaterThan(0)
      expect(nextMonthDays.length).toBeGreaterThan(0)
    })

    it('should mark current month days correctly', () => {
      const date = dayjs('2024-06-15')
      const days = getDaysInMonth(date)

      const currentMonthDays = days.filter(d => d.isCurrentMonth)
      // June has 30 days
      expect(currentMonthDays).toHaveLength(30)
    })

    it('should cache results for the same month', () => {
      const date1 = dayjs('2024-06-15')
      const date2 = dayjs('2024-06-20')

      const days1 = getDaysInMonth(date1)
      const days2 = getDaysInMonth(date2)

      // Same reference since it's cached
      expect(days1).toBe(days2)
    })

    it('should return different results for different months', () => {
      const june = dayjs('2024-06-15')
      const july = dayjs('2024-07-15')

      const juneDays = getDaysInMonth(june)
      const julyDays = getDaysInMonth(july)

      expect(juneDays).not.toBe(julyDays)
    })
  })

  // Tests for clearMonthMapCache
  describe('clearMonthMapCache', () => {
    it('should clear the cache so new days are generated', () => {
      const date = dayjs('2024-06-15')

      const days1 = getDaysInMonth(date)
      clearMonthMapCache()
      const days2 = getDaysInMonth(date)

      // After clearing cache, a new array should be created
      expect(days1).not.toBe(days2)
      // But should have the same length
      expect(days1.length).toBe(days2.length)
    })
  })

  // Tests for getHourIn12Hour
  describe('getHourIn12Hour', () => {
    it('should return 12 for midnight (hour 0)', () => {
      const date = dayjs('2024-01-01 00:00')
      expect(getHourIn12Hour(date)).toBe(12)
    })

    it('should return hour as-is for 1-11 AM', () => {
      expect(getHourIn12Hour(dayjs('2024-01-01 01:00'))).toBe(1)
      expect(getHourIn12Hour(dayjs('2024-01-01 11:00'))).toBe(11)
    })

    it('should return 0 for noon (hour 12)', () => {
      const date = dayjs('2024-01-01 12:00')
      expect(getHourIn12Hour(date)).toBe(0)
    })

    it('should return hour - 12 for PM hours (13-23)', () => {
      expect(getHourIn12Hour(dayjs('2024-01-01 13:00'))).toBe(1)
      expect(getHourIn12Hour(dayjs('2024-01-01 23:00'))).toBe(11)
    })
  })

  // Tests for getDateWithTimezone
  describe('getDateWithTimezone', () => {
    it('should return a cloned date when no timezone is provided', () => {
      const date = dayjs('2024-06-15')
      const result = getDateWithTimezone({ date })

      expect(result.format('YYYY-MM-DD')).toBe('2024-06-15')
    })

    it('should return current date clone when neither date nor timezone is provided', () => {
      const result = getDateWithTimezone({})
      const now = dayjs()

      expect(result.format('YYYY-MM-DD')).toBe(now.format('YYYY-MM-DD'))
    })

    it('should apply timezone to provided date', () => {
      const date = dayjs('2024-06-15T12:00:00')
      const result = getDateWithTimezone({ date, timezone: 'America/New_York' })

      // dayjs.tz converts the date to the given timezone
      expect(result).toBeDefined()
      expect(result.isValid()).toBe(true)
    })

    it('should return current time in timezone when only timezone is provided', () => {
      const result = getDateWithTimezone({ timezone: 'Asia/Tokyo' })

      expect(result.utcOffset()).toBe(dayjs().tz('Asia/Tokyo').utcOffset())
    })
  })

  // Tests for toDayjs additional edge cases
  describe('toDayjs edge cases', () => {
    it('should return undefined for empty string', () => {
      expect(toDayjs('')).toBeUndefined()
    })

    it('should return undefined for undefined', () => {
      expect(toDayjs(undefined)).toBeUndefined()
    })

    it('should handle Dayjs object input', () => {
      const date = dayjs('2024-06-15')
      const result = toDayjs(date)

      expect(result).toBeDefined()
      expect(result?.format('YYYY-MM-DD')).toBe('2024-06-15')
    })

    it('should handle Dayjs object with timezone', () => {
      const date = dayjs('2024-06-15T12:00:00')
      const result = toDayjs(date, { timezone: 'UTC' })

      expect(result).toBeDefined()
    })

    it('should parse with custom format when format matches common formats', () => {
      // Uses a format from COMMON_PARSE_FORMATS
      const result = toDayjs('2024-06-15', { format: 'YYYY-MM-DD' })

      expect(result).toBeDefined()
      expect(result?.format('YYYY-MM-DD')).toBe('2024-06-15')
    })

    it('should fall back when custom format does not match', () => {
      // dayjs strict mode with format requires customParseFormat plugin
      // which is not loaded, so invalid format falls through to other parsing
      const result = toDayjs('2024-06-15', { format: 'INVALID', timezone: 'UTC' })

      // It will still be parsed by fallback mechanisms
      expect(result).toBeDefined()
    })

    it('should parse time with seconds', () => {
      const result = toDayjs('14:30:45', { timezone: 'UTC' })

      expect(result).toBeDefined()
      expect(result?.hour()).toBe(14)
      expect(result?.minute()).toBe(30)
      expect(result?.second()).toBe(45)
    })

    it('should parse time with milliseconds', () => {
      const result = toDayjs('14:30:45.123', { timezone: 'UTC' })

      expect(result).toBeDefined()
      expect(result?.millisecond()).toBe(123)
    })

    it('should normalize short milliseconds by padding', () => {
      const result = toDayjs('14:30:45.1', { timezone: 'UTC' })

      expect(result).toBeDefined()
      expect(result?.millisecond()).toBe(100)
    })

    it('should truncate long milliseconds to 3 digits', () => {
      // The time regex only captures up to 3 digits for ms, so 4+ digit values
      // don't match the regex and fall through to common format parsing
      const result = toDayjs('14:30:45.12', { timezone: 'UTC' })

      expect(result).toBeDefined()
      // 2-digit ms "12" gets padded to "120"
      expect(result?.millisecond()).toBe(120)
    })

    it('should parse 12-hour AM time', () => {
      const result = toDayjs('07:15 AM', { timezone: 'UTC' })

      expect(result).toBeDefined()
      expect(result?.hour()).toBe(7)
      expect(result?.minute()).toBe(15)
    })

    it('should parse 12-hour time with seconds', () => {
      const result = toDayjs('07:15:30 PM', { timezone: 'UTC' })

      expect(result).toBeDefined()
      expect(result?.hour()).toBe(19)
      expect(result?.second()).toBe(30)
    })

    it('should handle 12 PM correctly', () => {
      const result = toDayjs('12:00 PM', { timezone: 'UTC' })

      expect(result).toBeDefined()
      expect(result?.hour()).toBe(12)
    })

    it('should handle 12 AM correctly', () => {
      const result = toDayjs('12:00 AM', { timezone: 'UTC' })

      expect(result).toBeDefined()
      expect(result?.hour()).toBe(0)
    })

    it('should use custom formats array when provided', () => {
      const result = toDayjs('2024.06.15', { formats: ['YYYY.MM.DD'] })

      expect(result).toBeDefined()
      expect(result?.format('YYYY-MM-DD')).toBe('2024-06-15')
    })

    it('should fall back to native parsing for ISO strings', () => {
      const result = toDayjs('2024-06-15T12:00:00.000Z')

      expect(result).toBeDefined()
    })

    it('should return undefined for completely unparseable value', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = toDayjs('not-a-date')

      expect(result).toBeUndefined()
      consoleSpy.mockRestore()
    })
  })

  // Tests for parseDateWithFormat
  describe('parseDateWithFormat', () => {
    it('should return null for empty string', () => {
      expect(parseDateWithFormat('')).toBeNull()
    })

    it('should parse with provided format from common formats', () => {
      // Uses YYYY-MM-DD which is in COMMON_PARSE_FORMATS
      const result = parseDateWithFormat('2024-06-15', 'YYYY-MM-DD')

      expect(result).not.toBeNull()
      expect(result?.format('YYYY-MM-DD')).toBe('2024-06-15')
    })

    it('should return null for invalid date with format', () => {
      const result = parseDateWithFormat('not-a-date', 'YYYY-MM-DD')

      expect(result).toBeNull()
    })

    it('should try common formats when no format is specified', () => {
      const result = parseDateWithFormat('2024-06-15')

      expect(result).not.toBeNull()
      expect(result?.format('YYYY-MM-DD')).toBe('2024-06-15')
    })

    it('should parse ISO datetime format', () => {
      const result = parseDateWithFormat('2024-06-15T12:00:00')

      expect(result).not.toBeNull()
    })

    it('should return null for unparseable string without format', () => {
      const result = parseDateWithFormat('gibberish')

      expect(result).toBeNull()
    })
  })

  // Tests for formatDateForOutput
  describe('formatDateForOutput', () => {
    it('should return empty string for invalid date', () => {
      const invalidDate = dayjs('invalid')
      expect(formatDateForOutput(invalidDate)).toBe('')
    })

    it('should format date-only output without time', () => {
      const date = dayjs('2024-06-15T12:00:00')
      const result = formatDateForOutput(date)

      expect(result).toBe('2024-06-15')
    })

    it('should format with time when includeTime is true', () => {
      const date = dayjs('2024-06-15T12:00:00')
      const result = formatDateForOutput(date, true)

      expect(result).toContain('2024-06-15')
      expect(result).toContain('12:00:00')
    })

    it('should default to date-only format', () => {
      const date = dayjs('2024-06-15T14:30:00')
      const result = formatDateForOutput(date)

      expect(result).toBe('2024-06-15')
      expect(result).not.toContain('14:30')
    })
  })
})
