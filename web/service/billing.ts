import { get, put } from './base'
import type { CurrentPlanInfoBackend, SubscriptionUrlsBackend } from '@/app/components/billing/type'

export const fetchCurrentPlanInfo = () => {
  return get<CurrentPlanInfoBackend>('/features')
}

export const fetchSubscriptionUrls = (plan: string, interval: string) => {
  return get<SubscriptionUrlsBackend>(`/billing/subscription?plan=${plan}&interval=${interval}`)
}

export const fetchBillingUrl = () => {
  return get<{ url: string }>('/billing/invoices')
}

export const bindPartnerStackInfo = (partnerKey: string, clickId: string) => {
  return put(`/billing/partners/${partnerKey}/tenants`, {
    body: {
      click_id: clickId,
    },
  }, {
    silent: true,
  })
}
