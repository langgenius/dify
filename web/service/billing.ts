import { Plan } from '@/app/components/billing/type'
import type { CurrentPlanInfoBackend } from '@/app/components/billing/type'
export const fetchCurrentPlanInfo = (): Promise<CurrentPlanInfoBackend> => {
  return Promise.resolve({
    subscription: {
      plan: Plan.team,
    },
    members: {
      size: 5,
      limit: 0,
    },
    apps: {
      size: 6,
      limit: 0,
    },
    vector_space: {
      size: 7,
      limit: 0,
    },
    docs_processing: 'standard',
  } as CurrentPlanInfoBackend)
}
