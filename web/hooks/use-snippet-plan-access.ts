'use client'

import { canAccessSnippets } from '@/app/components/billing/utils'
import { useProviderContextSelector } from '@/context/provider-context'

export const useSnippetPlanAccess = () => {
  const planType = useProviderContextSelector(state => state.plan.type)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)
  const isFetchedPlan = useProviderContextSelector(state => state.isFetchedPlan)

  return {
    canAccess: canAccessSnippets({
      enableBilling,
      isFetchedPlan,
      planType,
    }),
    isReady: !enableBilling || isFetchedPlan,
  }
}
