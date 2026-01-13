import type { InferContractRouterInputs } from '@orpc/contract'
import { systemFeaturesContract } from './console'
import { collectionPluginsContract, collectionsContract, searchAdvancedContract } from './marketplace'

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>

export const consoleRouterContract = {
  systemFeatures: systemFeaturesContract,
}

export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
