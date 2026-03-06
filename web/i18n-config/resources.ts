import type appAnnotation from '../i18n/en-US/app-annotation.json'
import type appApi from '../i18n/en-US/app-api.json'
import type appDebug from '../i18n/en-US/app-debug.json'
import type appLog from '../i18n/en-US/app-log.json'
import type appOverview from '../i18n/en-US/app-overview.json'
import type app from '../i18n/en-US/app.json'
import type billing from '../i18n/en-US/billing.json'
import type common from '../i18n/en-US/common.json'
import type custom from '../i18n/en-US/custom.json'
import type datasetCreation from '../i18n/en-US/dataset-creation.json'
import type datasetDocuments from '../i18n/en-US/dataset-documents.json'
import type datasetHitTesting from '../i18n/en-US/dataset-hit-testing.json'
import type datasetPipeline from '../i18n/en-US/dataset-pipeline.json'
import type datasetSettings from '../i18n/en-US/dataset-settings.json'
import type dataset from '../i18n/en-US/dataset.json'
import type education from '../i18n/en-US/education.json'
import type explore from '../i18n/en-US/explore.json'
import type layout from '../i18n/en-US/layout.json'
import type login from '../i18n/en-US/login.json'
import type oauth from '../i18n/en-US/oauth.json'
import type pipeline from '../i18n/en-US/pipeline.json'
import type pluginTags from '../i18n/en-US/plugin-tags.json'
import type pluginTrigger from '../i18n/en-US/plugin-trigger.json'
import type plugin from '../i18n/en-US/plugin.json'
import type register from '../i18n/en-US/register.json'
import type runLog from '../i18n/en-US/run-log.json'
import type share from '../i18n/en-US/share.json'
import type time from '../i18n/en-US/time.json'
import type tools from '../i18n/en-US/tools.json'
import type workflow from '../i18n/en-US/workflow.json'
import { kebabCase } from 'string-ts'

export type Resources = {
  app: typeof app
  appAnnotation: typeof appAnnotation
  appApi: typeof appApi
  appDebug: typeof appDebug
  appLog: typeof appLog
  appOverview: typeof appOverview
  billing: typeof billing
  common: typeof common
  custom: typeof custom
  dataset: typeof dataset
  datasetCreation: typeof datasetCreation
  datasetDocuments: typeof datasetDocuments
  datasetHitTesting: typeof datasetHitTesting
  datasetPipeline: typeof datasetPipeline
  datasetSettings: typeof datasetSettings
  education: typeof education
  explore: typeof explore
  layout: typeof layout
  login: typeof login
  oauth: typeof oauth
  pipeline: typeof pipeline
  plugin: typeof plugin
  pluginTags: typeof pluginTags
  pluginTrigger: typeof pluginTrigger
  register: typeof register
  runLog: typeof runLog
  share: typeof share
  time: typeof time
  tools: typeof tools
  workflow: typeof workflow
}

export const namespaces = [
  'app',
  'appAnnotation',
  'appApi',
  'appDebug',
  'appLog',
  'appOverview',
  'billing',
  'common',
  'custom',
  'dataset',
  'datasetCreation',
  'datasetDocuments',
  'datasetHitTesting',
  'datasetPipeline',
  'datasetSettings',
  'education',
  'explore',
  'layout',
  'login',
  'oauth',
  'pipeline',
  'plugin',
  'pluginTags',
  'pluginTrigger',
  'register',
  'runLog',
  'share',
  'time',
  'tools',
  'workflow',
] as const satisfies ReadonlyArray<keyof Resources>
export type Namespace = typeof namespaces[number]

export const namespacesInFileName = namespaces.map(ns => kebabCase(ns))
export type NamespaceInFileName = typeof namespacesInFileName[number]
