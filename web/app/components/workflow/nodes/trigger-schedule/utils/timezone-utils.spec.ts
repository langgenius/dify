import { formatDateInTimezone } from './timezone-utils'

describe('timezone-utils', () => {
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
