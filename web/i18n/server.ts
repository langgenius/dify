import type { Resource, ResourceLanguage } from 'i18next'
import type { Locale } from '.'
import type { Namespace, NamespaceInFileName } from './resources'
import { match } from '@formatjs/intl-localematcher'
import { camelCase } from 'es-toolkit/string'
import { createInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import Negotiator from 'negotiator'
import { cache } from 'react'
import { initReactI18next } from 'react-i18next/initReactI18next'
import { LOCALE_COOKIE_NAME } from '@/config'
import { cookies, headers } from '@/next/headers'
import { loadI18nResource } from './load-resource'
import { canonicalizeLanguageTag, defaultLocale, supportedLocales } from './locale'
import { namespacesInFileName } from './resources'
import { getInitOptions } from './settings'

const getOrCreateI18next = cache(async (lng: Locale) => {
  const instance = createInstance()
  await instance
    .use(initReactI18next)
    .use(
      resourcesToBackend((language: Locale, namespace: Namespace | NamespaceInFileName) =>
        loadI18nResource(language, namespace),
      ),
    )
    .init({
      ...getInitOptions(),
      lng,
    })
  return instance
})

export async function getTranslation<T extends Namespace>(lng: Locale, ns?: T) {
  const i18nextInstance = await getOrCreateI18next(lng)

  if (ns && !i18nextInstance.hasLoadedNamespace(ns)) await i18nextInstance.loadNamespaces(ns)

  return {
    t: i18nextInstance.getFixedT(lng, ns),
    i18n: i18nextInstance,
  }
}

export const getLocaleOnServer = cache(async (): Promise<Locale> => {
  const localeCookie = (await cookies()).get(LOCALE_COOKIE_NAME)
  const requestedLanguages = localeCookie?.value
    ? [localeCookie.value]
    : new Negotiator({
        headers: { 'accept-language': (await headers()).get('accept-language') ?? '' },
      }).languages()
  const languages = requestedLanguages.flatMap((language) => {
    const canonical = canonicalizeLanguageTag(language)
    return canonical ? [canonical] : []
  })

  return match(languages, supportedLocales, defaultLocale) as Locale
})

export const getResources = cache(async (lng: Locale): Promise<Resource> => {
  const messages = {} as ResourceLanguage

  await Promise.all(
    namespacesInFileName.map(async (ns) => {
      const mod = await loadI18nResource(lng, ns)
      messages[camelCase(ns)] = mod.default
    }),
  )

  return { [lng]: messages }
})
