import i18next from 'i18next'
import { loadI18nResource } from '@/i18n/load-resource'
import { supportedLocales } from '@/i18n/locale'
import enShare from '@/i18n/locales/en-US/share.json'
import zhHansShare from '@/i18n/locales/zh-Hans/share.json'

const V2_KEYS = [
  'humanInputV2.accessRateLimited',
  'humanInputV2.alreadySubmitted',
  'humanInputV2.challengeExpired',
  'humanInputV2.challengeStale',
  'humanInputV2.codeExpiresIn',
  'humanInputV2.codeRequired',
  'humanInputV2.codeSent',
  'humanInputV2.deliveryFailed',
  'humanInputV2.formExpired',
  'humanInputV2.formNotFound',
  'humanInputV2.formRateLimited',
  'humanInputV2.invalidOtp',
  'humanInputV2.networkError',
  'humanInputV2.otpLabel',
  'humanInputV2.otpPlaceholder',
  'humanInputV2.requestingCode',
  'humanInputV2.resendCode',
  'humanInputV2.retry',
  'humanInputV2.sendCode',
  'humanInputV2.unavailable',
  'humanInputV2.unknownError',
  'humanInputV2.uploadFailed',
] as const

describe('Human Input v2 form locales', () => {
  it.each(supportedLocales)('resolves every v2 key in %s without fallback', async (locale) => {
    const { default: share } = await loadI18nResource(locale, 'share')
    const i18n = i18next.createInstance()
    await i18n.init({
      lng: locale,
      fallbackLng: false,
      keySeparator: false,
      resources: { [locale]: { share } },
      defaultNS: 'share',
    })

    V2_KEYS.forEach((key) => {
      expect(i18n.getResource(locale, 'share', key), key).toEqual(expect.stringMatching(/\S/))
    })

    expect(i18n.t(($) => $['humanInputV2.codeExpiresIn'], { ns: 'share', seconds: 42 })).toContain(
      '42',
    )
  })

  it('uses dedicated Simplified Chinese copy without English fallback', () => {
    V2_KEYS.forEach((key) => {
      expect(zhHansShare[key]).toBeTruthy()
      expect(zhHansShare[key]).not.toBe(enShare[key])
    })
  })
})
