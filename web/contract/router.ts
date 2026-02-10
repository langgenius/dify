import type { InferContractRouterInputs } from '@orpc/contract'
import { bindPartnerStackContract, invoicesContract } from './console/billing'
import { systemFeaturesContract } from './console/system'
import {
  triggerOAuthConfigContract,
  triggerOAuthConfigureContract,
  triggerOAuthDeleteContract,
  triggerOAuthInitiateContract,
  triggerProviderInfoContract,
  triggersContract,
  triggerSubscriptionBuildContract,
  triggerSubscriptionBuilderCreateContract,
  triggerSubscriptionBuilderLogsContract,
  triggerSubscriptionBuilderUpdateContract,
  triggerSubscriptionBuilderVerifyUpdateContract,
  triggerSubscriptionDeleteContract,
  triggerSubscriptionsContract,
  triggerSubscriptionUpdateContract,
  triggerSubscriptionVerifyContract,
} from './console/trigger'
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
  getPublisherPluginsContract,
  getPublisherTemplatesContract,
  getTemplateByIdContract,
  getTemplateCollectionContract,
  getTemplateDslFileContract,
  getTemplatesListContract,
  searchAdvancedContract,
  searchCreatorsAdvancedContract,
  searchTemplatesAdvancedContract,
  searchTemplatesBasicContract,
  searchUnifiedContract,
  syncCreatorAvatarContract,
  syncCreatorProfileContract,
  templateCollectionsContract,
} from './marketplace'

export const marketplaceRouterContract = {
  plugins: {
    collections: collectionsContract,
    collectionPlugins: collectionPluginsContract,
    searchAdvanced: searchAdvancedContract,
    getPublisherPlugins: getPublisherPluginsContract,
  },
  searchUnified: searchUnifiedContract,
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
  triggers: {
    list: triggersContract,
    providerInfo: triggerProviderInfoContract,
    subscriptions: triggerSubscriptionsContract,
    subscriptionBuilderCreate: triggerSubscriptionBuilderCreateContract,
    subscriptionBuilderUpdate: triggerSubscriptionBuilderUpdateContract,
    subscriptionBuilderVerifyUpdate: triggerSubscriptionBuilderVerifyUpdateContract,
    subscriptionVerify: triggerSubscriptionVerifyContract,
    subscriptionBuild: triggerSubscriptionBuildContract,
    subscriptionDelete: triggerSubscriptionDeleteContract,
    subscriptionUpdate: triggerSubscriptionUpdateContract,
    subscriptionBuilderLogs: triggerSubscriptionBuilderLogsContract,
    oauthConfig: triggerOAuthConfigContract,
    oauthConfigure: triggerOAuthConfigureContract,
    oauthDelete: triggerOAuthDeleteContract,
    oauthInitiate: triggerOAuthInitiateContract,
  },
}

export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
