import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { UsagePlanInfo } from '@/app/components/billing/type'
import type { ProviderContextState } from '@/context/provider-context'
import { merge } from 'es-toolkit/compat'
import { noop } from 'es-toolkit/function'
import { defaultPlan } from '@/app/components/billing/config'

// Avoid being mocked in tests
export const baseProviderContextValue: ProviderContextState = {
  modelProviders: [],
  modelProviderPlugins: {},
  refreshModelProviders: async () => {},
  isLoadingModelProviders: false,
  isSuccessModelProviders: false,
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

export const createMockProviderContextValue = (
  overrides: Partial<ProviderContextState> = {},
): ProviderContextState => {
  const merged = merge({}, baseProviderContextValue, overrides)

  return {
    ...merged,
    refreshModelProviders: merged.refreshModelProviders ?? noop,
    onPlanInfoChanged: merged.onPlanInfoChanged ?? noop,
  }
}

export const createMockPlan = (plan: CloudPlan): ProviderContextState =>
  createMockProviderContextValue({
    plan: merge({}, defaultPlan, {
      type: plan,
    }),
  })

export const createMockPlanUsage = (
  usage: UsagePlanInfo,
  ctx: Partial<ProviderContextState>,
): ProviderContextState =>
  createMockProviderContextValue({
    ...ctx,
    plan: merge(ctx.plan, {
      usage,
    }),
  })

export const createMockPlanTotal = (
  total: UsagePlanInfo,
  ctx: Partial<ProviderContextState>,
): ProviderContextState =>
  createMockProviderContextValue({
    ...ctx,
    plan: merge(ctx.plan, {
      total,
    }),
  })

export const createMockPlanReset = (
  reset: Partial<ProviderContextState['plan']['reset']>,
  ctx: Partial<ProviderContextState>,
): ProviderContextState =>
  createMockProviderContextValue({
    ...ctx,
    plan: merge(ctx?.plan, {
      reset,
    }),
  })
