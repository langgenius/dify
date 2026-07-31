'use client'

import type { DeployWorkflowResponse } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

export function useDeployWorkflow({
  appId,
  environmentId,
  invalidateAppEnvironmentsOnSuccess = true,
  onSuccess,
}: {
  appId?: string
  environmentId: string
  invalidateAppEnvironmentsOnSuccess?: boolean
  onSuccess?: (response: DeployWorkflowResponse) => Promise<void> | void
}) {
  const queryClient = useQueryClient()

  return useMutation(
    consoleQuery.enterprise.appDeploy.deploymentService.deployWorkflow.mutationOptions({
      context: { silent: true },
      onSuccess: async (response) => {
        if (!appId) return

        const appEnvironmentsQuery =
          consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
            input: {
              params: {
                app_id: appId,
              },
            },
          })
        const environmentDeploymentsQuery =
          consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions(
            {
              input: {
                params: {
                  app_id: appId,
                },
              },
            },
          )
        const environmentDeploymentQuery =
          consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryOptions(
            {
              input: {
                params: {
                  app_id: appId,
                  environment_id: environmentId,
                },
              },
            },
          )

        const invalidations = [
          queryClient.invalidateQueries({ queryKey: environmentDeploymentsQuery.queryKey }),
          queryClient.invalidateQueries({ queryKey: environmentDeploymentQuery.queryKey }),
        ]
        if (invalidateAppEnvironmentsOnSuccess)
          invalidations.push(
            queryClient.invalidateQueries({ queryKey: appEnvironmentsQuery.queryKey }),
          )

        await Promise.all(invalidations)
        await onSuccess?.(response)
      },
    }),
  )
}
