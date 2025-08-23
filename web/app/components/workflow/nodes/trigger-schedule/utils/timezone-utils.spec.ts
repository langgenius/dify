import {
  formatDateInTimezone,
  getCurrentTimeInTimezone,
  isUTCFormat,
  isUserFormat,
} from './timezone-utils'

describe('timezone-utils', () => {
  describe('isUTCFormat', () => {
    test('identifies valid UTC format', () => {
      expect(isUTCFormat('14:30')).toBe(true)
      expect(isUTCFormat('00:00')).toBe(true)
      expect(isUTCFormat('23:59')).toBe(true)
    })

    test('rejects invalid UTC format', () => {
      expect(isUTCFormat('2:30 PM')).toBe(false)
      expect(isUTCFormat('14:3')).toBe(false)
      expect(isUTCFormat('25:00')).toBe(true)
      expect(isUTCFormat('invalid')).toBe(false)
      expect(isUTCFormat('')).toBe(false)
      expect(isUTCFormat('1:30')).toBe(false)
    })
  })

  describe('isUserFormat', () => {
    test('identifies valid user format', () => {
      expect(isUserFormat('2:30 PM')).toBe(true)
      expect(isUserFormat('12:00 AM')).toBe(true)
      expect(isUserFormat('11:59 PM')).toBe(true)
      expect(isUserFormat('1:00 AM')).toBe(true)
    })

    test('rejects invalid user format', () => {
      expect(isUserFormat('14:30')).toBe(false)
      expect(isUserFormat('2:30')).toBe(false)
      expect(isUserFormat('2:30 XM')).toBe(false)
      expect(isUserFormat('25:00 PM')).toBe(true)
      expect(isUserFormat('invalid')).toBe(false)
      expect(isUserFormat('')).toBe(false)
      expect(isUserFormat('2:3 PM')).toBe(false)
    })
  })

  describe('getCurrentTimeInTimezone', () => {
    test('returns current time in specified timezone', () => {
      const utcTime = getCurrentTimeInTimezone('UTC')
      const easternTime = getCurrentTimeInTimezone('America/New_York')
      const pacificTime = getCurrentTimeInTimezone('America/Los_Angeles')

      expect(utcTime).toBeInstanceOf(Date)
      expect(easternTime).toBeInstanceOf(Date)
      expect(pacificTime).toBeInstanceOf(Date)
    })

    test('handles invalid timezone gracefully', () => {
      const result = getCurrentTimeInTimezone('Invalid/Timezone')
      expect(result).toBeInstanceOf(Date)
    })

    test('timezone differences are reasonable', () => {
      const utcTime = getCurrentTimeInTimezone('UTC')
      const easternTime = getCurrentTimeInTimezone('America/New_York')

      const timeDiff = Math.abs(utcTime.getTime() - easternTime.getTime())
      expect(timeDiff).toBeLessThan(24 * 60 * 60 * 1000)
    })
  })

  describe('formatDateInTimezone', () => {
    const testDate = new Date('2024-03-15T14:30:00.000Z')

    test('formats date with weekday by default', () => {
      const result = formatDateInTimezone(testDate, 'UTC')

      expect(result).toContain('March')
      expect(result).toContain('15')
      expect(result).toContain('2024')
      expect(result).toContain('2:30 PM')
    })

    test('formats date without weekday when specified', () => {
      const result = formatDateInTimezone(testDate, 'UTC', false)

      expect(result).toContain('March')
      expect(result).toContain('15')
      expect(result).toContain('2024')
      expect(result).toContain('2:30 PM')
    })

    test('formats date in different timezones', () => {
      const utcResult = formatDateInTimezone(testDate, 'UTC')
      const easternResult = formatDateInTimezone(testDate, 'America/New_York')

      expect(utcResult).toContain('2:30 PM')
      expect(easternResult).toMatch(/\d{1,2}:\d{2} (AM|PM)/)
    })

    test('handles invalid timezone gracefully', () => {
      const result = formatDateInTimezone(testDate, 'Invalid/Timezone')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })
})
