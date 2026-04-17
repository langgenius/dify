'use client'

import { canAccessSnippetsAndEvaluation } from '@/app/components/billing/utils'
import { useProviderContextSelector } from '@/context/provider-context'

export const useSnippetAndEvaluationPlanAccess = () => {
  const planType = useProviderContextSelector(state => state.plan.type)
  const enableBilling = useProviderContextSelector(state => state.enableBilling)
  const isFetchedPlan = useProviderContextSelector(state => state.isFetchedPlan)

  return {
    canAccess: canAccessSnippetsAndEvaluation({
      enableBilling,
      isFetchedPlan,
      planType,
    }),
    isReady: !enableBilling || isFetchedPlan,
  }
}
