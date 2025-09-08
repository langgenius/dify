import { cookies, headers } from 'next/headers'
import Negotiator from 'negotiator'
import { match } from '@formatjs/intl-localematcher'

import { createInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import { initReactI18next } from 'react-i18next/initReactI18next'
import { i18n } from '.'
import type { Locale } from '.'

// https://locize.com/blog/next-13-app-dir-i18n/
const initI18next = async (lng: Locale, ns: string) => {
  const i18nInstance = createInstance()
  await i18nInstance
    .use(initReactI18next)
    .use(resourcesToBackend((language: string, namespace: string) => import(`../i18n/${language}/${namespace}.ts`)))
    .init({
      lng: lng === 'zh-Hans' ? 'zh-Hans' : lng,
      ns,
      fallbackLng: 'en-US',
    })
  return i18nInstance
}

export async function useTranslation(lng: Locale, ns = '', options: Record<string, any> = {}) {
  const i18nextInstance = await initI18next(lng, ns)
  return {
    t: i18nextInstance.getFixedT(lng, ns, options.keyPrefix),
    i18n: i18nextInstance,
  }
}

export const getLocaleOnServer = async (): Promise<Locale> => {
  const locales: string[] = i18n.locales

  let languages: string[] | undefined
  // get locale from cookie
  const localeCookie = (await cookies()).get('locale')
  languages = localeCookie?.value ? [localeCookie.value] : []

  if (!languages.length) {
    // Negotiator expects plain object so we need to transform headers
    const negotiatorHeaders: Record<string, string> = {};
    (await headers()).forEach((value, key) => (negotiatorHeaders[key] = value))
    // Use negotiator and intl-localematcher to get best locale
    languages = new Negotiator({ headers: negotiatorHeaders }).languages()
  }

  // Validate languages
  if (!Array.isArray(languages) || languages.length === 0 || !languages.every(lang => typeof lang === 'string' && /^[\w-]+$/.test(lang)))
    languages = [i18n.defaultLocale]

  // match locale
  const matchedLocale = match(languages, locales, i18n.defaultLocale) as Locale
  return matchedLocale
}
