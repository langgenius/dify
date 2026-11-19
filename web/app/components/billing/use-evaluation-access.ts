'use client'

import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

/**
 * Evaluation availability for the current workspace, as decided by `/features`.
 *
 * `isVisible` covers workspaces that can use Evaluation or upgrade into it, and
 * `requiresUpgrade` marks the upgrade case. Everything stays false until features load,
 * so entries do not flash while the page guard keeps blocking the route.
 */
export const useEvaluationAccess = () => {
  const { data, isSuccess } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => ({
        canAccess: features.evaluation_enabled,
        requiresUpgrade: features.evaluation_upgrade_available,
      }),
    }),
  )
  const canAccess = data?.canAccess ?? false
  const requiresUpgrade = data?.requiresUpgrade ?? false

  return {
    isReady: isSuccess,
    canAccess,
    requiresUpgrade,
    isVisible: canAccess || requiresUpgrade,
  }
}
