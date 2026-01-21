import type { BasicPlan, BillingQuota, CurrentPlanInfoBackend } from '../type'
import dayjs from 'dayjs'
import { ALL_PLANS, NUM_INFINITE } from '@/app/components/billing/config'

/**
 * Parse vectorSpace string from ALL_PLANS config and convert to MB
 * @example "50MB" -> 50, "5GB" -> 5120, "20GB" -> 20480
 */
export const parseVectorSpaceToMB = (vectorSpace: string): number => {
  const match = vectorSpace.match(/^(\d+)(MB|GB)$/i)
  if (!match)
    return 0

  const value = Number.parseInt(match[1], 10)
  const unit = match[2].toUpperCase()

  return unit === 'GB' ? value * 1024 : value
}

/**
 * Get the vector space limit in MB for a given plan type from ALL_PLANS config
 */
export const getPlanVectorSpaceLimitMB = (planType: BasicPlan): number => {
  const planInfo = ALL_PLANS[planType]
  if (!planInfo)
    return 0

  return parseVectorSpaceToMB(planInfo.vectorSpace)
}

const parseLimit = (limit: number) => {
  if (limit === 0)
    return NUM_INFINITE

  return limit
}

const parseRateLimit = (limit: number) => {
  if (limit === 0 || limit === -1)
    return NUM_INFINITE

  return limit
}

const normalizeResetDate = (resetDate?: number | null) => {
  if (typeof resetDate !== 'number' || resetDate <= 0)
    return null

  if (resetDate >= 1e12)
    return dayjs(resetDate)

  if (resetDate >= 1e9)
    return dayjs(resetDate * 1000)

  const digits = resetDate.toString()
  if (digits.length === 8) {
    const year = digits.slice(0, 4)
    const month = digits.slice(4, 6)
    const day = digits.slice(6, 8)
    const parsed = dayjs(`${year}-${month}-${day}`)
    return parsed.isValid() ? parsed : null
  }

  return null
}

const getResetInDaysFromDate = (resetDate?: number | null) => {
  const resetDay = normalizeResetDate(resetDate)
  if (!resetDay)
    return null

  const diff = resetDay.startOf('day').diff(dayjs().startOf('day'), 'day')
  if (Number.isNaN(diff) || diff < 0)
    return null

  return diff
}

export const parseCurrentPlan = (data: CurrentPlanInfoBackend) => {
  const planType = data.billing.subscription.plan
  const planPreset = ALL_PLANS[planType]
  const resolveRateLimit = (limit?: number, fallback?: number) => {
    const value = limit ?? fallback ?? 0
    return parseRateLimit(value)
  }
  const getQuotaUsage = (quota?: BillingQuota) => quota?.usage ?? 0
  const getQuotaResetInDays = (quota?: BillingQuota) => {
    if (!quota)
      return null
    return getResetInDaysFromDate(quota.reset_date)
  }

  return {
    type: planType,
    usage: {
      vectorSpace: data.vector_space.size,
      buildApps: data.apps?.size || 0,
      teamMembers: data.members.size,
      annotatedResponse: data.annotation_quota_limit.size,
      documentsUploadQuota: data.documents_upload_quota.size,
      apiRateLimit: getQuotaUsage(data.api_rate_limit),
      triggerEvents: getQuotaUsage(data.trigger_event),
    },
    total: {
      vectorSpace: parseLimit(data.vector_space.limit),
      buildApps: parseLimit(data.apps?.limit) || 0,
      teamMembers: parseLimit(data.members.limit),
      annotatedResponse: parseLimit(data.annotation_quota_limit.limit),
      documentsUploadQuota: parseLimit(data.documents_upload_quota.limit),
      apiRateLimit: resolveRateLimit(data.api_rate_limit?.limit, planPreset?.apiRateLimit ?? NUM_INFINITE),
      triggerEvents: resolveRateLimit(data.trigger_event?.limit, planPreset?.triggerEvents),
    },
    reset: {
      apiRateLimit: getQuotaResetInDays(data.api_rate_limit),
      triggerEvents: getQuotaResetInDays(data.trigger_event),
    },
  }
}
