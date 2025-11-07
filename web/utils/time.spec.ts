/**
 * Test suite for time utility functions
 * Tests date comparison and formatting using dayjs
 */
import { formatTime, isAfter } from './time'

describe('time', () => {
  /**
   * Tests isAfter function which compares two dates
   * Returns true if the first date is after the second
   */
  describe('isAfter', () => {
    test('returns true when first date is after second date', () => {
      const date1 = '2024-01-02'
      const date2 = '2024-01-01'
      expect(isAfter(date1, date2)).toBe(true)
    })

    test('returns false when first date is before second date', () => {
      const date1 = '2024-01-01'
      const date2 = '2024-01-02'
      expect(isAfter(date1, date2)).toBe(false)
    })

    test('returns false when dates are equal', () => {
      const date = '2024-01-01'
      expect(isAfter(date, date)).toBe(false)
    })

    test('works with Date objects', () => {
      const date1 = new Date('2024-01-02')
      const date2 = new Date('2024-01-01')
      expect(isAfter(date1, date2)).toBe(true)
    })

    test('works with timestamps', () => {
      const date1 = 1704240000000 // 2024-01-03
      const date2 = 1704153600000 // 2024-01-02
      expect(isAfter(date1, date2)).toBe(true)
    })

    test('handles time differences within same day', () => {
      const date1 = '2024-01-01 12:00:00'
      const date2 = '2024-01-01 11:00:00'
      expect(isAfter(date1, date2)).toBe(true)
    })
  })

  /**
   * Tests formatTime function which formats dates using dayjs
   * Supports various date formats and input types
   */
  describe('formatTime', () => {
    /**
     * Tests basic date formatting with standard format
     */
    test('formats date with YYYY-MM-DD format', () => {
      const date = '2024-01-15'
      const result = formatTime({ date, dateFormat: 'YYYY-MM-DD' })
      expect(result).toBe('2024-01-15')
    })

    test('formats date with custom format', () => {
      const date = '2024-01-15 14:30:00'
      const result = formatTime({ date, dateFormat: 'MMM DD, YYYY HH:mm' })
      expect(result).toBe('Jan 15, 2024 14:30')
    })

    test('formats date with full month name', () => {
      const date = '2024-01-15'
      const result = formatTime({ date, dateFormat: 'MMMM DD, YYYY' })
      expect(result).toBe('January 15, 2024')
    })

    test('formats date with time only', () => {
      const date = '2024-01-15 14:30:45'
      const result = formatTime({ date, dateFormat: 'HH:mm:ss' })
      expect(result).toBe('14:30:45')
    })

    test('works with Date objects', () => {
      const date = new Date(2024, 0, 15) // Month is 0-indexed
      const result = formatTime({ date, dateFormat: 'YYYY-MM-DD' })
      expect(result).toBe('2024-01-15')
    })

    test('works with timestamps', () => {
      const date = 1705276800000 // 2024-01-15 00:00:00 UTC
      const result = formatTime({ date, dateFormat: 'YYYY-MM-DD' })
      expect(result).toContain('2024-01-1') // Account for timezone differences
    })

    test('handles ISO 8601 format', () => {
      const date = '2024-01-15T14:30:00Z'
      const result = formatTime({ date, dateFormat: 'YYYY-MM-DD HH:mm' })
      expect(result).toContain('2024-01-15')
    })
  })
})
