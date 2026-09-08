'use client'

import type {
  ModelProviderPluginSummaryResponse,
  ModelProviderSummaryResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { createContext, useContext, useContextSelector } from 'use-context-selector'

export type ProviderContextState = {
  modelProviders: ModelProviderSummaryResponse[]
  modelProviderPlugins: Record<string, ModelProviderPluginSummaryResponse>
  isLoadingModelProviders: boolean
  isSuccessModelProviders: boolean
  refreshModelProviders: () => Promise<void>
  textGenerationModelList: Model[]
  isAPIKeySet: boolean
  enableSkill: boolean
  enableReplaceWebAppLogo: boolean
  modelLoadBalancingEnabled: boolean
  enableEducationPlan: boolean
  isAllowTransferWorkspace: boolean
  isAllowPublishAsCustomKnowledgePipelineTemplate: boolean
  humanInputEmailDeliveryEnabled: boolean
}

export const baseProviderContextValue: ProviderContextState = {
  modelProviders: [],
  modelProviderPlugins: {},
  isLoadingModelProviders: false,
  isSuccessModelProviders: false,
  refreshModelProviders: async () => {},
  textGenerationModelList: [],
  isAPIKeySet: true,
  enableSkill: false,
  enableReplaceWebAppLogo: false,
  modelLoadBalancingEnabled: false,
  enableEducationPlan: false,
  isAllowTransferWorkspace: false,
  isAllowPublishAsCustomKnowledgePipelineTemplate: false,
  humanInputEmailDeliveryEnabled: false,
}

export const ProviderContext = createContext<ProviderContextState>(baseProviderContextValue)

export const useProviderContext = () => useContext(ProviderContext)

// Adding a dangling comma to avoid the generic parsing issue in tsx, see:
// https://github.com/microsoft/TypeScript/issues/15713
export const useProviderContextSelector = <T>(selector: (state: ProviderContextState) => T): T =>
  useContextSelector(ProviderContext, selector)
