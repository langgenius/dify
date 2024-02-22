'use client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const resources = {
  'en-US': {
    translation: {
      common: require('./lang/en-US/common'),
      layout: require('./lang/en-US/layout'),
      login: require('./lang/en-US/login'),
      register: require('./lang/en-US/register'),
      app: require('./lang/en-US/app'),
      appOverview: require('./lang/en-US/app-overview'),
      appDebug: require('./lang/en-US/app-debug'),
      appApi: require('./lang/en-US/app-api'),
      appLog: require('./lang/en-US/app-log'),
      appAnnotation: require('./lang/en-US/app-annotation'),
      share: require('./lang/en-US/share-app'),
      dataset: require('./lang/en-US/dataset'),
      datasetDocuments: require('./lang/en-US/dataset-documents'),
      datasetHitTesting: require('./lang/en-US/dataset-hit-testing'),
      datasetSettings: require('./lang/en-US/dataset-settings'),
      datasetCreation: require('./lang/en-US/dataset-creation'),
      explore: require('./lang/en-US/explore'),
      billing: require('./lang/en-US/billing'),
      custom: require('./lang/en-US/custom'),
      tools: require('./lang/en-US/tools'),
    },
  },
  'zh-Hans': {
    translation: {
      common: require('./lang/zh-Hans/common'),
      layout: require('./lang/zh-Hans/layout'),
      login: require('./lang/zh-Hans/login'),
      register: require('./lang/zh-Hans/register'),
      app: require('./lang/zh-Hans/app'),
      appOverview: require('./lang/zh-Hans/app-overview'),
      appDebug: require('./lang/zh-Hans/app-debug'),
      appApi: require('./lang/zh-Hans/app-api'),
      appLog: require('./lang/zh-Hans/app-log'),
      appAnnotation: require('./lang/zh-Hans/app-annotation'),
      share: require('./lang/zh-Hans/share-app'),
      dataset: require('./lang/zh-Hans/dataset'),
      datasetDocuments: require('./lang/zh-Hans/dataset-documents'),
      datasetHitTesting: require('./lang/zh-Hans/dataset-hit-testing'),
      datasetSettings: require('./lang/zh-Hans/dataset-settings'),
      datasetCreation: require('./lang/zh-Hans/dataset-creation'),
      explore: require('./lang/zh-Hans/explore'),
      billing: require('./lang/zh-Hans/billing'),
      custom: require('./lang/zh-Hans/custom'),
      tools: require('./lang/zh-Hans/tools'),
    },
  },
  'pt-BR': {
    translation: {
      common: require('./lang/pt-BR/common'),
      layout: require('./lang/pt-BR/layout'),
      login: require('./lang/pt-BR/login'),
      register: require('./lang/pt-BR/register'),
      app: require('./lang/pt-BR/app'),
      appOverview: require('./lang/pt-BR/app-overview'),
      appDebug: require('./lang/pt-BR/app-debug'),
      appApi: require('./lang/pt-BR/app-api'),
      appLog: require('./lang/pt-BR/app-log'),
      appAnnotation: require('./lang/pt-BR/app-annotation'),
      share: require('./lang/pt-BR/share-app'),
      dataset: require('./lang/pt-BR/dataset'),
      datasetDocuments: require('./lang/pt-BR/dataset-documents'),
      datasetHitTesting: require('./lang/pt-BR/dataset-hit-testing'),
      datasetSettings: require('./lang/pt-BR/dataset-settings'),
      datasetCreation: require('./lang/pt-BR/dataset-creation'),
      explore: require('./lang/pt-BR/explore'),
      billing: require('./lang/pt-BR/billing'),
      custom: require('./lang/pt-BR/custom'),
      tools: require('./lang/pt-BR/tools'),
    },
  },
  'uk-UA': {
    translation: {
      common: require('./lang/uk-UA/common'),
      layout: require('./lang/uk-UA/layout'),
      login: require('./lang/uk-UA/login'),
      register: require('./lang/uk-UA/register'),
      app: require('./lang/uk-UA/app'),
      appOverview: require('./lang/uk-UA/app-overview'),
      appDebug: require('./lang/uk-UA/app-debug'),
      appApi: require('./lang/uk-UA/app-api'),
      appLog: require('./lang/uk-UA/app-log'),
      appAnnotation: require('./lang/uk-UA/app-annotation'),
      share: require('./lang/uk-UA/share-app'),
      dataset: require('./lang/uk-UA/dataset'),
      datasetDocuments: require('./lang/uk-UA/dataset-documents'),
      datasetHitTesting: require('./lang/uk-UA/dataset-hit-testing'),
      datasetSettings: require('./lang/uk-UA/dataset-settings'),
      datasetCreation: require('./lang/uk-UA/dataset-creation'),
      explore: require('./lang/uk-UA/explore'),
      billing: require('./lang/uk-UA/billing'),
      custom: require('./lang/uk-UA/custom'),
      tools: require('./lang/uk-UA/tools'),
    },
  },
}

i18n.use(initReactI18next)
  // init i18next
  // for all options read: https://www.i18next.com/overview/configuration-options
  .init({
    lng: undefined,
    fallbackLng: 'en-US',
    // debug: true,
    resources,
  })

export const changeLanguage = i18n.changeLanguage
export default i18n
