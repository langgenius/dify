import type { FeatureResponse, Quota } from '@dify/contracts/api/console/features/types.gen'
import type { BasicPlan } from '../type'
import dayjs from 'dayjs'
import { ALL_PLANS, NUM_INFINITE } from '@/app/components/billing/config'
import { Plan } from '../type'

/**
 * Parse vectorSpace string from ALL_PLANS config and convert to MB
 * @example "50MB" -> 50, "5GB" -> 5120, "20GB" -> 20480
 */
export const parseVectorSpaceToMB = (vectorSpace: string): number => {
  const match = /^(\d+)(MB|GB)$/i.exec(vectorSpace)
  if (!match) return 0

  const value = Number.parseInt(match[1]!, 10)
  const unit = match[2]!.toUpperCase()

  return unit === 'GB' ? value * 1024 : value
}

/**
 * Get the vector space limit in MB for a given plan type from ALL_PLANS config
 */
export const getPlanVectorSpaceLimitMB = (planType: BasicPlan): number => {
  const planInfo = ALL_PLANS[planType]
  if (!planInfo) return 0

  return parseVectorSpaceToMB(planInfo.vectorSpace)
}

const parseLimit = (limit: number) => {
  if (limit === 0) return NUM_INFINITE

  return limit
}

const parseRateLimit = (limit: number) => {
  if (limit === 0 || limit === -1) return NUM_INFINITE

  return limit
}

const normalizeResetDate = (resetDate?: number | null) => {
  if (typeof resetDate !== 'number' || resetDate <= 0) return null

  if (resetDate >= 1e12) return dayjs(resetDate)

  if (resetDate >= 1e9) return dayjs(resetDate * 1000)

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
  if (!resetDay) return null

  const diff = resetDay.startOf('day').diff(dayjs().startOf('day'), 'day')
  if (Number.isNaN(diff) || diff < 0) return null

  return diff
}

const isBasicPlan = (plan: string): plan is BasicPlan => {
  return plan === Plan.sandbox || plan === Plan.professional || plan === Plan.team
}

const isPlan = (plan: string): plan is Plan => {
  return isBasicPlan(plan) || plan === Plan.enterprise
}

export const parseCurrentPlan = (data: FeatureResponse) => {
  const planType = isPlan(data.billing.subscription.plan)
    ? data.billing.subscription.plan
    : Plan.sandbox
  const planPreset = isBasicPlan(planType) ? ALL_PLANS[planType] : undefined
  const vectorSpaceLimit = isBasicPlan(planType) ? getPlanVectorSpaceLimitMB(planType) : 0
  const resolveRateLimit = (limit?: number, fallback?: number) => {
    const value = limit ?? fallback ?? 0
    return parseRateLimit(value)
  }
  const getQuotaUsage = (quota?: Quota) => quota?.usage ?? 0
  const getQuotaResetInDays = (quota?: Quota) => {
    if (!quota) return null
    return getResetInDaysFromDate(quota.reset_date)
  }

  return {
    type: planType,
    usage: {
      vectorSpace: 0,
      buildApps: data.apps.size,
      teamMembers: data.members.size,
      annotatedResponse: data.annotation_quota_limit.size,
      documentsUploadQuota: data.documents_upload_quota.size,
      apiRateLimit: getQuotaUsage(data.api_rate_limit),
      triggerEvents: getQuotaUsage(data.trigger_event),
    },
    total: {
      vectorSpace: vectorSpaceLimit,
      buildApps: parseLimit(data.apps.limit),
      teamMembers: parseLimit(data.members.limit),
      annotatedResponse: parseLimit(data.annotation_quota_limit.limit),
      documentsUploadQuota: parseLimit(data.documents_upload_quota.limit),
      apiRateLimit: resolveRateLimit(
        data.api_rate_limit.limit,
        planPreset?.apiRateLimit ?? NUM_INFINITE,
      ),
      triggerEvents: resolveRateLimit(data.trigger_event.limit, planPreset?.triggerEvents),
    },
    reset: {
      apiRateLimit: getQuotaResetInDays(data.api_rate_limit),
      triggerEvents: getQuotaResetInDays(data.trigger_event),
    },
  }
}
