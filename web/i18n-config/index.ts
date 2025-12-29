import type { Locale } from '@/i18n-config/language'

import Cookies from 'js-cookie'
import { LOCALE_COOKIE_NAME } from '@/config'
import { changeLanguage } from '@/i18n-config/i18next-config'
import { LanguagesSupported } from '@/i18n-config/language'
import { setUserLocaleServer } from './action'

export const i18n = {
  defaultLocale: 'en-US',
  locales: LanguagesSupported,
} as const

export { Locale }

export const setLocaleOnClient = async (locale: Locale, reloadPage = true) => {
  await changeLanguage(locale)
  if (reloadPage)
    await setUserLocaleServer(locale)
}

export const getLocaleOnClient = (): Locale => {
  return Cookies.get(LOCALE_COOKIE_NAME) as Locale || i18n.defaultLocale
}

export const renderI18nObject = (obj: Record<string, string>, language: string) => {
  if (!obj)
    return ''
  if (obj?.[language])
    return obj[language]
  if (obj?.en_US)
    return obj.en_US
  return Object.values(obj)[0]
}
