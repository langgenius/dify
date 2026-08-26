'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

export const CLOUD_SANDBOX_TIME_PERIOD_KEYS = new Set(['1', '2', '3'])
export const CLOUD_SANDBOX_CLEARED_TIME_PERIOD = '1'

const CLOUD_SANDBOX_LONGEST_TIME_PERIOD = '3'
const CLOUD_SANDBOX_LONGEST_TIME_PERIOD_OPTION = {
  value: 30,
  name: 'last30days',
} as const

export type CloudSandboxPlanState = 'pending' | 'sandbox' | 'unrestricted'

export function isLogTimePeriodRestricted(planState: CloudSandboxPlanState) {
  return planState !== 'unrestricted'
}

export function resolveLogTimePeriod(period: string, planState: CloudSandboxPlanState) {
  if (!isLogTimePeriodRestricted(planState) || CLOUD_SANDBOX_TIME_PERIOD_KEYS.has(period))
    return period

  return CLOUD_SANDBOX_CLEARED_TIME_PERIOD
}

export function resolveLogTimePeriodOption<T extends { value: number; name: string }>(
  period: string,
  option: T,
  planState: CloudSandboxPlanState,
) {
  if (isLogTimePeriodRestricted(planState) && period === CLOUD_SANDBOX_LONGEST_TIME_PERIOD)
    return CLOUD_SANDBOX_LONGEST_TIME_PERIOD_OPTION

  return option
}

export function useCloudSandboxPlanStatus(): CloudSandboxPlanState {
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const { enableBilling, isFetchedPlan, isFetchedPlanInfo, plan } = useProviderContext()

  if (deploymentEdition !== 'CLOUD') return 'unrestricted'
  if (!isFetchedPlanInfo) return 'pending'
  if (!enableBilling) return 'unrestricted'
  if (!isFetchedPlan) return 'pending'

  return plan.type === 'sandbox' ? 'sandbox' : 'unrestricted'
}
