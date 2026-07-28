'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
import { Plan } from '@/app/components/billing/type'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

export const CLOUD_SANDBOX_TIME_PERIOD_KEYS = new Set(['1', '2', '3'])
export const CLOUD_SANDBOX_CLEARED_TIME_PERIOD = '1'

export type CloudSandboxPlanState = 'pending' | 'sandbox' | 'unrestricted'

export function isLogTimePeriodRestricted(planState: CloudSandboxPlanState) {
  return planState !== 'unrestricted'
}

export function resolveLogTimePeriod(period: string, planState: CloudSandboxPlanState) {
  if (!isLogTimePeriodRestricted(planState) || CLOUD_SANDBOX_TIME_PERIOD_KEYS.has(period))
    return period

  return CLOUD_SANDBOX_CLEARED_TIME_PERIOD
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

  return plan.type === Plan.sandbox ? 'sandbox' : 'unrestricted'
}
