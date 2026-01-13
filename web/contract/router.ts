import { collectionPluginsContract, collectionsContract, searchAdvancedContract } from './marketplace'

export const marketPlaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
}
