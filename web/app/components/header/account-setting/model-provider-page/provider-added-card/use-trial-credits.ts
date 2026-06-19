import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

const selectTrialCredits = (workspace: {
  trial_credits?: number | null
  trial_credits_used?: number | null
  next_credit_reset_date?: number | null
}) => {
  const totalCredits = workspace.trial_credits ?? 0
  const credits = Math.max(totalCredits - (workspace.trial_credits_used ?? 0), 0)

  return {
    credits,
    totalCredits,
    isExhausted: credits <= 0,
    nextCreditResetDate: workspace.next_credit_reset_date ?? undefined,
  }
}

export const useTrialCredits = () => {
  const trialCreditsQuery = useQuery(consoleQuery.workspaces.current.post.queryOptions({
    select: selectTrialCredits,
  }))
  const trialCredits = trialCreditsQuery.data

  return {
    credits: trialCredits?.credits ?? 0,
    totalCredits: trialCredits?.totalCredits ?? 0,
    isExhausted: trialCredits?.isExhausted ?? true,
    isLoading: trialCreditsQuery.isPending && !trialCredits,
    nextCreditResetDate: trialCredits?.nextCreditResetDate,
  }
}
