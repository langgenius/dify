import type GeneratedResources from './resources.generated'
import { kebabCase } from 'string-ts'

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
    'difyBuilder.checklistFixAction': string
    'difyBuilder.checklistFixSummary': string
    'difyBuilder.checklistUnfixableNote': string
    'nodes.iteration.error': string
    'nodes.iteration.iteration': string
    'nodes.loop.error': string
    'nodes.loop.loop': string
  }
}

export type Resources = GeneratedResources & PluralBaseResources

export const defaultNS = 'app' as const

export const namespaces = [
  'workflowGenerator',
  'workflowModels',
  'workflowHumanInput',
  'workflowIntegrations',
  'workflowLogic',
  'workflowAgent',
  'workflowDebug',
  'workflowComments',
  'workflowHistory',
  'onboarding',
  'modelProvider',
  'workspaceMembers',
  'navigation',
  'accountSettings',
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
