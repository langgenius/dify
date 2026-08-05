import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

const selectTrialCredits = (workspace: {
  trial_credits?: number | null
  trial_credits_used?: number | null
  trial_credits_exhausted_at?: number | null
  next_credit_reset_date?: number | null
}) => {
  const totalCredits = Math.max(workspace.trial_credits ?? 0, 0)
  const rawUsedCredits = workspace.trial_credits_used ?? 0
  const normalizedUsedCredits = Math.max(rawUsedCredits, 0)
  const usedCredits = Math.min(normalizedUsedCredits, totalCredits)
  const credits = Math.max(totalCredits - usedCredits, 0)

  return {
    credits,
    usedCredits,
    totalCredits,
    isExhausted: credits <= 0,
    exhaustedAt: workspace.trial_credits_exhausted_at ?? undefined,
    nextCreditResetDate: workspace.next_credit_reset_date ?? undefined,
  }
}

export const useTrialCredits = () => {
  const trialCreditsQuery = useQuery(
    consoleQuery.workspaces.current.post.queryOptions({
      select: selectTrialCredits,
    }),
  )
  const trialCredits = trialCreditsQuery.data

  return {
    credits: trialCredits?.credits ?? 0,
    usedCredits: trialCredits?.usedCredits ?? 0,
    totalCredits: trialCredits?.totalCredits ?? 0,
    isExhausted: trialCredits?.isExhausted ?? true,
    isLoading: trialCreditsQuery.isPending && !trialCredits,
    exhaustedAt: trialCredits?.exhaustedAt,
    nextCreditResetDate: trialCredits?.nextCreditResetDate,
  }
}
