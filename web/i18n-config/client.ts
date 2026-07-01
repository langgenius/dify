'use client'
import type { Resource } from 'i18next'
import type { Locale } from '.'
import type { Namespace, NamespaceInFileName } from './resources'
import { createInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import { getI18n, initReactI18next } from 'react-i18next'
import { loadI18nResource } from './load-resource'
import { getInitOptions } from './settings'

export function createI18nextInstance(lng: Locale, resources: Resource) {
  const instance = createInstance()
  instance
    .use(initReactI18next)
    .use(resourcesToBackend((
      language: Locale,
      namespace: NamespaceInFileName | Namespace,
    ) => loadI18nResource(language, namespace)))
    .init({
      ...getInitOptions(),
      lng,
      resources,
    })
  return instance
}

export const changeLanguage = async (lng?: Locale) => {
  if (!lng)
    return
  const i18n = getI18n()
  await i18n.changeLanguage(lng)
}
