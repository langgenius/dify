import { get } from '@/service/base'
import type { QuotaUsageResponse } from './type'

export const fetchQuotaUsage = () => {
  return get<QuotaUsageResponse>('/billing/quota/usage')
}

// Add other billing related services here if any in the future
// For example:
// export const fetchSubscriptionPlans = () => {
//   return get('/billing/plans')
// }
//
// export const updateSubscription = (planId: string) => {
//   return post('/billing/subscription', { body: { plan_id: planId } })
// }
