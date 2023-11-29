import { Plan } from '@/app/components/billing/type'
import type { CurrentPlanInfoBackend, SubscriptionUrlsBackend } from '@/app/components/billing/type'

export const fetchCurrentPlanInfo = (): Promise<CurrentPlanInfoBackend> => {
  return Promise.resolve({
    subscription: {
      plan: Plan.professional,
    },
    members: {
      size: 5,
      limit: 0,
    },
    apps: {
      size: 6,
      limit: 10,
    },
    vector_space: {
      size: 7,
      limit: 0,
    },
    docs_processing: 'standard',
  } as CurrentPlanInfoBackend)
}

export const fetchSubscriptionUrls = (): Promise<SubscriptionUrlsBackend> => {
  return Promise.resolve({
    monthly: [
      {
        plan: Plan.professional,
        url: 'https://ttt/subscribe/professional/monthly',
      },
      {
        plan: Plan.team,
        url: 'https://ttt/subscribe/team/monthly',
      },
    ],
    yearly: [
      {
        plan: Plan.professional,
        url: 'https://ttt/subscribe/professional/yearly',
      },
      {
        plan: Plan.team,
        url: 'https://ttt/subscribe/team/yearly',
      },
    ],
  } as SubscriptionUrlsBackend)
}

export const fetchBillingUrl = (): Promise<string> => {
  return Promise.resolve('https://ttt/billing')
}
