'use client'

import type { Plan, UsagePlanInfo, UsageResetInfo } from '@/app/components/billing/type'
import type { Model, ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RETRIEVE_METHOD } from '@/types/app'
import { noop } from 'es-toolkit/function'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import { defaultPlan } from '@/app/components/billing/config'

export type ProviderContextState = {
  modelProviders: ModelProvider[]
  refreshModelProviders: () => void
  textGenerationModelList: Model[]
  supportRetrievalMethods: RETRIEVE_METHOD[]
  isAPIKeySet: boolean
  plan: {
    type: Plan
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
  datasetOperatorEnabled: boolean
  enableEducationPlan: boolean
  isEducationWorkspace: boolean
  isEducationAccount: boolean
  allowRefreshEducationVerify: boolean
  educationAccountExpireAt: number | null
  isLoadingEducationAccountInfo: boolean
  isFetchingEducationAccountInfo: boolean
  webappCopyrightEnabled: boolean
  licenseLimit: {
    workspace_members: {
      size: number
      limit: number
    }
  }
  refreshLicenseLimit: () => void
  isAllowTransferWorkspace: boolean
  isAllowPublishAsCustomKnowledgePipelineTemplate: boolean
  humanInputEmailDeliveryEnabled: boolean
}

export const baseProviderContextValue: ProviderContextState = {
  modelProviders: [],
  refreshModelProviders: noop,
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
  datasetOperatorEnabled: false,
  enableEducationPlan: false,
  isEducationWorkspace: false,
  isEducationAccount: false,
  allowRefreshEducationVerify: false,
  educationAccountExpireAt: null,
  isLoadingEducationAccountInfo: false,
  isFetchingEducationAccountInfo: false,
  webappCopyrightEnabled: false,
  licenseLimit: {
    workspace_members: {
      size: 0,
      limit: 0,
    },
  },
  refreshLicenseLimit: noop,
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
