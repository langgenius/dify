'use client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const resources = {
  'en-US': {
    translation: {
      common: require('./lang/en-US/common').default,
      layout: require('./lang/en-US/layout').default,
      login: require('./lang/en-US/login').default,
      register: require('./lang/en-US/register').default,
      app: require('./lang/en-US/app').default,
      appOverview: require('./lang/en-US/app-overview').default,
      appDebug: require('./lang/en-US/app-debug').default,
      appApi: require('./lang/en-US/app-api').default,
      appLog: require('./lang/en-US/app-log').default,
      appAnnotation: require('./lang/en-US/app-annotation').default,
      share: require('./lang/en-US/share-app').default,
      dataset: require('./lang/en-US/dataset').default,
      datasetDocuments: require('./lang/en-US/dataset-documents').default,
      datasetHitTesting: require('./lang/en-US/dataset-hit-testing').default,
      datasetSettings: require('./lang/en-US/dataset-settings').default,
      datasetCreation: require('./lang/en-US/dataset-creation').default,
      explore: require('./lang/en-US/explore').default,
      billing: require('./lang/en-US/billing').default,
      custom: require('./lang/en-US/custom').default,
      tools: require('./lang/en-US/tools').default,
    },
  },
  'zh-Hans': {
    translation: {
      common: require('./lang/zh-Hans/common').default,
      layout: require('./lang/zh-Hans/layout').default,
      login: require('./lang/zh-Hans/login').default,
      register: require('./lang/zh-Hans/register').default,
      app: require('./lang/zh-Hans/app').default,
      appOverview: require('./lang/zh-Hans/app-overview').default,
      appDebug: require('./lang/zh-Hans/app-debug').default,
      appApi: require('./lang/zh-Hans/app-api').default,
      appLog: require('./lang/zh-Hans/app-log').default,
      appAnnotation: require('./lang/zh-Hans/app-annotation').default,
      share: require('./lang/zh-Hans/share-app').default,
      dataset: require('./lang/zh-Hans/dataset').default,
      datasetDocuments: require('./lang/zh-Hans/dataset-documents').default,
      datasetHitTesting: require('./lang/zh-Hans/dataset-hit-testing').default,
      datasetSettings: require('./lang/zh-Hans/dataset-settings').default,
      datasetCreation: require('./lang/zh-Hans/dataset-creation').default,
      explore: require('./lang/zh-Hans/explore').default,
      billing: require('./lang/zh-Hans/billing').default,
      custom: require('./lang/zh-Hans/custom').default,
      tools: require('./lang/zh-Hans/tools').default,
    },
  },
  'pt-BR': {
    translation: {
      common: require('./lang/pt-BR/common').default,
      layout: require('./lang/pt-BR/layout').default,
      login: require('./lang/pt-BR/login').default,
      register: require('./lang/pt-BR/register').default,
      app: require('./lang/pt-BR/app').default,
      appOverview: require('./lang/pt-BR/app-overview').default,
      appDebug: require('./lang/pt-BR/app-debug').default,
      appApi: require('./lang/pt-BR/app-api').default,
      appLog: require('./lang/pt-BR/app-log').default,
      appAnnotation: require('./lang/pt-BR/app-annotation').default,
      share: require('./lang/pt-BR/share-app').default,
      dataset: require('./lang/pt-BR/dataset').default,
      datasetDocuments: require('./lang/pt-BR/dataset-documents').default,
      datasetHitTesting: require('./lang/pt-BR/dataset-hit-testing').default,
      datasetSettings: require('./lang/pt-BR/dataset-settings').default,
      datasetCreation: require('./lang/pt-BR/dataset-creation').default,
      explore: require('./lang/pt-BR/explore').default,
      billing: require('./lang/pt-BR/billing').default,
      custom: require('./lang/pt-BR/custom').default,
      tools: require('./lang/pt-BR/tools').default,
    },
  },
  'uk-UA': {
    translation: {
      common: require('./lang/uk-UA/common').default,
      layout: require('./lang/uk-UA/layout').default,
      login: require('./lang/uk-UA/login').default,
      register: require('./lang/uk-UA/register').default,
      app: require('./lang/uk-UA/app').default,
      appOverview: require('./lang/uk-UA/app-overview').default,
      appDebug: require('./lang/uk-UA/app-debug').default,
      appApi: require('./lang/uk-UA/app-api').default,
      appLog: require('./lang/uk-UA/app-log').default,
      appAnnotation: require('./lang/uk-UA/app-annotation').default,
      share: require('./lang/uk-UA/share-app').default,
      dataset: require('./lang/uk-UA/dataset').default,
      datasetDocuments: require('./lang/uk-UA/dataset-documents').default,
      datasetHitTesting: require('./lang/uk-UA/dataset-hit-testing').default,
      datasetSettings: require('./lang/uk-UA/dataset-settings').default,
      datasetCreation: require('./lang/uk-UA/dataset-creation').default,
      explore: require('./lang/uk-UA/explore').default,
      billing: require('./lang/uk-UA/billing').default,
      custom: require('./lang/uk-UA/custom').default,
      tools: require('./lang/uk-UA/tools').default,
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
