import type { ModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

const selectTrialCredits = (creditPool: ModelProviderCreditsResponse) => {
  const modelBillingSource = creditPool.model_billing_source ?? 'legacy_message_credits'
  const usesLegacyMessageCredits = modelBillingSource === 'legacy_message_credits'
  return {
    modelBillingSource,
    tokenerBootstrapStatus: creditPool.tokener_bootstrap_status ?? null,
    credits: usesLegacyMessageCredits ? (creditPool.remaining_credits ?? 0) : 0,
    usedCredits: usesLegacyMessageCredits ? (creditPool.quota_used ?? 0) : 0,
    totalCredits: usesLegacyMessageCredits ? (creditPool.quota_limit ?? 0) : 0,
    isUnlimited: usesLegacyMessageCredits && creditPool.is_unlimited,
    isExhausted: usesLegacyMessageCredits && creditPool.is_exhausted,
    exhaustedAt: creditPool.exhausted_at ?? undefined,
    nextCreditResetDate: creditPool.next_credit_reset_date ?? undefined,
  }
}

export const useTrialCredits = () => {
  const trialCreditsQuery = useQuery(
    consoleQuery.workspaces.current.modelProviders.credits.get.queryOptions({
      select: selectTrialCredits,
    }),
  )
  const trialCredits = trialCreditsQuery.data

  return {
    modelBillingSource: trialCredits?.modelBillingSource ?? 'legacy_message_credits',
    tokenerBootstrapStatus: trialCredits?.tokenerBootstrapStatus,
    credits: trialCredits?.credits ?? 0,
    usedCredits: trialCredits?.usedCredits ?? 0,
    totalCredits: trialCredits?.totalCredits ?? 0,
    isUnlimited: trialCredits?.isUnlimited ?? false,
    isExhausted: trialCredits?.isExhausted ?? true,
    isLoading: trialCreditsQuery.isPending && !trialCredits,
    exhaustedAt: trialCredits?.exhaustedAt,
    nextCreditResetDate: trialCredits?.nextCreditResetDate,
  }
}
