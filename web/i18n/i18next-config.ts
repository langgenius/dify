'use client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const requireSilent = async (lang: string) => {
  let res
  try {
    res = (await import(`./${lang}/education`)).default
  }
  catch {
    res = (await import('./en-US/education')).default
  }

  return res
}

export const loadLangResources = async (lang: string) => ({
  translation: {
    common: (await import(`./${lang}/common`)).default,
    layout: (await import(`./${lang}/layout`)).default,
    login: (await import(`./${lang}/login`)).default,
    register: (await import(`./${lang}/register`)).default,
    app: (await import(`./${lang}/app`)).default,
    appOverview: (await import(`./${lang}/app-overview`)).default,
    appDebug: (await import(`./${lang}/app-debug`)).default,
    appApi: (await import(`./${lang}/app-api`)).default,
    appLog: (await import(`./${lang}/app-log`)).default,
    appAnnotation: (await import(`./${lang}/app-annotation`)).default,
    share: (await import(`./${lang}/share-app`)).default,
    dataset: (await import(`./${lang}/dataset`)).default,
    datasetDocuments: (await import(`./${lang}/dataset-documents`)).default,
    datasetHitTesting: (await import(`./${lang}/dataset-hit-testing`)).default,
    datasetSettings: (await import(`./${lang}/dataset-settings`)).default,
    datasetCreation: (await import(`./${lang}/dataset-creation`)).default,
    explore: (await import(`./${lang}/explore`)).default,
    billing: (await import(`./${lang}/billing`)).default,
    custom: (await import(`./${lang}/custom`)).default,
    tools: (await import(`./${lang}/tools`)).default,
    workflow: (await import(`./${lang}/workflow`)).default,
    runLog: (await import(`./${lang}/run-log`)).default,
    plugin: (await import(`./${lang}/plugin`)).default,
    pluginTags: (await import(`./${lang}/plugin-tags`)).default,
    time: (await import(`./${lang}/time`)).default,
    education: (await requireSilent(lang)).default,
  },
})

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
