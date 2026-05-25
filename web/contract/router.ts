import type { InferContractRouterInputs } from '@orpc/contract'
import { contract as communityContract } from '@dify/contracts/api/console/orpc.gen'
import { contract as enterpriseContract } from '@dify/contracts/enterprise/orpc.gen'
import { accountAvatarContract } from './console/account'
import { appDeleteContract, appListContract, workflowOnlineUsersContract } from './console/apps'
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
import { changePreferredProviderTypeContract, modelProvidersModelsContract } from './console/model-providers'
import { notificationContract, notificationDismissContract } from './console/notification'
import { pluginCheckInstalledContract, pluginLatestVersionsContract } from './console/plugins'
import { systemFeaturesContract } from './console/system'
import {
  tagBindingCreateContract,
  tagBindingRemoveContract,
  tagCreateContract,
  tagDeleteContract,
  tagListContract,
  tagUpdateContract,
} from './console/tags'
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
  workflowDraftEnvironmentVariablesContract,
  workflowDraftUpdateConversationVariablesContract,
  workflowDraftUpdateEnvironmentVariablesContract,
  workflowDraftUpdateFeaturesContract,
} from './console/workflow'
import { workflowCommentContracts } from './console/workflow-comment'
import { collectionPluginsContract, collectionsContract, downloadPluginContract, searchAdvancedContract, templateDetailContract } from './marketplace'

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
  templateDetail: templateDetailContract,
  downloadPlugin: downloadPluginContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>

// Hand-written console contracts below are temporary overrides for gaps in the
// generated community contract. Prefer fixing backend OpenAPI annotations so
// generated contracts include accurate method, path, input, and output types;
// once generated contracts are correct, the matching hand-written contracts
// should be removed instead of kept in parallel.
export const consoleRouterContract = {
  enterprise: enterpriseContract,
  ...communityContract,
  account: {
    ...communityContract.account,
    avatar: accountAvatarContract,
  },
  systemFeatures: systemFeaturesContract,
  apps: {
    ...communityContract.apps,
    list: appListContract,
    deleteApp: appDeleteContract,
    workflowOnlineUsers: workflowOnlineUsersContract,
  },
  explore: {
    ...communityContract.explore,
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
    ...communityContract.trialApps,
    info: trialAppInfoContract,
    datasets: trialAppDatasetsContract,
    parameters: trialAppParametersContract,
    workflows: trialAppWorkflowsContract,
  },
  modelProviders: {
    models: modelProvidersModelsContract,
    changePreferredProviderType: changePreferredProviderTypeContract,
  },
  plugins: {
    checkInstalled: pluginCheckInstalledContract,
    latestVersions: pluginLatestVersionsContract,
  },
  billing: {
    ...communityContract.billing,
    invoices: invoicesContract,
    bindPartnerStack: bindPartnerStackContract,
  },
  workflowDraft: {
    environmentVariables: workflowDraftEnvironmentVariablesContract,
    updateEnvironmentVariables: workflowDraftUpdateEnvironmentVariablesContract,
    updateConversationVariables: workflowDraftUpdateConversationVariablesContract,
    updateFeatures: workflowDraftUpdateFeaturesContract,
  },
  workflowComments: workflowCommentContracts,
  notification: notificationContract,
  notificationDismiss: notificationDismissContract,
  tags: {
    ...communityContract.tags,
    list: tagListContract,
    create: tagCreateContract,
    update: tagUpdateContract,
    delete: tagDeleteContract,
    bind: tagBindingCreateContract,
    unbind: tagBindingRemoveContract,
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
