'use client'
import type { Resource } from 'i18next'
import type { Locale } from '.'
import type { NamespaceCamelCase, NamespaceKebabCase } from './resources'
import { camelCase } from 'es-toolkit/string'
import { createInstance } from 'i18next'
import { getI18n, initReactI18next } from 'react-i18next'
import { NAMESPACES } from './resources'

const requireSilent = async (lang: Locale, namespace: NamespaceKebabCase) => {
  let res
  try {
    res = (await import(`../i18n/${lang}/${namespace}.json`)).default
  }
  catch {
    res = (await import(`../i18n/en-US/${namespace}.json`)).default
  }

  return res
}

// Load a single namespace for a language
export const loadNamespace = async (lang: Locale, ns: NamespaceKebabCase) => {
  const i18n = getI18n()
  const camelNs = camelCase(ns) as NamespaceCamelCase
  if (i18n.hasResourceBundle(lang, camelNs))
    return

  const resource = await requireSilent(lang, ns)
  i18n.addResourceBundle(lang, camelNs, resource, true, true)
}

// Load all namespaces for a language (used when switching language)
export const loadLangResources = async (lang: Locale) => {
  await Promise.all(
    NAMESPACES.map(ns => loadNamespace(lang, ns)),
  )
}

export function createI18nextInstance(lng: Locale, resources: Resource) {
  const instance = createInstance()
  instance.use(initReactI18next).init({
    lng,
    fallbackLng: 'en-US',
    resources,
    defaultNS: 'common',
    ns: Object.keys(resources),
    keySeparator: false,
  })
  return instance
}

export const changeLanguage = async (lng?: Locale) => {
  if (!lng)
    return
  await loadLangResources(lng)
  const i18n = getI18n()
  await i18n.changeLanguage(lng)
}
