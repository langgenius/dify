import type { CurrentPlanInfoBackend, SubscriptionUrlsBackend } from '@/app/components/billing/type'
import { get } from './base'

export const fetchCurrentPlanInfo = () => {
  return get<CurrentPlanInfoBackend>('/features')
}

export const fetchSubscriptionUrls = (plan: string, interval: string) => {
  return get<SubscriptionUrlsBackend>(`/billing/subscription?plan=${plan}&interval=${interval}`)
}
