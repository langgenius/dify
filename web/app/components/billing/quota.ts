import type {
  CloudPlan,
  LicenseLimitationModel,
  LimitationModel,
  Quota,
  VectorSpaceLimitationModel,
} from '@dify/contracts/api/console/features/types.gen'
import dayjs from 'dayjs'
import { getDaysUntilEndOfMonth } from '@/utils/time'

export type BillingQuota = {
  usage: number
  // null means unlimited; 0 means no capacity.
  limit: number | null
  resetInDays?: number
}

// Next reset as a Unix timestamp in seconds; -1 means no reset.
const getResetInDays = (resetDate: number) => {
  if (resetDate <= 0) return undefined

  const diff = dayjs.unix(resetDate).startOf('day').diff(dayjs().startOf('day'), 'day')
  return diff >= 0 ? diff : undefined
}

export const isQuotaReached = ({ usage, limit }: BillingQuota) => limit !== null && usage >= limit

export const getCountQuota = ({ size, limit }: LimitationModel): BillingQuota => ({
  usage: size,
  limit,
})

export const getVectorSpaceQuota = ({ size, limit }: VectorSpaceLimitationModel): BillingQuota => ({
  usage: size,
  limit,
})

// License limits still use 0 for unlimited.
export const getLicenseQuota = ({ size, limit }: LicenseLimitationModel): BillingQuota => ({
  usage: size,
  limit: limit === 0 ? null : limit,
})

// Only the Professional trigger event quota renews with the subscription period.
export const getTriggerEventsQuota = (
  { usage, limit, reset_date }: Quota,
  plan: CloudPlan,
): BillingQuota => {
  if (limit === null || plan !== 'professional') return { usage, limit }

  return { usage, limit, resetInDays: getResetInDays(reset_date) }
}

// Billing counts every app run against `api_rate_limit`; the Sandbox quota renews monthly.
export const getAppRunsQuota = (
  { usage, limit, reset_date }: Quota,
  plan: CloudPlan,
): BillingQuota => {
  if (limit === null) return { usage, limit }

  return {
    usage,
    limit,
    resetInDays:
      getResetInDays(reset_date) ?? (plan === 'sandbox' ? getDaysUntilEndOfMonth() : undefined),
  }
}
