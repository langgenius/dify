import Cookies from 'js-cookie'
import type { Locale } from '.'
import { i18n } from '.'
import { LOCALE_COOKIE_NAME } from '@/config'
import { changeLanguage } from '@/i18n/i18next-config'

// same logic as server
export const getLocaleOnClient = (): Locale => {
  return Cookies.get(LOCALE_COOKIE_NAME) as Locale || i18n.defaultLocale
}

export const setLocaleOnClient = (locale: Locale) => {
  Cookies.set(LOCALE_COOKIE_NAME, locale)
  changeLanguage(locale)
  location.reload()
}
