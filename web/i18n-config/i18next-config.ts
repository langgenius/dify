'use client'
import type { Locale } from '.'
import i18n from 'i18next'
import { camelCase, kebabCase } from 'lodash-es'

import { initReactI18next } from 'react-i18next'
import appAnnotation from '../i18n/en-US/app-annotation.json'
import appApi from '../i18n/en-US/app-api.json'
import appDebug from '../i18n/en-US/app-debug.json'
import appLog from '../i18n/en-US/app-log.json'
import appOverview from '../i18n/en-US/app-overview.json'
import app from '../i18n/en-US/app.json'
import billing from '../i18n/en-US/billing.json'
import common from '../i18n/en-US/common.json'
import custom from '../i18n/en-US/custom.json'
import datasetCreation from '../i18n/en-US/dataset-creation.json'
import datasetDocuments from '../i18n/en-US/dataset-documents.json'
import datasetHitTesting from '../i18n/en-US/dataset-hit-testing.json'
import datasetPipeline from '../i18n/en-US/dataset-pipeline.json'
import datasetSettings from '../i18n/en-US/dataset-settings.json'
import dataset from '../i18n/en-US/dataset.json'
import education from '../i18n/en-US/education.json'
import explore from '../i18n/en-US/explore.json'
import layout from '../i18n/en-US/layout.json'
import login from '../i18n/en-US/login.json'
import oauth from '../i18n/en-US/oauth.json'
import pipeline from '../i18n/en-US/pipeline.json'
import pluginTags from '../i18n/en-US/plugin-tags.json'
import pluginTrigger from '../i18n/en-US/plugin-trigger.json'
import plugin from '../i18n/en-US/plugin.json'
import register from '../i18n/en-US/register.json'
import runLog from '../i18n/en-US/run-log.json'
import share from '../i18n/en-US/share.json'
import time from '../i18n/en-US/time.json'
import tools from '../i18n/en-US/tools.json'
import workflow from '../i18n/en-US/workflow.json'

// @keep-sorted
export const messagesEN = {
  app,
  appAnnotation,
  appApi,
  appDebug,
  appLog,
  appOverview,
  billing,
  common,
  custom,
  dataset,
  datasetCreation,
  datasetDocuments,
  datasetHitTesting,
  datasetPipeline,
  datasetSettings,
  education,
  explore,
  layout,
  login,
  oauth,
  pipeline,
  plugin,
  pluginTags,
  pluginTrigger,
  register,
  runLog,
  share,
  time,
  tools,
  workflow,
}

// pluginTrigger -> plugin-trigger

export type KebabCase<S extends string> = S extends `${infer T}${infer U}`
  ? T extends Lowercase<T>
    ? `${T}${KebabCase<U>}`
    : `-${Lowercase<T>}${KebabCase<U>}`
  : S

export type CamelCase<S extends string> = S extends `${infer T}-${infer U}`
  ? `${T}${Capitalize<CamelCase<U>>}`
  : S

export type KeyPrefix = keyof typeof messagesEN
export type Namespace = KebabCase<KeyPrefix>

const requireSilent = async (lang: Locale, namespace: Namespace) => {
  let res
  try {
    res = (await import(`../i18n/${lang}/${namespace}.json`)).default
  }
  catch {
    res = (await import(`../i18n/en-US/${namespace}.json`)).default
  }

  return res
}

const NAMESPACES = Object.keys(messagesEN).map(kebabCase) as Namespace[]

export const loadLangResources = async (lang: Locale) => {
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
  return {
    'en-US': {
      translation: messagesEN,
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

export const changeLanguage = async (lng?: Locale) => {
  if (!lng)
    return
  if (!i18n.hasResourceBundle(lng, 'translation')) {
    const resource = await loadLangResources(lng)
    i18n.addResourceBundle(lng, 'translation', resource, true, true)
  }
  await i18n.changeLanguage(lng)
}

export default i18n
