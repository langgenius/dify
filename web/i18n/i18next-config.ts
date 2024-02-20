'use client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import commonEn from './lang/common.en'
import commonZh from './lang/common.zh'
import commonUk from './lang/common.uk' // Ukrainian import
import commonPt from './lang/common.pt' // Portuguese import
import loginEn from './lang/login.en'
import loginZh from './lang/login.zh'
import loginPt from './lang/login.pt' // Portuguese import
import loginUk from './lang/login.uk' // Ukrainian import
import registerEn from './lang/register.en'
import registerZh from './lang/register.zh'
import registerPt from './lang/register.pt' // Portuguese import
import registerUk from './lang/register.uk' // Ukrainian import
import layoutEn from './lang/layout.en'
import layoutZh from './lang/layout.zh'
import layoutPt from './lang/layout.pt' // Portuguese import
import layoutUk from './lang/layout.uk' // Ukrainian import
import appEn from './lang/app.en'
import appZh from './lang/app.zh'
import appPt from './lang/app.pt' // Portuguese import
import appUk from './lang/app.uk' // Ukrainian import
import appOverviewEn from './lang/app-overview.en'
import appOverviewZh from './lang/app-overview.zh'
import appOverviewPt from './lang/app-overview.pt' // Portuguese import
import appOverviewUk from './lang/app-overview.uk' // Ukrainian import
import appDebugEn from './lang/app-debug.en'
import appDebugZh from './lang/app-debug.zh'
import appDebugPt from './lang/app-debug.pt' // Portuguese import
import appDebugUk from './lang/app-debug.uk' // Ukrainian import
import appApiEn from './lang/app-api.en'
import appApiZh from './lang/app-api.zh'
import appApiPt from './lang/app-api.pt' // Portuguese import
import appApiUk from './lang/app-api.uk' // Ukrainian import
import appLogEn from './lang/app-log.en'
import appLogZh from './lang/app-log.zh'
import appLogPt from './lang/app-log.pt' // Portuguese import
import appLogUk from './lang/app-log.uk' // Ukrainian import
import appAnnotationEn from './lang/app-annotation.en'
import appAnnotationZh from './lang/app-annotation.zh'
import appAnnotationPt from './lang/app-annotation.pt' // Portuguese import
import appAnnotationUk from './lang/app-annotation.uk' // Ukrainian import
import shareEn from './lang/share-app.en'
import shareZh from './lang/share-app.zh'
import sharePt from './lang/share-app.pt' // Portuguese import
import shareUk from './lang/share-app.uk' // Ukrainian import
import datasetEn from './lang/dataset.en'
import datasetZh from './lang/dataset.zh'
import datasetPt from './lang/dataset.pt' // Portuguese import
import datasetUk from './lang/dataset.uk' // Ukrainian import
import datasetDocumentsEn from './lang/dataset-documents.en'
import datasetDocumentsZh from './lang/dataset-documents.zh'
import datasetDocumentsPt from './lang/dataset-documents.pt' // Portuguese import
import datasetDocumentsUk from './lang/dataset-documents.uk' // Ukrainian import
import datasetHitTestingEn from './lang/dataset-hit-testing.en'
import datasetHitTestingZh from './lang/dataset-hit-testing.zh'
import datasetHitTestingPt from './lang/dataset-hit-testing.pt' // Portuguese import
import datasetHitTestingUk from './lang/dataset-hit-testing.uk' // Ukrainian import
import datasetSettingsEn from './lang/dataset-settings.en'
import datasetSettingsZh from './lang/dataset-settings.zh'
import datasetSettingsPt from './lang/dataset-settings.pt' // Portuguese import
import datasetSettingsUk from './lang/dataset-settings.uk' // Ukrainian import
import datasetCreationEn from './lang/dataset-creation.en'
import datasetCreationZh from './lang/dataset-creation.zh'
import datasetCreationPt from './lang/dataset-creation.pt' // Portuguese import
import datasetCreationUk from './lang/dataset-creation.uk' // Ukrainian import
import exploreEn from './lang/explore.en'
import exploreZh from './lang/explore.zh'
import explorePt from './lang/explore.pt' // Portuguese import
import exploreUk from './lang/explore.uk' // Ukrainian import
import billingEn from './lang/billing.en'
import billingZh from './lang/billing.zh'
import billingPt from './lang/billing.pt' // Portuguese import
import billingUk from './lang/billing.uk' // Ukrainian import
import customEn from './lang/custom.en'
import customZh from './lang/custom.zh'
import customPt from './lang/custom.pt' // Portuguese import
import customUk from './lang/custom.uk' // Ukrainian import
import toolsEn from './lang/tools.en'
import toolsZh from './lang/tools.zh'
import toolsPt from './lang/tools.pt' // Portuguese import
import toolsUk from './lang/tools.uk' // Ukrainian import

const resources = {
  'en-US': {
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
      appAnnotation: appAnnotationEn,
      // share
      share: shareEn,
      dataset: datasetEn,
      datasetDocuments: datasetDocumentsEn,
      datasetHitTesting: datasetHitTestingEn,
      datasetSettings: datasetSettingsEn,
      datasetCreation: datasetCreationEn,
      explore: exploreEn,
      // billing
      billing: billingEn,
      custom: customEn,
      // tools
      tools: toolsEn,
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
      appAnnotation: appAnnotationZh,
      // share
      share: shareZh,
      dataset: datasetZh,
      datasetDocuments: datasetDocumentsZh,
      datasetHitTesting: datasetHitTestingZh,
      datasetSettings: datasetSettingsZh,
      datasetCreation: datasetCreationZh,
      explore: exploreZh,
      billing: billingZh,
      custom: customZh,
      // tools
      tools: toolsZh,
    },
  },
  'pt-BR': {
    translation: {
      common: commonPt,
      layout: layoutPt,
      login: loginPt,
      register: registerPt,
      // app
      app: appPt,
      appOverview: appOverviewPt,
      appDebug: appDebugPt,
      appApi: appApiPt,
      appLog: appLogPt,
      appAnnotation: appAnnotationPt,
      // share
      share: sharePt,
      dataset: datasetPt,
      datasetDocuments: datasetDocumentsPt,
      datasetHitTesting: datasetHitTestingPt,
      datasetSettings: datasetSettingsPt,
      datasetCreation: datasetCreationPt,
      explore: explorePt,
      billing: billingPt,
      custom: customPt,
      tools: toolsPt,
    },
  },
  'uk-UA': {
    translation: {
      common: commonUk,
      layout: layoutUk,
      login: loginUk,
      register: registerUk,
      app: appUk,
      appOverview: appOverviewUk,
      appDebug: appDebugUk,
      appApi: appApiUk,
      appLog: appLogUk,
      appAnnotation: appAnnotationUk,
      share: shareUk,
      dataset: datasetUk,
      datasetDocuments: datasetDocumentsUk,
      datasetHitTesting: datasetHitTestingUk,
      datasetSettings: datasetSettingsUk,
      datasetCreation: datasetCreationUk,
      explore: exploreUk,
      billing: billingUk,
      custom: customUk,
      tools: toolsUk,
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
