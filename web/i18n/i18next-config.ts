'use client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { LanguagesSupported } from '@/i18n/language'

const requireSilent = (lang: string) => {
  let res
  try {
    res = require(`./${lang}/education`).default
  }
  catch {
    res = require('./en-US/education').default
  }

  return res
}

const loadLangResources = (lang: string) => ({
  translation: {
    common: require(`./${lang}/common`).default,
    layout: require(`./${lang}/layout`).default,
    login: require(`./${lang}/login`).default,
    register: require(`./${lang}/register`).default,
    app: require(`./${lang}/app`).default,
    appOverview: require(`./${lang}/app-overview`).default,
    appDebug: require(`./${lang}/app-debug`).default,
    appApi: require(`./${lang}/app-api`).default,
    appLog: require(`./${lang}/app-log`).default,
    appAnnotation: require(`./${lang}/app-annotation`).default,
    share: require(`./${lang}/share-app`).default,
    dataset: require(`./${lang}/dataset`).default,
    datasetDocuments: require(`./${lang}/dataset-documents`).default,
    datasetHitTesting: require(`./${lang}/dataset-hit-testing`).default,
    datasetSettings: require(`./${lang}/dataset-settings`).default,
    datasetCreation: require(`./${lang}/dataset-creation`).default,
    explore: require(`./${lang}/explore`).default,
    billing: require(`./${lang}/billing`).default,
    custom: require(`./${lang}/custom`).default,
    tools: require(`./${lang}/tools`).default,
    workflow: require(`./${lang}/workflow`).default,
    runLog: require(`./${lang}/run-log`).default,
    plugin: require(`./${lang}/plugin`).default,
    pluginTags: require(`./${lang}/plugin-tags`).default,
    time: require(`./${lang}/time`).default,
    education: requireSilent(lang),
  },
})

type Resource = Record<string, ReturnType<typeof loadLangResources>>
// Automatically generate the resources object
export const resources = LanguagesSupported.reduce<Resource>((acc, lang) => {
  acc[lang] = loadLangResources(lang)
  return acc
}, {})

i18n.use(initReactI18next)
  .init({
    lng: undefined,
    fallbackLng: 'en-US',
    resources,
  })

export const changeLanguage = i18n.changeLanguage
export default i18n
