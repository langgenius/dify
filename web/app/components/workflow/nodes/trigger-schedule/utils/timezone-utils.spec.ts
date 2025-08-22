import { convertTimeToUTC, convertUTCToUserTimezone } from './timezone-utils'

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

    test('different timezones maintain consistency', () => {
      const originalTime = '9:00 AM'
      const timezones = ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo']

      timezones.forEach((timezone) => {
        const utcTime = convertTimeToUTC(originalTime, timezone)
        const backToUserTime = convertUTCToUserTimezone(utcTime, timezone)

        expect(backToUserTime).toBe(originalTime)
      })
    })

    test('edge cases conversion consistency', () => {
      const edgeCases = ['12:00 AM', '12:00 PM', '11:59 PM', '12:01 AM']
      const timezone = 'America/New_York'

      edgeCases.forEach((time) => {
        const utcTime = convertTimeToUTC(time, timezone)
        const backToUserTime = convertUTCToUserTimezone(utcTime, timezone)

        expect(backToUserTime).toBe(time)
      })
    })
  })
})
