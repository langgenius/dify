'use client'

import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { useQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { isEvaluationEdition } from '@/features/system-features/utils'

export const canAccessSnippetsAndEvaluation = ({
  deploymentEdition,
  planType,
}: {
  deploymentEdition: DeploymentEdition
  planType?: CloudPlan
}) => {
  if (!isEvaluationEdition(deploymentEdition)) return false
  if (deploymentEdition === 'ENTERPRISE') return true

  return planType === 'professional' || planType === 'team'
}

/**
 * Whether the workspace plan allows snippets and evaluation.
 *
 * `isReady` stays false until the edition (and, on Cloud, the plan) has loaded; until then
 * `canAccess` is false, so callers decide how to treat the loading state.
 */
export const useSnippetsAndEvaluationAccess = () => {
  const systemFeaturesQuery = useQuery(systemFeaturesQueryOptions())
  const deploymentEdition = systemFeaturesQuery.data?.deployment_edition
  const featuresQuery = useQuery({
    ...consoleQuery.features.get.queryOptions(),
    enabled: deploymentEdition === 'CLOUD',
  })
  const isReady =
    systemFeaturesQuery.isSuccess && (deploymentEdition !== 'CLOUD' || featuresQuery.isSuccess)
  const canAccess = deploymentEdition
    ? canAccessSnippetsAndEvaluation({
        deploymentEdition,
        planType: featuresQuery.data?.billing.subscription.plan,
      })
    : false

  return { isReady, canAccess }
}

/**
 * True only once the plan is known to exclude evaluation, so entries do not flash a
 * disabled state while the plan loads (the page guard still blocks the route meanwhile).
 */
export const useEvaluationRequiresUpgrade = () => {
  const { isReady, canAccess } = useSnippetsAndEvaluationAccess()
  return isReady && !canAccess
}
