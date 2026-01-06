'use client'
import type { Resource } from 'i18next'
import type { Locale } from '.'
import type { NamespaceCamelCase, NamespaceKebabCase } from './resources'
import { kebabCase } from 'es-toolkit/string'
import { createInstance } from 'i18next'
import { getI18n, initReactI18next } from 'react-i18next'

function getBackend() {
  return {
    type: 'backend' as const,
    init() {},
    read(language: string, namespace: NamespaceKebabCase | NamespaceCamelCase, callback: (err: unknown, data?: unknown) => void) {
      const ns = kebabCase(namespace) as NamespaceKebabCase
      import(`../i18n/${language}/${ns}.json`)
        .then(data => callback(null, data.default ?? data))
        .catch(callback)
    },
  }
}

export function createI18nextInstance(lng: Locale, resources: Resource) {
  const instance = createInstance()
  instance.use(initReactI18next).use(getBackend()).init({
    lng,
    fallbackLng: 'en-US',
    resources,
    partialBundledLanguages: true,
    defaultNS: 'common',
    ns: Object.keys(resources),
    keySeparator: false,
  })
  return instance
}

export const changeLanguage = async (lng?: Locale) => {
  if (!lng)
    return
  const i18n = getI18n()
  await i18n.changeLanguage(lng)
}
