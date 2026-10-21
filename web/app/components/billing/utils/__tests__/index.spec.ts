import {
  canAccessSnippetsAndEvaluation,
  getResetInDaysFromDate,
  parseLimit,
  parseVectorSpaceToMB,
} from '../index'

describe('billing utils', () => {
  it.each([
    ['50MB', 50],
    ['5GB', 5120],
    ['50mb', 50],
    ['5gb', 5120],
    ['50', 0],
    ['50TB', 0],
  ])('converts vector storage %s to %i MB', (value, expected) => {
    expect(parseVectorSpaceToMB(value)).toBe(expected)
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

  describe('snippet and evaluation plan access', () => {
    it('allows every self-hosted edition', () => {
      expect(
        canAccessSnippetsAndEvaluation({
          deploymentEdition: 'COMMUNITY',
        }),
      ).toBe(true)
    })

    it.each(['professional', 'team'] as const)('allows the %s cloud plan', (planType) => {
      expect(
        canAccessSnippetsAndEvaluation({
          deploymentEdition: 'CLOUD',
          planType,
        }),
      ).toBe(true)
    })

    it('blocks the sandbox cloud plan', () => {
      expect(
        canAccessSnippetsAndEvaluation({
          deploymentEdition: 'CLOUD',
          planType: 'sandbox',
        }),
      ).toBe(false)
    })

    it('blocks cloud access while subscription data is absent', () => {
      expect(
        canAccessSnippetsAndEvaluation({
          deploymentEdition: 'CLOUD',
        }),
      ).toBe(false)
    })
  })
})
