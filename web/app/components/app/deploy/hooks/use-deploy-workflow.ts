'use client'

import type { DeployWorkflowResponse } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function useDeployWorkflow({
  appId,
  invalidateAppEnvironmentsOnSuccess = true,
  onSuccess,
}: {
  appId?: string
  invalidateAppEnvironmentsOnSuccess?: boolean
  onSuccess?: (response: DeployWorkflowResponse) => Promise<void> | void
}) {
  const queryClient = useQueryClient()
  return useMutation(
    consoleQuery.enterprise.appDeploy.deploymentService.deployWorkflow.mutationOptions({
      // The embedded deployment flow refreshes the environments once the deployment finishes.
      ...(invalidateAppEnvironmentsOnSuccess ? {} : { meta: { invalidate: false } }),
      onSuccess: async (response) => {
        if (!appId) return

        if (invalidateAppEnvironmentsOnSuccess) {
          const appEnvironmentsQuery =
            consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
              input: {
                params: {
                  app_id: appId,
                },
              },
            })
          await queryClient.invalidateQueries({ queryKey: appEnvironmentsQuery.queryKey })
        }

        await onSuccess?.(response)
      },
    }),
  )
}
