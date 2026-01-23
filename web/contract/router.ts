import type { InferContractRouterInputs } from '@orpc/contract'
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
import { bindPartnerStackContract, invoicesContract } from './console/billing'
import {
  activateSandboxProviderContract,
  deleteSandboxProviderConfigContract,
  getSandboxProviderListContract,
  saveSandboxProviderConfigContract,
} from './console/sandbox-provider'
import { systemFeaturesContract } from './console/system'
import { trialAppDatasetsContract, trialAppInfoContract, trialAppParametersContract, trialAppWorkflowsContract } from './console/try-app'
import { collectionPluginsContract, collectionsContract, searchAdvancedContract } from './marketplace'

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>

export const consoleRouterContract = {
  systemFeatures: systemFeaturesContract,
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
}

export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
