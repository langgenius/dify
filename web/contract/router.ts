import type { InferContractRouterInputs } from '@orpc/contract'
import { accountAvatarContract } from './console/account'
import { workflowOnlineUsersContract } from './console/apps'
import { bindPartnerStackContract, invoicesContract } from './console/billing'
import { systemFeaturesContract } from './console/system'
import { trialAppDatasetsContract, trialAppInfoContract, trialAppParametersContract, trialAppWorkflowsContract } from './console/try-app'
import {
  workflowDraftEnvironmentVariablesContract,
  workflowDraftUpdateConversationVariablesContract,
  workflowDraftUpdateEnvironmentVariablesContract,
  workflowDraftUpdateFeaturesContract,
} from './console/workflow'
import { workflowCommentContracts } from './console/workflow-comment'
import { collectionPluginsContract, collectionsContract, searchAdvancedContract } from './marketplace'

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>

export const consoleRouterContract = {
  account: {
    avatar: accountAvatarContract,
  },
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
  apps: {
    workflowOnlineUsers: workflowOnlineUsersContract,
  },
  workflowDraft: {
    environmentVariables: workflowDraftEnvironmentVariablesContract,
    updateEnvironmentVariables: workflowDraftUpdateEnvironmentVariablesContract,
    updateConversationVariables: workflowDraftUpdateConversationVariablesContract,
    updateFeatures: workflowDraftUpdateFeaturesContract,
  },
  workflowComments: workflowCommentContracts,
}

export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
