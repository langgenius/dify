import type { Locale } from '@/i18n-config'
import { match } from '@formatjs/intl-localematcher'
import { LanguagesSupported } from '@/i18n-config/language'

export function getBrowserLocale(preferences: readonly string[]): Locale {
  const valid = preferences.filter((language) => {
    try {
      return Intl.getCanonicalLocales(language).length > 0
    } catch {
      return false
    }
  })
  return match(valid, LanguagesSupported, 'en-US') as Locale
}
