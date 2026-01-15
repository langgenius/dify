import type { InferContractRouterInputs } from '@orpc/contract'
import {
  createFileContract,
  createFolderContract,
  deleteNodeContract,
  getFileContentContract,
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
  getActiveSandboxProviderContract,
  getSandboxProviderContract,
  getSandboxProviderListContract,
  saveSandboxProviderConfigContract,
} from './console/sandbox-provider'
import { systemFeaturesContract } from './console/system'
import { collectionPluginsContract, collectionsContract, searchAdvancedContract } from './marketplace'

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>

export const consoleRouterContract = {
  systemFeatures: systemFeaturesContract,
  billing: {
    invoices: invoicesContract,
    bindPartnerStack: bindPartnerStackContract,
  },
  sandboxProvider: {
    getSandboxProviderList: getSandboxProviderListContract,
    getSandboxProvider: getSandboxProviderContract,
    saveSandboxProviderConfig: saveSandboxProviderConfigContract,
    deleteSandboxProviderConfig: deleteSandboxProviderConfigContract,
    activateSandboxProvider: activateSandboxProviderContract,
    getActiveSandboxProvider: getActiveSandboxProviderContract,
  },
  appAsset: {
    tree: treeContract,
    createFolder: createFolderContract,
    createFile: createFileContract,
    getFileContent: getFileContentContract,
    updateFileContent: updateFileContentContract,
    deleteNode: deleteNodeContract,
    renameNode: renameNodeContract,
    moveNode: moveNodeContract,
    reorderNode: reorderNodeContract,
    publish: publishContract,
  },
}

export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
