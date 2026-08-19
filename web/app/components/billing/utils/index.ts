import type { CloudPlan, GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import dayjs from 'dayjs'
import { ALL_PLANS, NUM_INFINITE } from '@/app/components/billing/config'

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
export const getPlanVectorSpaceLimitMB = (planType: CloudPlan): number => {
  return parseVectorSpaceToMB(ALL_PLANS[planType].vectorSpace)
}

const parseLimit = (limit: number) => {
  if (limit === 0) return NUM_INFINITE

  return limit
}

const parseRateLimit = (limit: number) => {
  if (limit === 0 || limit === -1) return NUM_INFINITE

  return limit
}

const normalizeResetDate = (resetDate: number) => {
  if (resetDate <= 0) return null

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

const getResetInDaysFromDate = (resetDate: number) => {
  const resetDay = normalizeResetDate(resetDate)
  if (!resetDay) return null

  const diff = resetDay.startOf('day').diff(dayjs().startOf('day'), 'day')
  if (Number.isNaN(diff) || diff < 0) return null

  return diff
}

export const parseCurrentPlan = (data: GetFeaturesResponse) => {
  const planType = data.billing.subscription.plan
  const vectorSpaceLimit = getPlanVectorSpaceLimitMB(planType)

  return {
    type: planType,
    usage: {
      vectorSpace: 0,
      buildApps: data.apps.size,
      teamMembers: data.members.size,
      annotatedResponse: data.annotation_quota_limit.size,
      documentsUploadQuota: data.documents_upload_quota.size,
      apiRateLimit: data.api_rate_limit.usage,
      triggerEvents: data.trigger_event.usage,
    },
    total: {
      vectorSpace: vectorSpaceLimit,
      buildApps: parseLimit(data.apps.limit),
      teamMembers: parseLimit(data.members.limit),
      annotatedResponse: parseLimit(data.annotation_quota_limit.limit),
      documentsUploadQuota: parseLimit(data.documents_upload_quota.limit),
      apiRateLimit: parseRateLimit(data.api_rate_limit.limit),
      triggerEvents: parseRateLimit(data.trigger_event.limit),
    },
    reset: {
      apiRateLimit: getResetInDaysFromDate(data.api_rate_limit.reset_date),
      triggerEvents: getResetInDaysFromDate(data.trigger_event.reset_date),
    },
  }
}
