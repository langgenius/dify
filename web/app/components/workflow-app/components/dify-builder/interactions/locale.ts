import type { Locale } from '@/i18n/locale'
import { canonicalizeLanguageTag, supportedLocales } from '@/i18n/locale'

export const resolveInteractionLocale = (replyLanguage: string, accountLocale: Locale): Locale => {
  const canonical = canonicalizeLanguageTag(replyLanguage)
  if (!canonical) return accountLocale

  const exact = supportedLocales.find((locale) => locale === canonical)
  if (exact) return exact

  const language = new Intl.Locale(canonical)
  const script = language.maximize().script
  return (
    supportedLocales.find((locale) => {
      const supported = new Intl.Locale(locale)
      return supported.language === language.language && supported.maximize().script === script
    }) ?? accountLocale
  )
}
