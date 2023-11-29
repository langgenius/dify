import { Plan } from '@/app/components/billing/type'
import type { CurrentPlanInfoBackend } from '@/app/components/billing/type'
export const fetchCurrentPlanInfo = (): Promise<CurrentPlanInfoBackend> => {
  return Promise.resolve({
    subscription: {
      plan: Plan.sandbox,
    },
    members: {
      size: 5,
      limit: 20,
    },
    apps: {
      size: 6,
      limit: 30,
    },
    vector_space: {
      size: 7,
      limit: 40,
    },
    docs_processing: 'standard',
  } as CurrentPlanInfoBackend)
}
