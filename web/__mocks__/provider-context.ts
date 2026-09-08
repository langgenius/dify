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
