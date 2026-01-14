import type { InferContractRouterInputs } from '@orpc/contract'
import {
  billingUrlContract,
  bindPartnerStackContract,
  systemFeaturesContract,
} from './console'
import {
  activateSandboxProviderContract,
  deleteSandboxProviderConfigContract,
  getActiveSandboxProviderContract,
  getSandboxProviderContract,
  getSandboxProviderListContract,
  saveSandboxProviderConfigContract,
} from './console/sandbox-provider'
import { collectionPluginsContract, collectionsContract, searchAdvancedContract } from './marketplace'

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>

export const consoleRouterContract = {
  systemFeatures: systemFeaturesContract,
  billingUrl: billingUrlContract,
  bindPartnerStack: bindPartnerStackContract,
  getSandboxProviderList: getSandboxProviderListContract,
  getSandboxProvider: getSandboxProviderContract,
  saveSandboxProviderConfig: saveSandboxProviderConfigContract,
  deleteSandboxProviderConfig: deleteSandboxProviderConfigContract,
  activateSandboxProvider: activateSandboxProviderContract,
  getActiveSandboxProvider: getActiveSandboxProviderContract,
}

export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
