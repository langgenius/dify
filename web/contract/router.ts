import type { InferContractRouterInputs } from '@orpc/contract'
import { billingUrlContract, bindPartnerStackContract, systemFeaturesContract } from './console'
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
}

export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
