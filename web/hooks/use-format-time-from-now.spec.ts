import type { Mock } from 'vitest'
/**
 * Test suite for useFormatTimeFromNow hook
 *
 * This hook provides internationalized relative time formatting (e.g., "2 hours ago", "3 days ago")
 * using dayjs with the relativeTime plugin. It automatically uses the correct locale based on
 * the user's i18n settings.
 *
 * Key features:
 * - Supports 20+ locales with proper translations
 * - Automatically syncs with user's interface language
 * - Uses dayjs for consistent time calculations
 * - Returns human-readable relative time strings
 */
import { renderHook } from '@testing-library/react'
// Import after mock to get the mocked version
import { useLocale } from '@/context/i18n'

import { useFormatTimeFromNow } from './use-format-time-from-now'

// Mock the i18n context
vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(() => 'en-US'),
}))

describe('useFormatTimeFromNow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic functionality', () => {
    /**
     * Test that the hook returns a formatTimeFromNow function
     * This is the primary interface of the hook
     */
    it('should return formatTimeFromNow function', () => {
      const { result } = renderHook(() => useFormatTimeFromNow())

      expect(result.current).toHaveProperty('formatTimeFromNow')
      expect(typeof result.current.formatTimeFromNow).toBe('function')
    })

    /**
     * Test basic relative time formatting with English locale
     * Should return human-readable relative time strings
     */
    it('should format time from now in English', () => {
      ;(useLocale as Mock).mockReturnValue('en-US')

      const { result } = renderHook(() => useFormatTimeFromNow())

      const now = Date.now()
      const oneHourAgo = now - (60 * 60 * 1000)
      const formatted = result.current.formatTimeFromNow(oneHourAgo)

      // Should contain "hour" or "hours" and "ago"
      expect(formatted).toMatch(/hour|hours/)
      expect(formatted).toMatch(/ago/)
    })

    /**
     * Test that recent times are formatted as "a few seconds ago"
     * Very recent timestamps should show seconds
     */
    it('should format very recent times', () => {
      ;(useLocale as Mock).mockReturnValue('en-US')

      const { result } = renderHook(() => useFormatTimeFromNow())

      const now = Date.now()
      const fiveSecondsAgo = now - (5 * 1000)
      const formatted = result.current.formatTimeFromNow(fiveSecondsAgo)

      expect(formatted).toMatch(/second|seconds|few seconds/)
    })

    /**
     * Test formatting of times in the past (days ago)
     * Should handle day-level granularity
     */
    it('should format times from days ago', () => {
      ;(useLocale as Mock).mockReturnValue('en-US')

      const { result } = renderHook(() => useFormatTimeFromNow())

      const now = Date.now()
      const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000)
      const formatted = result.current.formatTimeFromNow(threeDaysAgo)

      expect(formatted).toMatch(/day|days/)
      expect(formatted).toMatch(/ago/)
    })

    /**
     * Test formatting of future times
     * dayjs fromNow also supports future times (e.g., "in 2 hours")
     */
    it('should format future times', () => {
      ;(useLocale as Mock).mockReturnValue('en-US')

      const { result } = renderHook(() => useFormatTimeFromNow())

      const now = Date.now()
      const twoHoursFromNow = now + (2 * 60 * 60 * 1000)
      const formatted = result.current.formatTimeFromNow(twoHoursFromNow)

      expect(formatted).toMatch(/in/)
      expect(formatted).toMatch(/hour|hours/)
    })
  })

  describe('Locale support', () => {
    /**
     * Test Chinese (Simplified) locale formatting
     * Should use Chinese characters for time units
     */
    it('should format time in Chinese (Simplified)', () => {
      ;(useLocale as Mock).mockReturnValue('zh-Hans')

      const { result } = renderHook(() => useFormatTimeFromNow())

      const now = Date.now()
      const oneHourAgo = now - (60 * 60 * 1000)
      const formatted = result.current.formatTimeFromNow(oneHourAgo)

      // Chinese should contain Chinese characters
      expect(formatted).toMatch(/[\u4E00-\u9FA5]/)
    })

    /**
     * Test Spanish locale formatting
     * Should use Spanish words for relative time
     */
    it('should format time in Spanish', () => {
      ;(useLocale as Mock).mockReturnValue('es-ES')

      const { result } = renderHook(() => useFormatTimeFromNow())

      const now = Date.now()
      const oneHourAgo = now - (60 * 60 * 1000)
      const formatted = result.current.formatTimeFromNow(oneHourAgo)

      // Spanish should contain "hace" (ago)
      expect(formatted).toMatch(/hace/)
    })

    /**
     * Test French locale formatting
     * Should use French words for relative time
     */
    it('should format time in French', () => {
      ;(useLocale as Mock).mockReturnValue('fr-FR')

      const { result } = renderHook(() => useFormatTimeFromNow())

      const now = Date.now()
      const oneHourAgo = now - (60 * 60 * 1000)
      const formatted = result.current.formatTimeFromNow(oneHourAgo)

      // French should contain "il y a" (ago)
      expect(formatted).toMatch(/il y a/)
    })

    /**
     * Test Japanese locale formatting
     * Should use Japanese characters
     */
    it('should format time in Japanese', () => {
      ;(useLocale as Mock).mockReturnValue('ja-JP')

      const { result } = renderHook(() => useFormatTimeFromNow())

      const now = Date.now()
      const oneHourAgo = now - (60 * 60 * 1000)
      const formatted = result.current.formatTimeFromNow(oneHourAgo)

      // Japanese should contain Japanese characters
      expect(formatted).toMatch(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/)
    })

    /**
     * Test Portuguese (Brazil) locale formatting
     * Should use pt-br locale mapping
     */
    it('should format time in Portuguese (Brazil)', () => {
      ;(useLocale as Mock).mockReturnValue('pt-BR')

      const { result } = renderHook(() => useFormatTimeFromNow())

      const now = Date.now()
      const oneHourAgo = now - (60 * 60 * 1000)
      const formatted = result.current.formatTimeFromNow(oneHourAgo)

      // Portuguese should contain "há" (ago)
      expect(formatted).toMatch(/há/)
    })

    /**
     * Test fallback to English for unsupported locales
     * Unknown locales should default to English
     */
    it('should fallback to English for unsupported locale', () => {
      ;(useLocale as Mock).mockReturnValue('xx-XX' as any)

      const { result } = renderHook(() => useFormatTimeFromNow())

      const now = Date.now()
      const oneHourAgo = now - (60 * 60 * 1000)
      const formatted = result.current.formatTimeFromNow(oneHourAgo)

      // Should still return a valid string (in English)
      expect(typeof formatted).toBe('string')
      expect(formatted.length).toBeGreaterThan(0)
    })
  })

  describe('Edge cases', () => {
    /**
     * Test handling of timestamp 0 (Unix epoch)
     * Should format as a very old date
     */
    it('should handle timestamp 0', () => {
      ;(useLocale as Mock).mockReturnValue('en-US')

      const { result } = renderHook(() => useFormatTimeFromNow())

      const formatted = result.current.formatTimeFromNow(0)

      expect(typeof formatted).toBe('string')
      expect(formatted.length).toBeGreaterThan(0)
      expect(formatted).toMatch(/year|years/)
    })

    /**
     * Test handling of very large timestamps
     * Should handle dates far in the future
     */
    it('should handle very large timestamps', () => {
      ;(useLocale as Mock).mockReturnValue('en-US')

      const { result } = renderHook(() => useFormatTimeFromNow())

      const farFuture = Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year from now
      const formatted = result.current.formatTimeFromNow(farFuture)

      expect(typeof formatted).toBe('string')
      expect(formatted).toMatch(/in/)
    })

    /**
     * Test that the function is memoized based on locale
     * Changing locale should update the function
     */
    it('should update when locale changes', () => {
      const { result, rerender } = renderHook(() => useFormatTimeFromNow())

      const now = Date.now()
      const oneHourAgo = now - (60 * 60 * 1000)

      // First render with English
      ;(useLocale as Mock).mockReturnValue('en-US')
      rerender()
      const englishResult = result.current.formatTimeFromNow(oneHourAgo)

      // Second render with Spanish
      ;(useLocale as Mock).mockReturnValue('es-ES')
      rerender()
      const spanishResult = result.current.formatTimeFromNow(oneHourAgo)

      // Results should be different
      expect(englishResult).not.toBe(spanishResult)
    })
  })

  describe('Time granularity', () => {
    /**
     * Test different time granularities (seconds, minutes, hours, days, months, years)
     * dayjs should automatically choose the appropriate unit
     */
    it('should use appropriate time units for different durations', () => {
      ;(useLocale as Mock).mockReturnValue('en-US')

      const { result } = renderHook(() => useFormatTimeFromNow())

      const now = Date.now()

      // Seconds
      const seconds = result.current.formatTimeFromNow(now - 30 * 1000)
      expect(seconds).toMatch(/second/)

      // Minutes
      const minutes = result.current.formatTimeFromNow(now - 5 * 60 * 1000)
      expect(minutes).toMatch(/minute/)

      // Hours
      const hours = result.current.formatTimeFromNow(now - 3 * 60 * 60 * 1000)
      expect(hours).toMatch(/hour/)

      // Days
      const days = result.current.formatTimeFromNow(now - 5 * 24 * 60 * 60 * 1000)
      expect(days).toMatch(/day/)

      // Months
      const months = result.current.formatTimeFromNow(now - 60 * 24 * 60 * 60 * 1000)
      expect(months).toMatch(/month/)
    })
  })

  describe('Locale mapping', () => {
    /**
     * Test that all supported locales in the localeMap are handled correctly
     * This ensures the mapping from app locales to dayjs locales works
     */
    it('should handle all mapped locales', () => {
      const locales = [
        'en-US',
        'zh-Hans',
        'zh-Hant',
        'pt-BR',
        'es-ES',
        'fr-FR',
        'de-DE',
        'ja-JP',
        'ko-KR',
        'ru-RU',
        'it-IT',
        'th-TH',
        'id-ID',
        'uk-UA',
        'vi-VN',
        'ro-RO',
        'pl-PL',
        'hi-IN',
        'tr-TR',
        'fa-IR',
        'sl-SI',
      ]

      const now = Date.now()
      const oneHourAgo = now - (60 * 60 * 1000)

      locales.forEach((locale) => {
        ;(useLocale as Mock).mockReturnValue(locale)

        const { result } = renderHook(() => useFormatTimeFromNow())
        const formatted = result.current.formatTimeFromNow(oneHourAgo)

        // Should return a non-empty string for each locale
        expect(typeof formatted).toBe('string')
        expect(formatted.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Performance', () => {
    /**
     * Test that the hook doesn't create new functions on every render
     * The formatTimeFromNow function should be memoized with useCallback
     */
    it('should memoize formatTimeFromNow function', () => {
      ;(useLocale as Mock).mockReturnValue('en-US')

      const { result, rerender } = renderHook(() => useFormatTimeFromNow())

      const firstFunction = result.current.formatTimeFromNow
      rerender()
      const secondFunction = result.current.formatTimeFromNow

      // Same locale should return the same function reference
      expect(firstFunction).toBe(secondFunction)
    })

    /**
     * Test that changing locale creates a new function
     * This ensures the memoization dependency on locale works correctly
     */
    it('should create new function when locale changes', () => {
      const { result, rerender } = renderHook(() => useFormatTimeFromNow())

      ;(useLocale as Mock).mockReturnValue('en-US')
      rerender()
      const englishFunction = result.current.formatTimeFromNow

      ;(useLocale as Mock).mockReturnValue('es-ES')
      rerender()
      const spanishFunction = result.current.formatTimeFromNow

      // Different locale should return different function reference
      expect(englishFunction).not.toBe(spanishFunction)
    })
  })
})
