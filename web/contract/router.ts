import type { InferContractRouterInputs } from '@orpc/contract'
import { bindPartnerStackContract, invoicesContract } from './console/billing'
import {
  exploreAppDetailContract,
  exploreAppsContract,
  exploreBannersContract,
  exploreInstalledAppAccessModeContract,
  exploreInstalledAppMetaContract,
  exploreInstalledAppParametersContract,
  exploreInstalledAppPinContract,
  exploreInstalledAppsContract,
  exploreInstalledAppUninstallContract,
} from './console/explore'
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
import { collectionPluginsContract, collectionsContract, searchAdvancedContract } from './marketplace'

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>

export const consoleRouterContract = {
  systemFeatures: systemFeaturesContract,
  explore: {
    apps: exploreAppsContract,
    appDetail: exploreAppDetailContract,
    installedApps: exploreInstalledAppsContract,
    uninstallInstalledApp: exploreInstalledAppUninstallContract,
    updateInstalledApp: exploreInstalledAppPinContract,
    appAccessMode: exploreInstalledAppAccessModeContract,
    installedAppParameters: exploreInstalledAppParametersContract,
    installedAppMeta: exploreInstalledAppMetaContract,
    banners: exploreBannersContract,
  },
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
