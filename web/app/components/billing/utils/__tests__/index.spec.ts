import { getResetInDaysFromDate, parseLimit } from '../index'

describe('billing utils', () => {
  describe('quota reset dates', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 8, 7, 12))
    })
    afterEach(() => vi.useRealTimers())
    it('handles Unix timestamps in seconds and milliseconds', () => {
      const resetDate = new Date(2026, 8, 14).getTime()
      expect(getResetInDaysFromDate(resetDate)).toBe(7)
      expect(getResetInDaysFromDate(resetDate / 1000)).toBe(7)
    })
    it('handles calendar dates and omits absent or past resets', () => {
      expect(getResetInDaysFromDate(20260914)).toBe(7)
      expect(getResetInDaysFromDate(0)).toBeNull()
      expect(getResetInDaysFromDate(-1)).toBeNull()
      expect(getResetInDaysFromDate(20260901)).toBeNull()
    })
  })

  describe('quota display', () => {
    it('displays zero count limits as unlimited', () => {
      expect(parseLimit(0)).toBe(-1)
      expect(parseLimit(10)).toBe(10)
    })
  })
})
