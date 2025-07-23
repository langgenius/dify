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
  return {
    translation: resources,
  }
}

i18n.use(initReactI18next)
  .init({
    lng: undefined,
    fallbackLng: 'en-US',
  })

export const changeLanguage = async (lng?: string) => {
  const resolvedLng = lng ?? 'en-US'
  const resources = {
    [resolvedLng]: await loadLangResources(resolvedLng),
  }
  if (!i18n.hasResourceBundle(resolvedLng, 'translation'))
    i18n.addResourceBundle(resolvedLng, 'translation', resources[resolvedLng].translation, true, true)
  await i18n.changeLanguage(resolvedLng)
}

export default i18n
