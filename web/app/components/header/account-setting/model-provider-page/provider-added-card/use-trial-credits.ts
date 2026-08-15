import type { ModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

const selectTrialCredits = (creditPool: ModelProviderCreditsResponse) => {
  return {
    credits: creditPool.remaining_credits ?? 0,
    usedCredits: creditPool.quota_used ?? 0,
    totalCredits: creditPool.quota_limit ?? 0,
    isUnlimited: creditPool.is_unlimited,
    isExhausted: creditPool.is_exhausted,
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
