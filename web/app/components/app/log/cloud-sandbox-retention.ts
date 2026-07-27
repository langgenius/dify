'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
import { Plan } from '@/app/components/billing/type'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

export const CLOUD_SANDBOX_TIME_PERIOD_KEYS = new Set(['1', '2', '3'])
export const CLOUD_SANDBOX_CLEARED_TIME_PERIOD = '1'

export function useIsCloudSandboxPlan() {
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const { enableBilling, isFetchedPlan, plan } = useProviderContext()

  return (
    deploymentEdition === 'CLOUD' && enableBilling && isFetchedPlan && plan.type === Plan.sandbox
  )
}
