import type { InferContractRouterInputs } from '@orpc/contract'
import { bindPartnerStackContract, invoicesContract } from './console/billing'
import { generateFlowchartContract, searchAppsContract, searchDatasetsContract } from './console/goto-anything'
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
  gotoAnything: {
    searchApps: searchAppsContract,
    searchDatasets: searchDatasetsContract,
    generateFlowchart: generateFlowchartContract,
  },
}

export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
