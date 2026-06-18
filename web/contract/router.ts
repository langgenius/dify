import type { InferContractRouterInputs } from '@orpc/contract'
import { contract as communityContract } from '@dify/contracts/api/console/orpc.gen'
import { contract as enterpriseContract } from '@dify/contracts/enterprise/orpc.gen'
import {
  appDeleteContract,
  appListContract,
  appStarContract,
  appStarredListContract,
  appUnstarContract,
  workflowOnlineUsersContract,
} from './console/apps'
import { bindPartnerStackContract, invoicesContract } from './console/billing'
import {
  exploreAppDetailContract,
  exploreAppsContract,
  exploreBannersContract,
  exploreInstalledAppAccessModeContract,
  exploreInstalledAppAccessModeUpdateContract,
  exploreInstalledAppMetaContract,
  exploreInstalledAppParametersContract,
  exploreInstalledAppPinContract,
  exploreInstalledAppsContract,
  exploreInstalledAppUninstallContract,
  learnDifyAppsContract,
} from './console/explore'
import { fileUploadContract } from './console/files'
import { changePreferredProviderTypeContract, modelProvidersModelsContract } from './console/model-providers'
import { notificationContract, notificationDismissContract } from './console/notification'
import { pluginCheckInstalledContract, pluginLatestVersionsContract } from './console/plugins'
import {
  checkSnippetDependenciesContract,
  confirmSnippetImportContract,
  createCustomizedSnippetContract,
  deleteCustomizedSnippetContract,
  exportCustomizedSnippetContract,
  getCustomizedSnippetContract,
  getSnippetDefaultBlockConfigsContract,
  getSnippetDraftConfigContract,
  getSnippetDraftNodeLastRunContract,
  getSnippetDraftWorkflowContract,
  getSnippetPublishedWorkflowContract,
  getSnippetWorkflowRunDetailContract,
  importCustomizedSnippetContract,
  incrementSnippetUseCountContract,
  listCustomizedSnippetsContract,
  listSnippetWorkflowRunNodeExecutionsContract,
  listSnippetWorkflowRunsContract,
  publishSnippetWorkflowContract,
  runSnippetDraftIterationNodeContract,
  runSnippetDraftLoopNodeContract,
  runSnippetDraftNodeContract,
  runSnippetDraftWorkflowContract,
  stopSnippetWorkflowTaskContract,
  syncSnippetDraftWorkflowContract,
  updateCustomizedSnippetContract,
} from './console/snippets'
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
import { workspacesGetContract, workspaceSwitchContract } from './console/workspaces'
import { collectionPluginsContract, collectionsContract, downloadPluginContract, searchAdvancedContract, templateDetailContract } from './marketplace'

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
  templateDetail: templateDetailContract,
  downloadPlugin: downloadPluginContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>

export const consoleRouterContract = {
  enterprise: enterpriseContract,
  ...communityContract,
  apps: {
    ...communityContract.apps,
    list: appListContract,
    deleteApp: appDeleteContract,
    starredList: appStarredListContract,
    star: appStarContract,
    unstar: appUnstarContract,
    workflowOnlineUsers: workflowOnlineUsersContract,
    byAppId: {
      ...communityContract.apps.byAppId,
    },
  },
  agent: communityContract.agent,
  explore: {
    ...communityContract.explore,
    apps: exploreAppsContract,
    learnDifyApps: learnDifyAppsContract,
    appDetail: exploreAppDetailContract,
    installedApps: exploreInstalledAppsContract,
    uninstallInstalledApp: exploreInstalledAppUninstallContract,
    updateInstalledApp: exploreInstalledAppPinContract,
    appAccessMode: exploreInstalledAppAccessModeContract,
    updateAppAccessMode: exploreInstalledAppAccessModeUpdateContract,
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
  files: {
    ...communityContract.files,
    upload: {
      ...communityContract.files.upload,
      post: fileUploadContract,
    },
  },
  modelProviders: {
    models: modelProvidersModelsContract,
    changePreferredProviderType: changePreferredProviderTypeContract,
  },
  plugins: {
    checkInstalled: pluginCheckInstalledContract,
    latestVersions: pluginLatestVersionsContract,
  },
  snippets: {
    list: listCustomizedSnippetsContract,
    create: createCustomizedSnippetContract,
    detail: getCustomizedSnippetContract,
    update: updateCustomizedSnippetContract,
    delete: deleteCustomizedSnippetContract,
    export: exportCustomizedSnippetContract,
    import: importCustomizedSnippetContract,
    confirmImport: confirmSnippetImportContract,
    checkDependencies: checkSnippetDependenciesContract,
    incrementUseCount: incrementSnippetUseCountContract,
    draftWorkflow: getSnippetDraftWorkflowContract,
    syncDraftWorkflow: syncSnippetDraftWorkflowContract,
    draftConfig: getSnippetDraftConfigContract,
    publishedWorkflow: getSnippetPublishedWorkflowContract,
    publishWorkflow: publishSnippetWorkflowContract,
    defaultBlockConfigs: getSnippetDefaultBlockConfigsContract,
    workflowRuns: listSnippetWorkflowRunsContract,
    workflowRunDetail: getSnippetWorkflowRunDetailContract,
    workflowRunNodeExecutions: listSnippetWorkflowRunNodeExecutionsContract,
    runDraftNode: runSnippetDraftNodeContract,
    lastDraftNodeRun: getSnippetDraftNodeLastRunContract,
    runDraftIterationNode: runSnippetDraftIterationNodeContract,
    runDraftLoopNode: runSnippetDraftLoopNodeContract,
    runDraftWorkflow: runSnippetDraftWorkflowContract,
    stopWorkflowTask: stopSnippetWorkflowTaskContract,
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
  workspaces: {
    ...communityContract.workspaces,
    get: workspacesGetContract,
    switch: {
      post: workspaceSwitchContract,
    },
  },
}
