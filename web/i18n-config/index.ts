import type { Locale } from '@/i18n-config/language'
import Cookies from 'js-cookie'
import { LOCALE_COOKIE_NAME } from '@/config'
import { changeLanguage } from '@/i18n-config/client'
import { defaultLocale, normalizeLocale, supportedLocales } from './locale'

export const i18n = {
  defaultLocale,
  locales: supportedLocales,
} as const

export type { Locale }

export const setLocaleOnClient = async (locale: string, reloadPage = true) => {
  const normalized = normalizeLocale(locale)
  Cookies.set(LOCALE_COOKIE_NAME, normalized, { expires: 365 })
  await changeLanguage(normalized)
  if (reloadPage) location.reload()
}

export const renderI18nObject = (
  obj: Record<string, string | null | undefined> | null | undefined,
  language: string,
) => {
  if (!obj) return ''
  if (obj?.[language]) return obj[language]
  if (obj?.en_US) return obj.en_US
  return Object.values(obj).find((value): value is string => !!value) || ''
}
