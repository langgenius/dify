'use client'

import type { DeployWorkflowResponse } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

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
  const mutationOptions =
    consoleQuery.enterprise.appDeploy.deploymentService.deployWorkflow.mutationOptions()

  return useMutation({
    ...mutationOptions,
    onSuccess: async (response, variables, onMutateResult, context) => {
      await mutationOptions.onSuccess?.(response, variables, onMutateResult, context)
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
  })
}
