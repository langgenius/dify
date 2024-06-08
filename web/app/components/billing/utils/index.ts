import type { CurrentPlanInfoBackend } from '../type'
import { NUM_INFINITE } from '@/app/components/billing/config'

const parseLimit = (limit: number) => {
  if (limit === 0)
    return NUM_INFINITE

  return limit
}

export const parseCurrentPlan = (data: CurrentPlanInfoBackend) => {
  return {
    type: data.billing.subscription.plan,
    usage: {
      vectorSpace: data.vector_space.size,
      buildApps: data.apps?.size || 0,
      teamMembers: data.members.size,
      annotatedResponse: data.annotation_quota_limit.size,
      documentsUploadQuota: data.documents_upload_quota.size,
    },
    total: {
      vectorSpace: parseLimit(data.vector_space.limit),
      buildApps: parseLimit(data.apps?.limit) || 0,
      teamMembers: parseLimit(data.members.limit),
      annotatedResponse: parseLimit(data.annotation_quota_limit.limit),
      documentsUploadQuota: parseLimit(data.documents_upload_quota.limit),
    },
  }
}
