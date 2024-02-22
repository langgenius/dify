import Cookies from 'js-cookie'
import { cookies, headers } from 'next/headers'
import Negotiator from 'negotiator'
import { match } from '@formatjs/intl-localematcher'
import { changeLanguage } from '@/i18n/i18next-config'
import { LOCALE_COOKIE_NAME } from '@/config'
import { LanguagesSupported } from '@/utils/language'

export const i18n = {
  defaultLocale: 'en-US',
  locales: LanguagesSupported,
} as const

export type Locale = typeof i18n['locales'][number]

export const getLocaleOnClient = (): Locale => {
  return Cookies.get(LOCALE_COOKIE_NAME) as Locale || i18n.defaultLocale
}

export const setLocaleOnClient = (locale: Locale, reloadPage = true) => {
  Cookies.set(LOCALE_COOKIE_NAME, locale)
  changeLanguage(locale)
  reloadPage && location.reload()
}

export const getLocaleOnServer = (): Locale => {
  // @ts-expect-error locales are readonly
  const locales: string[] = i18n.locales

  let languages: string[] | undefined
  // get locale from cookie
  const localeCookie = cookies().get('locale')
  languages = localeCookie?.value ? [localeCookie.value] : []

  if (!languages.length) {
    // Negotiator expects plain object so we need to transform headers
    const negotiatorHeaders: Record<string, string> = {}
    headers().forEach((value, key) => (negotiatorHeaders[key] = value))
    // Use negotiator and intl-localematcher to get best locale
    languages = new Negotiator({ headers: negotiatorHeaders }).languages()
  }

  // match locale
  const matchedLocale = match(languages, locales, i18n.defaultLocale) as Locale
  return matchedLocale
}
