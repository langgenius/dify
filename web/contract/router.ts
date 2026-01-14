import type { InferContractRouterInputs } from '@orpc/contract'
import {
  activateSandboxProviderContract,
  billingUrlContract,
  bindPartnerStackContract,
  deleteSandboxProviderConfigContract,
  getActiveSandboxProviderContract,
  getSandboxProviderContract,
  getSandboxProviderListContract,
  saveSandboxProviderConfigContract,
  systemFeaturesContract,
} from './console'
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
