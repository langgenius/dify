import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
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

// App, member, document upload, and annotation quotas use 0 for unlimited.
// Event and API quotas use -1 for unlimited and must preserve 0 as zero capacity.
export const parseLimit = (limit: number) => {
  if (limit === 0) return NUM_INFINITE

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

export const getResetInDaysFromDate = (resetDate: number) => {
  const resetDay = normalizeResetDate(resetDate)
  if (!resetDay) return null

  const diff = resetDay.startOf('day').diff(dayjs().startOf('day'), 'day')
  if (Number.isNaN(diff) || diff < 0) return null

  return diff
}
