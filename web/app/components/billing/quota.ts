import type {
  CloudPlan,
  LimitationModel,
  Quota,
  VectorSpaceLimitationModel,
} from '@dify/contracts/api/console/features/types.gen'
import dayjs from 'dayjs'
import { getDaysUntilEndOfMonth } from '@/utils/time'

export type BillingQuota = {
  usage: number
  limit: number | 'unlimited'
  resetInDays?: number
}

// Next reset as a Unix timestamp in seconds; -1 means no reset.
const getResetInDays = (resetDate: number) => {
  if (resetDate <= 0) return undefined

  const diff = dayjs.unix(resetDate).startOf('day').diff(dayjs().startOf('day'), 'day')
  return diff >= 0 ? diff : undefined
}

// Apps, members, document uploads and annotations use 0 for unlimited.
export const getCountQuota = ({ size, limit }: LimitationModel): BillingQuota => ({
  usage: size,
  limit: limit === 0 ? 'unlimited' : limit,
})

export const getVectorSpaceQuota = ({ size, limit }: VectorSpaceLimitationModel): BillingQuota => ({
  usage: size,
  limit: limit === -1 ? 'unlimited' : limit,
})

// Trigger events and App Runs use -1 for unlimited; 0 is zero capacity.
const getPeriodicQuota = ({ usage, limit }: Quota) => ({
  usage,
  limit: limit < 0 ? ('unlimited' as const) : limit,
})

// Only the Professional trigger event quota renews with the subscription period.
export const getTriggerEventsQuota = (quota: Quota, plan: CloudPlan): BillingQuota => {
  const periodicQuota = getPeriodicQuota(quota)
  if (periodicQuota.limit === 'unlimited' || plan !== 'professional') return periodicQuota

  return { ...periodicQuota, resetInDays: getResetInDays(quota.reset_date) }
}

// Billing counts every app run against `api_rate_limit`; the Sandbox quota renews monthly.
export const getAppRunsQuota = (quota: Quota, plan: CloudPlan): BillingQuota => {
  const periodicQuota = getPeriodicQuota(quota)
  if (periodicQuota.limit === 'unlimited') return periodicQuota

  return {
    ...periodicQuota,
    resetInDays:
      getResetInDays(quota.reset_date) ??
      (plan === 'sandbox' ? getDaysUntilEndOfMonth() : undefined),
  }
}
