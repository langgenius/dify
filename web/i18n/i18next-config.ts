'use client'
import i18n from 'i18next'
import { camelCase } from 'lodash-es'
import { initReactI18next } from 'react-i18next'

const requireSilent = async (lang: string, namespace: string) => {
  let res
  try {
    res = (await import(`./${lang}/${namespace}`)).default
  }
  catch {
    res = (await import(`./en-US/${namespace}`)).default
  }

  return res
}

const NAMESPACES = [
  'app-annotation',
  'app-api',
  'app-debug',
  'app-log',
  'app-overview',
  'app',
  'billing',
  'common',
  'custom',
  'dataset-creation',
  'dataset-documents',
  'dataset-hit-testing',
  'dataset-settings',
  'dataset',
  'education',
  'explore',
  'layout',
  'login',
  'plugin-tags',
  'plugin',
  'register',
  'run-log',
  'share',
  'time',
  'tools',
  'workflow',
]

export const loadLangResources = async (lang: string) => {
  const modules = await Promise.all(NAMESPACES.map(ns => requireSilent(lang, ns)))
  const resources = modules.reduce((acc, mod, index) => {
    acc[camelCase(NAMESPACES[index])] = mod
    return acc
  }, {} as Record<string, any>)
  return resources
}

const getFallbackTranslation = () => {
  const resources = NAMESPACES.reduce((acc, ns, index) => {
    acc[camelCase(NAMESPACES[index])] = require(`./en-US/${ns}`).default
    return acc
  }, {} as Record<string, any>)
  return {
    translation: resources,
  }
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next)
    .init({
      lng: undefined,
      fallbackLng: 'en-US',
      resources: {
        'en-US': getFallbackTranslation(),
      },
    })
}

export const changeLanguage = async (lng?: string) => {
  const resolvedLng = lng ?? 'en-US'
  const resource = await loadLangResources(resolvedLng)
  if (!i18n.hasResourceBundle(resolvedLng, 'translation'))
    i18n.addResourceBundle(resolvedLng, 'translation', resource, true, true)
  await i18n.changeLanguage(resolvedLng)
}

export default i18n
