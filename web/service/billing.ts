import { get } from './base'
import type { CurrentPlanInfoBackend, SubscriptionUrlsBackend } from '@/app/components/billing/type'

export const fetchCurrentPlanInfo = () => {
  return get<Promise<CurrentPlanInfoBackend>>('/billing/info')
  // return Promise.resolve({
  //   subscription: {
  //     plan: Plan.professional,
  //   },
  //   members: {
  //     size: 5,
  //     limit: 0,
  //   },
  //   apps: {
  //     size: 16,
  //     limit: 10,
  //   },
  //   vector_space: {
  //     size: 7,
  //     limit: 0,
  //   },
  //   docs_processing: 'standard',
  // } as CurrentPlanInfoBackend)
}

export const fetchSubscriptionUrls = () => {
  return get<Promise<SubscriptionUrlsBackend>>('/billing/subscription')
  // return Promise.resolve({
  //   monthly: [
  //     {
  //       plan: Plan.professional,
  //       url: 'https://ttt/subscribe/professional/monthly',
  //     },
  //     {
  //       plan: Plan.team,
  //       url: 'https://ttt/subscribe/team/monthly',
  //     },
  //   ],
  //   yearly: [
  //     {
  //       plan: Plan.professional,
  //       url: 'https://ttt/subscribe/professional/yearly',
  //     },
  //     {
  //       plan: Plan.team,
  //       url: 'https://ttt/subscribe/team/yearly',
  //     },
  //   ],
  // } as SubscriptionUrlsBackend)
}

export const fetchBillingUrl = () => {
  return get<Promise<{ url: string }>>('/billing/invoices')
  // return Promise.resolve('https://ttt/billing')
}
