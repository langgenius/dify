'use client'
import i18n from 'i18next'
import { camelCase } from 'lodash-es'
import { initReactI18next } from 'react-i18next'

const requireSilent = async (lang: string, namespace: string) => {
  let res
  try {
    res = (await import(`../i18n/${lang}/${namespace}`)).default
  }
  catch {
    res = (await import(`../i18n/en-US/${namespace}`)).default
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

/**
 * !Need to load en-US and zh-Hans resources for initial rendering, which are used in both marketplace and dify
 * !Other languages will be loaded on demand
 * !This is to avoid loading all languages at once which can be slow
 */
const getInitialTranslations = () => {
  const en_USResources = NAMESPACES.reduce((acc, ns, index) => {
    acc[camelCase(NAMESPACES[index])] = require(`../i18n/en-US/${ns}`).default
    return acc
  }, {} as Record<string, any>)
  const zh_HansResources = NAMESPACES.reduce((acc, ns, index) => {
    acc[camelCase(NAMESPACES[index])] = require(`../i18n/zh-Hans/${ns}`).default
    return acc
  }, {} as Record<string, any>)
  return {
    'en-US': {
      translation: en_USResources,
    },
    'zh-Hans': {
      translation: zh_HansResources,
    },
  }
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next)
    .init({
      lng: undefined,
      fallbackLng: 'en-US',
      resources: getInitialTranslations(),
    })
}

export const changeLanguage = async (lng?: string) => {
  if (!lng) return
  const resource = await loadLangResources(lng)
  if (!i18n.hasResourceBundle(lng, 'translation'))
    i18n.addResourceBundle(lng, 'translation', resource, true, true)
  await i18n.changeLanguage(lng)
}

export default i18n
