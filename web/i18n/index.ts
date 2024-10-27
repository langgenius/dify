import Cookies from 'js-cookie'

import { changeLanguage } from '@/i18n/i18next-config'
import { LOCALE_COOKIE_NAME } from '@/config'
import { LanguagesSupported } from '@/i18n/language'

export const i18n = {
  defaultLocale: 'en-US',
  locales: LanguagesSupported,
} as const

export type Locale = typeof i18n['locales'][number]

export const setLocaleOnClient = (locale: Locale, reloadPage = true) => {
  Cookies.set(LOCALE_COOKIE_NAME, locale)
  changeLanguage(locale)
  reloadPage && location.reload()
}

export const getLocaleOnClient = (): Locale => {
  return Cookies.get(LOCALE_COOKIE_NAME) as Locale || i18n.defaultLocale
}
