import type { i18n as I18nInstance, Resource, ResourceLanguage } from 'i18next'
import type { Locale } from '.'
import type { NamespaceCamelCase, NamespaceKebabCase } from './resources'
import { match } from '@formatjs/intl-localematcher'
import { kebabCase } from 'es-toolkit/compat'
import { camelCase } from 'es-toolkit/string'
import { createInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import Negotiator from 'negotiator'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { initReactI18next } from 'react-i18next/initReactI18next'
import { serverOnlyContext } from '@/utils/server-only-context'
import { i18n } from '.'
import { namespacesKebabCase } from './resources'
import { getInitOptions } from './settings'

const [getLocaleCache, setLocaleCache] = serverOnlyContext<Locale | null>(null)
const [getI18nInstance, setI18nInstance] = serverOnlyContext<I18nInstance | null>(null)

const getOrCreateI18next = async (lng: Locale) => {
  let instance = getI18nInstance()
  if (instance)
    return instance

  instance = createInstance()
  await instance
    .use(initReactI18next)
    .use(resourcesToBackend((language: Locale, namespace: NamespaceCamelCase | NamespaceKebabCase) => {
      const fileNamespace = kebabCase(namespace) as NamespaceKebabCase
      return import(`../i18n/${language}/${fileNamespace}.json`)
    }))
    .init({
      ...getInitOptions(),
      lng,
    })
  setI18nInstance(instance)
  return instance
}

export async function getTranslation(lng: Locale, ns?: NamespaceCamelCase) {
  const i18nextInstance = await getOrCreateI18next(lng)

  if (ns && !i18nextInstance.hasLoadedNamespace(ns))
    await i18nextInstance.loadNamespaces(ns)

  return {
    t: i18nextInstance.getFixedT(lng, ns),
    i18n: i18nextInstance,
  }
}

export const getLocaleOnServer = async (): Promise<Locale> => {
  const cached = getLocaleCache()
  if (cached)
    return cached

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
  setLocaleCache(matchedLocale)
  return matchedLocale
}

export const getResources = cache(async (lng: Locale): Promise<Resource> => {
  const messages = {} as ResourceLanguage

  await Promise.all(
    (namespacesKebabCase).map(async (ns) => {
      const mod = await import(`../i18n/${lng}/${ns}.json`)
      messages[camelCase(ns)] = mod.default
    }),
  )

  return { [lng]: messages }
})
