import type { ProviderContextState } from '@/context/provider-context'
import { merge } from 'es-toolkit/compat'
import { noop } from 'es-toolkit/function'

// Avoid being mocked in tests
export const baseProviderContextValue: ProviderContextState = {
  modelProviders: [],
  modelProviderPlugins: {},
  refreshModelProviders: async () => {},
  isLoadingModelProviders: false,
  isSuccessModelProviders: false,
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

export const createMockProviderContextValue = (
  overrides: Partial<ProviderContextState> = {},
): ProviderContextState => {
  const merged = merge({}, baseProviderContextValue, overrides)

  return {
    ...merged,
    refreshModelProviders: merged.refreshModelProviders ?? noop,
  }
}
