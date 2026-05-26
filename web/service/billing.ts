import type { CurrentPlanInfoBackend, SubscriptionUrlsBackend } from '@/app/components/billing/type'
import { get } from './base'

export type CurrentPlanVectorSpaceBackend = {
  size: number
  limit: number
}

export const fetchCurrentPlanInfo = () => {
  return get<CurrentPlanInfoBackend>('/features')
}

export const fetchCurrentPlanVectorSpace = () => {
  return get<CurrentPlanVectorSpaceBackend>('/features/vector-space')
}

export const fetchSubscriptionUrls = (plan: string, interval: string) => {
  return get<SubscriptionUrlsBackend>(`/billing/subscription?plan=${plan}&interval=${interval}`)
}
