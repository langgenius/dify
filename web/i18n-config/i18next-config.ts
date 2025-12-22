'use client'
import i18n from 'i18next'
import { camelCase } from 'lodash-es'
import { initReactI18next } from 'react-i18next'

// Static imports for en-US (fallback language)
import appAnnotation from '../i18n/en-US/app-annotation'
import appApi from '../i18n/en-US/app-api'
import appDebug from '../i18n/en-US/app-debug'
import appLog from '../i18n/en-US/app-log'
import appOverview from '../i18n/en-US/app-overview'
import app from '../i18n/en-US/app'
import billing from '../i18n/en-US/billing'
import common from '../i18n/en-US/common'
import custom from '../i18n/en-US/custom'
import datasetCreation from '../i18n/en-US/dataset-creation'
import datasetDocuments from '../i18n/en-US/dataset-documents'
import datasetHitTesting from '../i18n/en-US/dataset-hit-testing'
import datasetPipeline from '../i18n/en-US/dataset-pipeline'
import datasetSettings from '../i18n/en-US/dataset-settings'
import dataset from '../i18n/en-US/dataset'
import education from '../i18n/en-US/education'
import explore from '../i18n/en-US/explore'
import layout from '../i18n/en-US/layout'
import login from '../i18n/en-US/login'
import oauth from '../i18n/en-US/oauth'
import pipeline from '../i18n/en-US/pipeline'
import pluginTags from '../i18n/en-US/plugin-tags'
import pluginTrigger from '../i18n/en-US/plugin-trigger'
import plugin from '../i18n/en-US/plugin'
import register from '../i18n/en-US/register'
import runLog from '../i18n/en-US/run-log'
import share from '../i18n/en-US/share'
import time from '../i18n/en-US/time'
import tools from '../i18n/en-US/tools'
import workflow from '../i18n/en-US/workflow'

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
  'dataset-pipeline',
  'dataset-settings',
  'dataset',
  'education',
  'explore',
  'layout',
  'login',
  'oauth',
  'pipeline',
  'plugin-tags',
  'plugin-trigger',
  'plugin',
  'register',
  'run-log',
  'share',
  'time',
  'tools',
  'workflow',
]

export const loadLangResources = async (lang: string) => {
  const modules = await Promise.all(
    NAMESPACES.map(ns => requireSilent(lang, ns)),
  )
  const resources = modules.reduce((acc, mod, index) => {
    acc[camelCase(NAMESPACES[index])] = mod
    return acc
  }, {} as Record<string, any>)
  return resources
}

// Load en-US resources first to make sure fallback works
const getInitialTranslations = () => {
  const en_USResources: Record<string, any> = {
    appAnnotation,
    appApi,
    appDebug,
    appLog,
    appOverview,
    app,
    billing,
    common,
    custom,
    datasetCreation,
    datasetDocuments,
    datasetHitTesting,
    datasetPipeline,
    datasetSettings,
    dataset,
    education,
    explore,
    layout,
    login,
    oauth,
    pipeline,
    pluginTags,
    pluginTrigger,
    plugin,
    register,
    runLog,
    share,
    time,
    tools,
    workflow,
  }
  return {
    'en-US': {
      translation: en_USResources,
    },
  }
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    lng: undefined,
    fallbackLng: 'en-US',
    resources: getInitialTranslations(),
  })
}

export const changeLanguage = async (lng?: string) => {
  if (!lng) return
  if (!i18n.hasResourceBundle(lng, 'translation')) {
    const resource = await loadLangResources(lng)
    i18n.addResourceBundle(lng, 'translation', resource, true, true)
  }
  await i18n.changeLanguage(lng)
}

export default i18n
