import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

export const useTrialCredits = () => {
  const { data: currentWorkspace, isPending } = useQuery(consoleQuery.workspaces.current.post.queryOptions())
  const totalCredits = currentWorkspace?.trial_credits ?? 0
  const credits = Math.max(totalCredits - (currentWorkspace?.trial_credits_used ?? 0), 0)

  return {
    credits,
    totalCredits,
    isExhausted: credits <= 0,
    isLoading: isPending && !currentWorkspace,
    nextCreditResetDate: currentWorkspace?.next_credit_reset_date,
  }
}
