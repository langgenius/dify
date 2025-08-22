import {
  convertTimeToUTC,
  convertUTCToUserTimezone,
  formatDateInTimezone,
  getCurrentTimeInTimezone,
  isUTCFormat,
  isUserFormat,
} from './timezone-utils'

describe('timezone-utils', () => {
  describe('convertTimeToUTC', () => {
    test('converts Eastern time to UTC correctly', () => {
      const easternTime = '2:30 PM'
      const timezone = 'America/New_York'

      const result = convertTimeToUTC(easternTime, timezone)

      expect(result).toMatch(/^([01]?\d|2[0-3]):[0-5]\d$/)
    })

    test('converts UTC time to UTC correctly', () => {
      const utcTime = '2:30 PM'
      const timezone = 'UTC'

      const result = convertTimeToUTC(utcTime, timezone)

      expect(result).toBe('14:30')
    })

    test('handles midnight correctly', () => {
      const midnightTime = '12:00 AM'
      const timezone = 'UTC'

      const result = convertTimeToUTC(midnightTime, timezone)

      expect(result).toBe('00:00')
    })

    test('handles noon correctly', () => {
      const noonTime = '12:00 PM'
      const timezone = 'UTC'

      const result = convertTimeToUTC(noonTime, timezone)

      expect(result).toBe('12:00')
    })

    test('handles Pacific time to UTC', () => {
      const pacificTime = '9:15 AM'
      const timezone = 'America/Los_Angeles'

      const result = convertTimeToUTC(pacificTime, timezone)

      expect(result).toMatch(/^([01]?\d|2[0-3]):[0-5]\d$/)
    })

    test('handles malformed time gracefully', () => {
      const invalidTime = 'invalid time'
      const timezone = 'UTC'

      const result = convertTimeToUTC(invalidTime, timezone)

      expect(result).toBe(invalidTime)
    })
  })

  describe('convertUTCToUserTimezone', () => {
    test('converts UTC to Eastern time correctly', () => {
      const utcTime = '19:30'
      const timezone = 'America/New_York'

      const result = convertUTCToUserTimezone(utcTime, timezone)

      expect(result).toMatch(/^([1-9]|1[0-2]):[0-5]\d (AM|PM)$/)
    })

    test('converts UTC to UTC correctly', () => {
      const utcTime = '14:30'
      const timezone = 'UTC'

      const result = convertUTCToUserTimezone(utcTime, timezone)

      expect(result).toBe('2:30 PM')
    })

    test('handles midnight UTC correctly', () => {
      const utcTime = '00:00'
      const timezone = 'UTC'

      const result = convertUTCToUserTimezone(utcTime, timezone)

      expect(result).toBe('12:00 AM')
    })

    test('handles noon UTC correctly', () => {
      const utcTime = '12:00'
      const timezone = 'UTC'

      const result = convertUTCToUserTimezone(utcTime, timezone)

      expect(result).toBe('12:00 PM')
    })

    test('handles UTC to Pacific time', () => {
      const utcTime = '17:15'
      const timezone = 'America/Los_Angeles'

      const result = convertUTCToUserTimezone(utcTime, timezone)

      expect(result).toMatch(/^([1-9]|1[0-2]):[0-5]\d (AM|PM)$/)
    })

    test('handles malformed UTC time gracefully', () => {
      const invalidTime = 'invalid'
      const timezone = 'UTC'

      const result = convertUTCToUserTimezone(invalidTime, timezone)

      expect(result).toBe(invalidTime)
    })
  })

  describe('timezone conversion round trip', () => {
    test('UTC round trip conversion', () => {
      const originalTime = '2:30 PM'
      const timezone = 'UTC'

      const utcTime = convertTimeToUTC(originalTime, timezone)
      const backToUserTime = convertUTCToUserTimezone(utcTime, timezone)

      expect(backToUserTime).toBe(originalTime)
    })

    test('different timezones produce valid results', () => {
      const originalTime = '9:00 AM'
      const timezones = ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo']

      timezones.forEach((timezone) => {
        const utcTime = convertTimeToUTC(originalTime, timezone)
        const backToUserTime = convertUTCToUserTimezone(utcTime, timezone)

        expect(utcTime).toMatch(/^\d{2}:\d{2}$/)
        expect(backToUserTime).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/)
      })
    })

    test('edge cases produce valid formats', () => {
      const edgeCases = ['12:00 AM', '12:00 PM', '11:59 PM', '12:01 AM']
      const timezone = 'America/New_York'

      edgeCases.forEach((time) => {
        const utcTime = convertTimeToUTC(time, timezone)
        const backToUserTime = convertUTCToUserTimezone(utcTime, timezone)

        expect(utcTime).toMatch(/^\d{2}:\d{2}$/)
        expect(backToUserTime).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/)
      })
    })
  })

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

  describe('error handling and edge cases', () => {
    test('convertTimeToUTC handles empty strings', () => {
      expect(convertTimeToUTC('', 'UTC')).toBe('')
      expect(convertTimeToUTC('2:30 PM', '')).toBe('2:30 PM')
    })

    test('convertUTCToUserTimezone handles empty strings', () => {
      expect(convertUTCToUserTimezone('', 'UTC')).toBe('')
      expect(convertUTCToUserTimezone('14:30', '')).toBe('14:30')
    })

    test('convertTimeToUTC handles malformed input parts', () => {
      expect(convertTimeToUTC('2:PM', 'UTC')).toBe('2:PM')
      expect(convertTimeToUTC('2:30', 'UTC')).toBe('2:30')
      expect(convertTimeToUTC('ABC:30 PM', 'UTC')).toBe('ABC:30 PM')
    })

    test('convertUTCToUserTimezone handles malformed UTC input', () => {
      expect(convertUTCToUserTimezone('AB:30', 'UTC')).toBe('AB:30')
      expect(convertUTCToUserTimezone('14:', 'UTC')).toBe('14:')
      expect(convertUTCToUserTimezone('14:XX', 'UTC')).toBe('14:XX')
    })
  })
})
