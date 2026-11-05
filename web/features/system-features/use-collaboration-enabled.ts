import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { systemFeaturesQueryOptions } from './client'

export const useWorkspaceCollaborationEnabled = () => {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const needsPlan =
    systemFeatures.enable_collaboration_mode && systemFeatures.deployment_edition === 'CLOUD'
  const [features] = useSuspenseQueries<{ queryFnData: GetFeaturesResponse }[]>({
    queries: needsPlan ? [consoleQuery.features.get.queryOptions()] : [],
  })

  if (!systemFeatures.enable_collaboration_mode) return false
  if (!needsPlan) return true

  const plan = features?.data.billing.subscription.plan
  return plan === 'professional' || plan === 'team'
}
