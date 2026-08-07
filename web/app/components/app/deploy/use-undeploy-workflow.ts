'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleQuery } from '@/service/client'

export function useUndeployWorkflow(appId: string) {
  const { mutateAsync } = useMutation(
    consoleQuery.enterprise.appDeploy.deploymentService.undeployWorkflow.mutationOptions(),
  )

  return useCallback(
    (deployment: EnvironmentDeployment) => {
      const workflowId = deployment.deployment?.current_version?.id
      if (!workflowId) return

      return mutateAsync({
        params: {
          app_id: appId,
          environment_id: deployment.environment.id,
          workflow_id: workflowId,
        },
      }).then(() => undefined)
    },
    [appId, mutateAsync],
  )
}
