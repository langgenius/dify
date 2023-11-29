import type { CurrentPlanInfoBackend } from '../type'
export const parseCurrentPlan = (data: CurrentPlanInfoBackend) => {
  return {
    type: data.subscription.plan,
    usage: {
      vectorSpace: data.vector_space.size,
      buildApps: data.apps.size,
      teamMembers: data.members.size,
    },
    total: {
      vectorSpace: data.vector_space.limit,
      buildApps: data.apps.limit,
      teamMembers: data.members.limit,
    },
  }
}
