import type { InferContractRouterInputs } from '@orpc/contract'
import { accountAvatarContract } from './console/account'
import {
  batchUploadContract,
  createFolderContract,
  deleteNodeContract,
  getFileContentContract,
  getFileDownloadUrlContract,
  getFileUploadUrlContract,
  moveNodeContract,
  publishContract,
  renameNodeContract,
  reorderNodeContract,
  treeContract,
  updateFileContentContract,
} from './console/app-asset'
import { workflowOnlineUsersContract } from './console/apps'
import { bindPartnerStackContract, invoicesContract } from './console/billing'
import {
  downloadFileContract,
  listFilesContract,
} from './console/sandbox-file'
import {
  activateSandboxProviderContract,
  deleteSandboxProviderConfigContract,
  getSandboxProviderListContract,
  saveSandboxProviderConfigContract,
} from './console/sandbox-provider'
import { setupStatusContract, systemFeaturesContract } from './console/system'
import { trialAppDatasetsContract, trialAppInfoContract, trialAppParametersContract, trialAppWorkflowsContract } from './console/try-app'
import {
  workflowDraftEnvironmentVariablesContract,
  workflowDraftNodeSkillsContract,
  workflowDraftUpdateConversationVariablesContract,
  workflowDraftUpdateEnvironmentVariablesContract,
  workflowDraftUpdateFeaturesContract,
} from './console/workflow'
import { workflowCommentContracts } from './console/workflow-comment'
import { collectionPluginsContract, collectionsContract, searchAdvancedContract } from './marketplace'

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>

export const consoleRouterContract = {
  account: {
    avatar: accountAvatarContract,
  },
  systemFeatures: systemFeaturesContract,
  setupStatus: setupStatusContract,
  trialApps: {
    info: trialAppInfoContract,
    datasets: trialAppDatasetsContract,
    parameters: trialAppParametersContract,
    workflows: trialAppWorkflowsContract,
  },
  billing: {
    invoices: invoicesContract,
    bindPartnerStack: bindPartnerStackContract,
  },
  sandboxProvider: {
    getSandboxProviderList: getSandboxProviderListContract,
    saveSandboxProviderConfig: saveSandboxProviderConfigContract,
    deleteSandboxProviderConfig: deleteSandboxProviderConfigContract,
    activateSandboxProvider: activateSandboxProviderContract,
  },
  sandboxFile: {
    listFiles: listFilesContract,
    downloadFile: downloadFileContract,
  },
  appAsset: {
    tree: treeContract,
    createFolder: createFolderContract,
    getFileContent: getFileContentContract,
    getFileDownloadUrl: getFileDownloadUrlContract,
    updateFileContent: updateFileContentContract,
    deleteNode: deleteNodeContract,
    renameNode: renameNodeContract,
    moveNode: moveNodeContract,
    reorderNode: reorderNodeContract,
    publish: publishContract,
    getFileUploadUrl: getFileUploadUrlContract,
    batchUpload: batchUploadContract,
  },
  apps: {
    workflowOnlineUsers: workflowOnlineUsersContract,
  },
  workflowDraft: {
    environmentVariables: workflowDraftEnvironmentVariablesContract,
    nodeSkills: workflowDraftNodeSkillsContract,
    updateEnvironmentVariables: workflowDraftUpdateEnvironmentVariablesContract,
    updateConversationVariables: workflowDraftUpdateConversationVariablesContract,
    updateFeatures: workflowDraftUpdateFeaturesContract,
  },
  workflowComments: workflowCommentContracts,
}

export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
