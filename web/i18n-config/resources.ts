import { kebabCase } from 'es-toolkit/string'
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
const resources = {
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

export type KebabCase<S extends string> = S extends `${infer T}${infer U}`
  ? T extends Lowercase<T>
    ? `${T}${KebabCase<U>}`
    : `-${Lowercase<T>}${KebabCase<U>}`
  : S

export type CamelCase<S extends string> = S extends `${infer T}-${infer U}`
  ? `${T}${Capitalize<CamelCase<U>>}`
  : S

export type Resources = typeof resources
export type NamespaceCamelCase = keyof Resources
export type NamespaceKebabCase = KebabCase<NamespaceCamelCase>

export const namespacesCamelCase = Object.keys(resources) as NamespaceCamelCase[]
export const namespacesKebabCase = namespacesCamelCase.map(ns => kebabCase(ns)) as NamespaceKebabCase[]
