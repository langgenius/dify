import { merge, noop } from 'lodash-es'
import { defaultPlan } from '@/app/components/billing/config'
import type { ProviderContextState } from '@/context/provider-context'
import type { Plan, UsagePlanInfo } from '@/app/components/billing/type'

// Avoid being mocked in tests
export const baseProviderContextValue: ProviderContextState = {
  modelProviders: [],
  refreshModelProviders: noop,
  textGenerationModelList: [],
  supportRetrievalMethods: [],
  isAPIKeySet: true,
  plan: defaultPlan,
  isFetchedPlan: false,
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
}

export const createMockProviderContextValue = (overrides: Partial<ProviderContextState> = {}): ProviderContextState => {
  const merged = merge({}, baseProviderContextValue, overrides)

  return {
    ...merged,
    refreshModelProviders: merged.refreshModelProviders ?? noop,
    onPlanInfoChanged: merged.onPlanInfoChanged ?? noop,
    refreshLicenseLimit: merged.refreshLicenseLimit ?? noop,
  }
}

export const createMockPlan = (plan: Plan): ProviderContextState =>
  createMockProviderContextValue({
    plan: merge({}, defaultPlan, {
      type: plan,
    }),
  })

export const createMockPlanUsage = (usage: UsagePlanInfo, ctx: Partial<ProviderContextState>): ProviderContextState =>
  createMockProviderContextValue({
    ...ctx,
    plan: merge(ctx.plan, {
      usage,
    }),
  })

export const createMockPlanTotal = (total: UsagePlanInfo, ctx: Partial<ProviderContextState>): ProviderContextState =>
  createMockProviderContextValue({
    ...ctx,
    plan: merge(ctx.plan, {
      total,
    }),
  })

export const createMockPlanReset = (reset: Partial<ProviderContextState['plan']['reset']>, ctx: Partial<ProviderContextState>): ProviderContextState =>
  createMockProviderContextValue({
    ...ctx,
    plan: merge(ctx?.plan, {
      reset,
    }),
  })
