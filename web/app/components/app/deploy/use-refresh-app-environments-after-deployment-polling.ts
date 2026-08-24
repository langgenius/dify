'use client'

import type { ListEnvironmentDeploymentsResponse } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { hashKey, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { consoleQuery } from '@/service/client'
import { hasInProgressEnvironmentDeployments } from './state'

export function useRefreshAppEnvironmentsAfterDeploymentPolling(appId: string) {
  const queryClient = useQueryClient()

  useEffect(() => {
    const appEnvironmentsQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
        input: {
          params: {
            app_id: appId,
          },
        },
      })
    const environmentDeploymentsQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions({
        input: {
          params: {
            app_id: appId,
          },
        },
      })
    const environmentDeploymentsQueryHash = hashKey(environmentDeploymentsQuery.queryKey)
    const isPolling = () => {
      const data = queryClient.getQueryData<ListEnvironmentDeploymentsResponse>(
        environmentDeploymentsQuery.queryKey,
      )

      return hasInProgressEnvironmentDeployments(data?.environment_deployments ?? [])
    }
    let wasPolling = isPolling()

    return queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type !== 'updated' ||
        event.action.type !== 'success' ||
        event.query.queryHash !== environmentDeploymentsQueryHash
      )
        return

      const isCurrentlyPolling = isPolling()
      if (wasPolling && !isCurrentlyPolling) {
        void queryClient.invalidateQueries({ queryKey: appEnvironmentsQuery.queryKey })
      }
      wasPolling = isCurrentlyPolling
    })
  }, [appId, queryClient])
}
