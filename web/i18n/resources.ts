import type agentV2 from './locales/en-US/agent-v-2.json'
import type appAnnotation from './locales/en-US/app-annotation.json'
import type appApi from './locales/en-US/app-api.json'
import type appDebug from './locales/en-US/app-debug.json'
import type appLog from './locales/en-US/app-log.json'
import type appOverview from './locales/en-US/app-overview.json'
import type app from './locales/en-US/app.json'
import type billing from './locales/en-US/billing.json'
import type common from './locales/en-US/common.json'
import type custom from './locales/en-US/custom.json'
import type datasetCreation from './locales/en-US/dataset-creation.json'
import type datasetDocuments from './locales/en-US/dataset-documents.json'
import type datasetHitTesting from './locales/en-US/dataset-hit-testing.json'
import type datasetPipeline from './locales/en-US/dataset-pipeline.json'
import type datasetSettings from './locales/en-US/dataset-settings.json'
import type dataset from './locales/en-US/dataset.json'
import type deployments from './locales/en-US/deployments.json'
import type deviceFlow from './locales/en-US/device-flow.json'
import type education from './locales/en-US/education.json'
import type explore from './locales/en-US/explore.json'
import type layout from './locales/en-US/layout.json'
import type login from './locales/en-US/login.json'
import type oauth from './locales/en-US/oauth.json'
import type permissionKeys from './locales/en-US/permission-keys.json'
import type permission from './locales/en-US/permission.json'
import type pipeline from './locales/en-US/pipeline.json'
import type pluginTags from './locales/en-US/plugin-tags.json'
import type pluginTrigger from './locales/en-US/plugin-trigger.json'
import type plugin from './locales/en-US/plugin.json'
import type register from './locales/en-US/register.json'
import type runLog from './locales/en-US/run-log.json'
import type share from './locales/en-US/share.json'
import type skill from './locales/en-US/skill.json'
import type snippet from './locales/en-US/snippet.json'
import type time from './locales/en-US/time.json'
import type tools from './locales/en-US/tools.json'
import type workflow from './locales/en-US/workflow.json'
import { kebabCase } from 'string-ts'

type RawResources = {
  app: typeof app
  appAnnotation: typeof appAnnotation
  appApi: typeof appApi
  appDebug: typeof appDebug
  appLog: typeof appLog
  appOverview: typeof appOverview
  agentV2: typeof agentV2
  billing: typeof billing
  common: typeof common
  custom: typeof custom
  dataset: typeof dataset
  datasetCreation: typeof datasetCreation
  datasetDocuments: typeof datasetDocuments
  datasetHitTesting: typeof datasetHitTesting
  datasetPipeline: typeof datasetPipeline
  datasetSettings: typeof datasetSettings
  deployments: typeof deployments
  deviceFlow: typeof deviceFlow
  education: typeof education
  explore: typeof explore
  layout: typeof layout
  login: typeof login
  oauth: typeof oauth
  permission: typeof permission
  permissionKeys: typeof permissionKeys
  pipeline: typeof pipeline
  plugin: typeof plugin
  pluginTags: typeof pluginTags
  pluginTrigger: typeof pluginTrigger
  register: typeof register
  runLog: typeof runLog
  share: typeof share
  skill: typeof skill
  snippet: typeof snippet
  time: typeof time
  tools: typeof tools
  workflow: typeof workflow
}

// This type-only bridge exposes runtime plural base keys; selector types cannot require callers to pass count.
type PluralBaseResources = {
  agentV2: {
    'agentDetail.access.workflow.nodeCount': string
    'agentDetail.configure.buildDraft.changesToApply': string
    'agentDetail.configure.publishImpact.workflowCount': string
  }
  app: {
    'accessControlDialog.groups': string
    'accessControlDialog.members': string
  }
  billing: {
    'plansCommon.teamMember': string
  }
  common: {
    'members.recipientCount': string
    'members.seatsRemaining': string
    'members.sendInviteCount': string
  }
  dataset: {
    docAllEnabled: string
    partialEnabled: string
  }
  datasetDocuments: {
    'segment.characters': string
    'segment.childChunks': string
    'segment.chunks': string
    'segment.parentChunks': string
    'segment.searchResults': string
  }
  deployments: {
    'access.members.groupCount': string
    'access.members.memberCount': string
    'createGuide.target.bindingCount': string
    'createGuide.target.envVarCount': string
    'deployDrawer.bindingCount': string
    'deployDrawer.envVarCount': string
    'overview.apiKeysCount': string
    'overview.apiTokenSummary.environments': string
    'overview.chip.behind': string
    'overview.chip.behindTooltip': string
    'overview.latestRelease.releaseCount': string
    'versions.disabledReason.releaseInUse': string
  }
  permission: {
    'accessRule.summary': string
    'role.copyMembersDescription': string
  }
  skill: {
    'skillManagement.detail.uploadFilesFailedStatus': string
  }
  workflow: {
    'changeHistory.stepBackward': string
    'changeHistory.stepForward': string
    'nodes.iteration.error': string
    'nodes.iteration.iteration': string
    'nodes.loop.error': string
    'nodes.loop.loop': string
  }
}

export type Resources = RawResources & PluralBaseResources

export const defaultNS = 'app' as const

export const namespaces = [
  'app',
  'appAnnotation',
  'appApi',
  'appDebug',
  'appLog',
  'appOverview',
  'agentV2',
  'billing',
  'common',
  'custom',
  'dataset',
  'datasetCreation',
  'datasetDocuments',
  'datasetHitTesting',
  'datasetPipeline',
  'datasetSettings',
  'deployments',
  'deviceFlow',
  'education',
  'explore',
  'layout',
  'login',
  'oauth',
  'permission',
  'permissionKeys',
  'pipeline',
  'plugin',
  'pluginTags',
  'pluginTrigger',
  'register',
  'runLog',
  'share',
  'skill',
  'snippet',
  'time',
  'tools',
  'workflow',
] as const satisfies ReadonlyArray<keyof Resources>
export type Namespace = (typeof namespaces)[number]

const namespacesInFileName = namespaces.map((ns) => kebabCase(ns))
export type NamespaceInFileName = (typeof namespacesInFileName)[number]
