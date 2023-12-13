import { get } from './base'
import type { CurrentPlanInfoBackend, SubscriptionUrlsBackend } from '@/app/components/billing/type'

export const fetchCurrentPlanInfo = () => {
  return get<Promise<CurrentPlanInfoBackend>>('/billing/info')
}

export const fetchSubscriptionUrls = (plan: string, interval: string) => {
  return get<Promise<SubscriptionUrlsBackend>>(`/billing/subscription?plan=${plan}&interval=${interval}`)
}

export const fetchBillingUrl = () => {
  return get<Promise<{ url: string }>>('/billing/invoices')
}
