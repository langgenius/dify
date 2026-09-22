'use client'
import type { Resource } from 'i18next'
import type { Locale } from './locale'
import type { Namespace, NamespaceInFileName } from './resources'
import { createInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import Cookies from 'js-cookie'
import { getI18n, initReactI18next } from 'react-i18next'
import { LOCALE_COOKIE_NAME } from '@/config'
import { loadI18nResource } from './load-resource'
import { normalizeLocale } from './locale'
import { namespaces } from './resources'
import { getInitOptions } from './settings'

export function createI18nextInstance(lng: Locale, resources: Resource) {
  const instance = createInstance()
  instance
    .use(initReactI18next)
    .use(
      resourcesToBackend((language: Locale, namespace: NamespaceInFileName | Namespace) =>
        loadI18nResource(language, namespace),
      ),
    )
    .init({
      ...getInitOptions(
        namespaces.filter((namespace) => Object.hasOwn(resources[lng] ?? {}, namespace)),
      ),
      lng,
      resources,
    })
  return instance
}

export const changeLanguage = async (lng?: string) => {
  if (!lng) return
  const i18n = getI18n()
  await i18n.changeLanguage(normalizeLocale(lng))
}

export const setLocaleOnClient = async (locale: string, reloadPage = true) => {
  const normalized = normalizeLocale(locale)
  Cookies.set(LOCALE_COOKIE_NAME, normalized, { expires: 365 })
  await changeLanguage(normalized)
  if (reloadPage) location.reload()
}
