'use client'

import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type {
  ModelProviderPluginSummaryResponse,
  ModelProviderSummaryResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { UsagePlanInfo, UsageResetInfo } from '@/app/components/billing/type'
import type { Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RETRIEVE_METHOD } from '@/types/app'
import { noop } from 'es-toolkit/function'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import { defaultPlan } from '@/app/components/billing/config'

export type ProviderContextState = {
  modelProviders: ModelProviderSummaryResponse[]
  modelProviderPlugins: Record<string, ModelProviderPluginSummaryResponse>
  isLoadingModelProviders: boolean
  isSuccessModelProviders: boolean
  refreshModelProviders: () => Promise<void>
  textGenerationModelList: Model[]
  supportRetrievalMethods: RETRIEVE_METHOD[]
  isAPIKeySet: boolean
  plan: {
    type: CloudPlan
    usage: UsagePlanInfo
    total: UsagePlanInfo
    reset: UsageResetInfo
  }
  isFetchedPlan: boolean
  isFetchedPlanInfo: boolean
  enableBilling: boolean
  onPlanInfoChanged: () => void
  enableReplaceWebAppLogo: boolean
  modelLoadBalancingEnabled: boolean
  enableEducationPlan: boolean
  webappCopyrightEnabled: boolean
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
  supportRetrievalMethods: [],
  isAPIKeySet: true,
  plan: defaultPlan,
  isFetchedPlan: false,
  isFetchedPlanInfo: false,
  enableBilling: false,
  onPlanInfoChanged: noop,
  enableReplaceWebAppLogo: false,
  modelLoadBalancingEnabled: false,
  enableEducationPlan: false,
  webappCopyrightEnabled: false,
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
