'use client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import commonEn from './lang/common.en'
import commonZh from './lang/common.zh'
import loginEn from './lang/login.en'
import loginZh from './lang/login.zh'
import registerEn from './lang/register.en'
import registerZh from './lang/register.zh'
import layoutEn from './lang/layout.en'
import layoutZh from './lang/layout.zh'
import appEn from './lang/app.en'
import appZh from './lang/app.zh'
import appOverviewEn from './lang/app-overview.en'
import appOverviewZh from './lang/app-overview.zh'
import appDebugEn from './lang/app-debug.en'
import appDebugZh from './lang/app-debug.zh'
import appApiEn from './lang/app-api.en'
import appApiZh from './lang/app-api.zh'
import appLogEn from './lang/app-log.en'
import appLogZh from './lang/app-log.zh'
import shareEn from './lang/share-app.en'
import shareZh from './lang/share-app.zh'
import datasetEn from './lang/dataset.en'
import datasetZh from './lang/dataset.zh'
import datasetDocumentsEn from './lang/dataset-documents.en'
import datasetDocumentsZh from './lang/dataset-documents.zh'
import datasetHitTestingEn from './lang/dataset-hit-testing.en'
import datasetHitTestingZh from './lang/dataset-hit-testing.zh'
import datasetSettingsEn from './lang/dataset-settings.en'
import datasetSettingsZh from './lang/dataset-settings.zh'
import datasetCreationEn from './lang/dataset-creation.en'
import datasetCreationZh from './lang/dataset-creation.zh'
import exploreEn from './lang/explore.en'
import exploreZh from './lang/explore.zh'
import { getLocaleOnClient } from '@/i18n/client'

const resources = {
  'en': {
    translation: {
      common: commonEn,
      layout: layoutEn, // page layout
      login: loginEn,
      register: registerEn,
      // app
      app: appEn,
      appOverview: appOverviewEn,
      appDebug: appDebugEn,
      appApi: appApiEn,
      appLog: appLogEn,
      // share
      share: shareEn,
      dataset: datasetEn,
      datasetDocuments: datasetDocumentsEn,
      datasetHitTesting: datasetHitTestingEn,
      datasetSettings: datasetSettingsEn,
      datasetCreation: datasetCreationEn,
      explore: exploreEn,
    },
  },
  'zh-Hans': {
    translation: {
      common: commonZh,
      layout: layoutZh,
      login: loginZh,
      register: registerZh,
      // app
      app: appZh,
      appOverview: appOverviewZh,
      appDebug: appDebugZh,
      appApi: appApiZh,
      appLog: appLogZh,
      // share
      share: shareZh,
      dataset: datasetZh,
      datasetDocuments: datasetDocumentsZh,
      datasetHitTesting: datasetHitTestingZh,
      datasetSettings: datasetSettingsZh,
      datasetCreation: datasetCreationZh,
      explore: exploreZh,
    },
  },
}

i18n.use(initReactI18next)
  // init i18next
  // for all options read: https://www.i18next.com/overview/configuration-options
  .init({
    lng: getLocaleOnClient(),
    fallbackLng: 'en',
    // debug: true,
    resources,
  })

export const changeLanguage = i18n.changeLanguage
export default i18n
