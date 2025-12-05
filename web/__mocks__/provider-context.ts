import { merge, noop } from 'lodash-es'
import { defaultPlan } from '@/app/components/billing/config'
import { baseProviderContextValue } from '@/context/provider-context'
import type { ProviderContextState } from '@/context/provider-context'
import type { Plan } from '@/app/components/billing/type'

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
