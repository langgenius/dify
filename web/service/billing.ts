import { get } from './base'
import type { CurrentPlanInfoBackend, SubscriptionUrlsBackend } from '@/app/components/billing/type'

export const fetchCurrentPlanInfo = () => {
  return get<Promise<CurrentPlanInfoBackend>>('/billing/info')
}

export const fetchSubscriptionUrls = () => {
  return get<Promise<SubscriptionUrlsBackend>>('/billing/subscription')
}

export const fetchBillingUrl = () => {
  return get<Promise<{ url: string }>>('/billing/invoices')
}
