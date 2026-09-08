import {
  getPlanVectorSpaceLimitMB,
  getResetInDaysFromDate,
  parseLimit,
  parseVectorSpaceToMB,
} from '../index'

describe('billing utils', () => {
  // parseVectorSpaceToMB tests
  describe('parseVectorSpaceToMB', () => {
    it('should parse MB values correctly', () => {
      expect(parseVectorSpaceToMB('50MB')).toBe(50)
      expect(parseVectorSpaceToMB('100MB')).toBe(100)
    })

    it('should parse GB values and convert to MB', () => {
      expect(parseVectorSpaceToMB('5GB')).toBe(5 * 1024)
      expect(parseVectorSpaceToMB('20GB')).toBe(20 * 1024)
    })

    it('should be case insensitive', () => {
      expect(parseVectorSpaceToMB('50mb')).toBe(50)
      expect(parseVectorSpaceToMB('5gb')).toBe(5 * 1024)
    })

    it('should return 0 for invalid format', () => {
      expect(parseVectorSpaceToMB('50')).toBe(0)
      expect(parseVectorSpaceToMB('invalid')).toBe(0)
      expect(parseVectorSpaceToMB('')).toBe(0)
      expect(parseVectorSpaceToMB('50TB')).toBe(0)
    })
  })

  // getPlanVectorSpaceLimitMB tests
  describe('getPlanVectorSpaceLimitMB', () => {
    it('should return correct vector space for sandbox plan', () => {
      expect(getPlanVectorSpaceLimitMB('sandbox')).toBe(50)
    })

    it('should return correct vector space for professional plan', () => {
      expect(getPlanVectorSpaceLimitMB('professional')).toBe(5 * 1024)
    })

    it('should return correct vector space for team plan', () => {
      expect(getPlanVectorSpaceLimitMB('team')).toBe(20 * 1024)
    })
  })

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
