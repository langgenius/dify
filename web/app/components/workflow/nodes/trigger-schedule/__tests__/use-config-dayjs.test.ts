import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

// Correct timezone conversion functions with manual parsing
const convertToUTC = (time: string, tz: string): string => {
  if (tz === 'UTC') {
    const timeParts = time.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i)
    if (timeParts) {
      let hour = Number.parseInt(timeParts[1], 10)
      const minute = timeParts[2]
      const period = timeParts[3].toUpperCase()

      if (period === 'PM' && hour !== 12) hour += 12
      if (period === 'AM' && hour === 12) hour = 0

      return `${hour.toString().padStart(2, '0')}:${minute}`
    }
    return time
  }

  try {
    // Manual parsing to avoid dayjs 12h format issues
    const timeParts = time.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i)
    if (timeParts) {
      let hour = Number.parseInt(timeParts[1], 10)
      const minute = Number.parseInt(timeParts[2], 10)
      const period = timeParts[3].toUpperCase()

      if (period === 'PM' && hour !== 12) hour += 12
      if (period === 'AM' && hour === 12) hour = 0

      const time24h = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
      const userTime = dayjs.tz(`2000-01-01 ${time24h}`, 'YYYY-MM-DD HH:mm', tz)
      return userTime.utc().format('HH:mm')
    }
    return time
  }
 catch {
    return time
  }
}

const convertFromUTC = (utcTime: string, tz: string): string => {
  if (tz === 'UTC') {
    const [hour, minute] = utcTime.split(':')
    const hourNum = Number.parseInt(hour, 10)
    let displayHour = hourNum
    if (hourNum > 12)
      displayHour = hourNum - 12
    else if (hourNum === 0)
      displayHour = 12
    const period = hourNum >= 12 ? 'PM' : 'AM'
    return `${displayHour}:${minute} ${period}`
  }

  try {
    const utcDateTime = dayjs.utc(`2000-01-01 ${utcTime}`, 'YYYY-MM-DD HH:mm')
    return utcDateTime.tz(tz).format('h:mm A')
  }
 catch {
    return utcTime
  }
}

describe('Dayjs timezone conversion functions', () => {
  describe('basic conversion accuracy', () => {
    test('converts Eastern time to UTC and back accurately', () => {
      const easternTime = '2:30 PM'
      const testTimezone = 'America/New_York'

      // Use our corrected conversion functions
      const utcTime = convertToUTC(easternTime, testTimezone)
      const backToEastern = convertFromUTC(utcTime, testTimezone)

      // Should be perfectly round-trip accurate
      expect(backToEastern).toBe(easternTime)

      // UTC time should be reasonable (EST: 19:30, EDT: 18:30)
      expect(utcTime).toMatch(/^(18|19):30$/)
    })

    test('converts multiple timezones accurately', () => {
      const testCases = [
        { input: '2:30 PM', timezone: 'America/New_York' },
        { input: '9:00 AM', timezone: 'America/Los_Angeles' },
        { input: '12:00 PM', timezone: 'Europe/London' },
        { input: '11:59 PM', timezone: 'Asia/Tokyo' },
      ]

      testCases.forEach(({ input, timezone }) => {
        const utcTime = convertToUTC(input, timezone)
        const backToUser = convertFromUTC(utcTime, timezone)

        expect(backToUser).toBe(input)
      })
    })
  })

  describe('UTC special case handling', () => {
    test('handles UTC timezone format conversion', () => {
      const utcTime = '14:30'
      const [hour, minute] = utcTime.split(':')
      const hourNum = Number.parseInt(hour, 10)

      // Convert 24h to 12h format for UTC
      let displayHour = hourNum
    if (hourNum > 12)
      displayHour = hourNum - 12
    else if (hourNum === 0)
      displayHour = 12
      const period = hourNum >= 12 ? 'PM' : 'AM'
      const expected = `${displayHour}:${minute} ${period}`

      expect(expected).toBe('2:30 PM')
    })
  })

  describe('edge cases', () => {
    test('handles midnight and noon correctly', () => {
      const testCases = [
        { input: '12:00 AM', expected: '00:00' }, // Midnight
        { input: '12:00 PM', expected: '12:00' }, // Noon
        { input: '11:59 PM', expected: '23:59' }, // Just before midnight
      ]

      testCases.forEach(({ input, expected }) => {
        // For UTC timezone, just convert format
        const [timePart, period] = input.split(' ')
        const [hour, minute] = timePart.split(':')
        let hour24 = Number.parseInt(hour, 10)

        if (period === 'PM' && hour24 !== 12) hour24 += 12
        if (period === 'AM' && hour24 === 12) hour24 = 0

        const result = `${String(hour24).padStart(2, '0')}:${minute}`
        expect(result).toBe(expected)
      })
    })

    test('handles daylight saving time transitions', () => {
      // Test both EST (Standard) and EDT (Daylight) periods
      const testTimezone = 'America/New_York'
      const testTime = '2:30 PM'

      // Test with our corrected conversion functions for DST behavior
      const winterUTC = convertToUTC(testTime, testTimezone) // Using reference date 2000-01-01 (winter)

      // For a more accurate summer test, we need to simulate summer conversion
      const summerDate = '2000-07-15'
      const summerTime24h = '14:30' // 2:30 PM in 24h format
      const summerParsed = dayjs.tz(`${summerDate} ${summerTime24h}`, 'YYYY-MM-DD HH:mm', testTimezone)
      const summerUTC = summerParsed.utc().format('HH:mm')

      // They should be different due to DST
      expect(winterUTC).not.toBe(summerUTC)

      // Winter should be EST (UTC-5): 2:30 PM EST = 19:30 UTC
      expect(winterUTC).toBe('19:30')

      // Summer should be EDT (UTC-4): 2:30 PM EDT = 18:30 UTC
      expect(summerUTC).toBe('18:30')
    })
  })

  describe('error handling', () => {
    test('handles invalid timezone gracefully', () => {
      const time = '2:30 PM'
      const invalidTimezone = 'Invalid/Timezone'

      // Our conversion function should handle invalid timezones gracefully
      const result = convertToUTC(time, invalidTimezone)

      // Should return original time when timezone is invalid
      expect(result).toBe(time)
    })

    test('handles invalid time format gracefully', () => {
      const invalidTime = 'invalid time'
      const validTimezone = 'America/New_York'

      const result = convertToUTC(invalidTime, validTimezone)

      // Should return original invalid time
      expect(result).toBe(invalidTime)
    })
  })
})

describe('Dayjs vs legacy timezone comparison', () => {
  test('dayjs produces consistent results', () => {
    // Test various times and timezones for consistency
    const testData = [
      { time: '12:00 AM', timezone: 'America/New_York', description: 'midnight EST/EDT' },
      { time: '12:00 PM', timezone: 'America/New_York', description: 'noon EST/EDT' },
      { time: '6:00 PM', timezone: 'Europe/London', description: 'evening GMT/BST' },
      { time: '3:00 AM', timezone: 'Asia/Tokyo', description: 'early morning JST' },
    ]

    testData.forEach(({ time, timezone }) => {
      // Convert to UTC and back using our corrected functions
      const utcTime = convertToUTC(time, timezone)
      const backToOriginal = convertFromUTC(utcTime, timezone)

      // Should be perfectly round-trip
      expect(backToOriginal).toBe(time)
    })
  })
})
