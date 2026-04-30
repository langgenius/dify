import type { InferContractRouterInputs } from '@orpc/contract'
import { accountAvatarContract } from './console/account'
import { appDeleteContract, workflowOnlineUsersContract } from './console/apps'
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
import { contract as enterpriseContract } from './generated/enterprise/orpc.gen'
import { collectionPluginsContract, collectionsContract, searchAdvancedContract, templateDetailContract } from './marketplace'

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
  templateDetail: templateDetailContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>

export const consoleRouterContract = {
  enterprise: enterpriseContract,
  account: {
    avatar: accountAvatarContract,
  },
  systemFeatures: systemFeaturesContract,
  apps: {
    deleteApp: appDeleteContract,
    workflowOnlineUsers: workflowOnlineUsersContract,
  },
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
  modelProviders: {
    models: modelProvidersModelsContract,
    changePreferredProviderType: changePreferredProviderTypeContract,
  },
  plugins: {
    checkInstalled: pluginCheckInstalledContract,
    latestVersions: pluginLatestVersionsContract,
  },
  billing: {
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
