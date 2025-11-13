import type { CurrentPlanInfoBackend } from '../type'
import { ALL_PLANS, NUM_INFINITE } from '@/app/components/billing/config'

const parseLimit = (limit: number) => {
  if (limit === 0)
    return NUM_INFINITE

  return limit
}

export const parseCurrentPlan = (data: CurrentPlanInfoBackend) => {
  const planType = data.billing.subscription.plan
  const planPreset = ALL_PLANS[planType]
  const resolveLimit = (limit?: number, fallback?: number) => {
    const value = limit ?? fallback ?? 0
    return parseLimit(value)
  }

  return {
    type: planType,
    usage: {
      vectorSpace: data.vector_space.size,
      buildApps: data.apps?.size || 0,
      teamMembers: data.members.size,
      annotatedResponse: data.annotation_quota_limit.size,
      documentsUploadQuota: data.documents_upload_quota.size,
      apiRateLimit: data.api_rate_limit?.size ?? 0,
      triggerEvents: data.trigger_events?.size ?? 0,
    },
    total: {
      vectorSpace: parseLimit(data.vector_space.limit),
      buildApps: parseLimit(data.apps?.limit) || 0,
      teamMembers: parseLimit(data.members.limit),
      annotatedResponse: parseLimit(data.annotation_quota_limit.limit),
      documentsUploadQuota: parseLimit(data.documents_upload_quota.limit),
      apiRateLimit: resolveLimit(data.api_rate_limit?.limit, planPreset?.apiRateLimit ?? NUM_INFINITE),
      triggerEvents: resolveLimit(data.trigger_events?.limit, planPreset?.triggerEvents),
    },
  }
}
