import { renderHook } from '@testing-library/react'
import { useDaysOfWeek, useMonths, useTimeOptions, useYearOptions } from './hooks'
import { Period } from './types'
import dayjs from './utils/dayjs'

describe('date-and-time-picker hooks', () => {
  // Tests for useDaysOfWeek hook
  describe('useDaysOfWeek', () => {
    it('should return 7 days of the week', () => {
      const { result } = renderHook(() => useDaysOfWeek())

      expect(result.current).toHaveLength(7)
    })

    it('should return translated day keys with namespace prefix', () => {
      const { result } = renderHook(() => useDaysOfWeek())

      // Global i18n mock returns "time.daysInWeek.<day>" format
      expect(result.current[0]).toContain('daysInWeek.Sun')
      expect(result.current[6]).toContain('daysInWeek.Sat')
    })
  })

  // Tests for useMonths hook
  describe('useMonths', () => {
    it('should return 12 months', () => {
      const { result } = renderHook(() => useMonths())

      expect(result.current).toHaveLength(12)
    })

    it('should return translated month keys with namespace prefix', () => {
      const { result } = renderHook(() => useMonths())

      expect(result.current[0]).toContain('months.January')
      expect(result.current[11]).toContain('months.December')
    })
  })

  // Tests for useYearOptions hook
  describe('useYearOptions', () => {
    it('should return 200 year options', () => {
      const { result } = renderHook(() => useYearOptions())

      expect(result.current).toHaveLength(200)
    })

    it('should center around the current year', () => {
      const { result } = renderHook(() => useYearOptions())
      const currentYear = dayjs().year()

      expect(result.current).toContain(currentYear)
      // First year should be currentYear - 50 (YEAR_RANGE/2 = 50)
      expect(result.current[0]).toBe(currentYear - 50)
      // Last year should be currentYear + 149
      expect(result.current[199]).toBe(currentYear + 149)
    })
  })

  // Tests for useTimeOptions hook
  describe('useTimeOptions', () => {
    it('should return 12 hour options', () => {
      const { result } = renderHook(() => useTimeOptions())

      expect(result.current.hourOptions).toHaveLength(12)
    })

    it('should return hours from 01 to 12 zero-padded', () => {
      const { result } = renderHook(() => useTimeOptions())

      expect(result.current.hourOptions[0]).toBe('01')
      expect(result.current.hourOptions[11]).toBe('12')
    })

    it('should return 60 minute options', () => {
      const { result } = renderHook(() => useTimeOptions())

      expect(result.current.minuteOptions).toHaveLength(60)
    })

    it('should return minutes from 00 to 59 zero-padded', () => {
      const { result } = renderHook(() => useTimeOptions())

      expect(result.current.minuteOptions[0]).toBe('00')
      expect(result.current.minuteOptions[59]).toBe('59')
    })

    it('should return AM and PM period options', () => {
      const { result } = renderHook(() => useTimeOptions())

      expect(result.current.periodOptions).toEqual([Period.AM, Period.PM])
    })
  })
})
