import { bundlesSearchAdvancedContract, collectionPluginsContract, collectionsContract, pluginsSearchAdvancedContract } from './marketplace'

export const marketPlaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  pluginsSearchAdvanced: pluginsSearchAdvancedContract,
  bundlesSearchAdvanced: bundlesSearchAdvancedContract,
}
