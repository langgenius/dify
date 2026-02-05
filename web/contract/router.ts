import type { InferContractRouterInputs } from '@orpc/contract'
import { bindPartnerStackContract, invoicesContract } from './console/billing'
import { systemFeaturesContract } from './console/system'
import { trialAppDatasetsContract, trialAppInfoContract, trialAppParametersContract, trialAppWorkflowsContract } from './console/try-app'
import {
  addTemplateToCollectionContract,
  batchAddTemplatesToCollectionContract,
  clearCollectionTemplatesContract,
  collectionPluginsContract,
  collectionsContract,
  createTemplateCollectionContract,
  deleteTemplateCollectionContract,
  getCollectionTemplatesContract,
  getCreatorAvatarContract,
  getCreatorByHandleContract,
  getPublisherTemplatesContract,
  getTemplateByIdContract,
  getTemplateCollectionContract,
  getTemplateDslFileContract,
  getTemplatesListContract,
  searchAdvancedContract,
  searchCreatorsAdvancedContract,
  searchTemplatesAdvancedContract,
  searchTemplatesBasicContract,
  syncCreatorAvatarContract,
  syncCreatorProfileContract,
  templateCollectionsContract,
} from './marketplace'

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
  templateCollections: {
    list: templateCollectionsContract,
    create: createTemplateCollectionContract,
    get: getTemplateCollectionContract,
    delete: deleteTemplateCollectionContract,
    getTemplates: getCollectionTemplatesContract,
    addTemplate: addTemplateToCollectionContract,
    batchAddTemplates: batchAddTemplatesToCollectionContract,
    clearTemplates: clearCollectionTemplatesContract,
  },
  creators: {
    getByHandle: getCreatorByHandleContract,
    getAvatar: getCreatorAvatarContract,
    syncProfile: syncCreatorProfileContract,
    syncAvatar: syncCreatorAvatarContract,
    searchAdvanced: searchCreatorsAdvancedContract,
  },
  templates: {
    list: getTemplatesListContract,
    getById: getTemplateByIdContract,
    getDslFile: getTemplateDslFileContract,
    searchBasic: searchTemplatesBasicContract,
    searchAdvanced: searchTemplatesAdvancedContract,
    getPublisherTemplates: getPublisherTemplatesContract,
  },
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
}

export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
