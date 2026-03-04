import { useCurrentWorkspace } from '@/service/use-common'

export const useTrialCredits = () => {
  const { data: currentWorkspace, isPending } = useCurrentWorkspace()
  const credits = Math.max(((currentWorkspace?.trial_credits ?? 0) - (currentWorkspace?.trial_credits_used ?? 0)) || 0, 0)

  return {
    credits,
    isExhausted: credits <= 0,
    isLoading: isPending && !currentWorkspace,
    nextCreditResetDate: currentWorkspace?.next_credit_reset_date,
  }
}
