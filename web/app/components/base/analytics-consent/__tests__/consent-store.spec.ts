import {
  getAnalyticsConsent,
  getAnalyticsConsentFromCookie,
  getAnalyticsConsentFromEvent,
  setAnalyticsConsent,
} from '../consent-store'

describe('analytics consent store', () => {
  beforeEach(() => {
    setAnalyticsConsent('unknown')
  })

  describe('CookieYes cookie parsing', () => {
    it.each([
      ['', 'unknown'],
      ['session=value', 'unknown'],
      ['cookieyes-consent=consentid:abc,necessary:yes', 'unknown'],
      ['cookieyes-consent=consentid:abc,analytics:yes', 'granted'],
      ['cookieyes-consent=consentid:abc,analytics:no', 'denied'],
      ['cookieyes-consent=consentid%3Aabc%2Canalytics%3Ayes', 'granted'],
    ] as const)('maps %s to %s', (cookie, expected) => {
      expect(getAnalyticsConsentFromCookie(cookie)).toBe(expected)
    })
  })

  describe('CookieYes update events', () => {
    it('grants consent when analytics is accepted', () => {
      expect(
        getAnalyticsConsentFromEvent({ accepted: ['necessary', 'analytics'], rejected: [] }),
      ).toBe('granted')
    })

    it('denies consent when analytics is rejected', () => {
      expect(
        getAnalyticsConsentFromEvent({ accepted: ['necessary'], rejected: ['analytics'] }),
      ).toBe('denied')
    })

    it('does not change consent for unrelated categories or malformed details', () => {
      expect(
        getAnalyticsConsentFromEvent({ accepted: ['functional'], rejected: ['advertisement'] }),
      ).toBeNull()
      expect(getAnalyticsConsentFromEvent(null)).toBeNull()
    })
  })

  it('exposes the current consent synchronously', () => {
    setAnalyticsConsent('granted')

    expect(getAnalyticsConsent()).toBe('granted')
  })
})
