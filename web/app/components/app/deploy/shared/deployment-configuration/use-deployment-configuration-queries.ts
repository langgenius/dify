'use client'

import { skipToken, useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function useDeploymentConfigurationQueries({
  appId,
  environmentId,
  workflowId,
}: {
  appId?: string
  environmentId: string
  workflowId: string
}) {
  const precheckQueryOptions =
    consoleQuery.enterprise.appDeploy.deploymentService.precheckWorkflowDeployment.queryOptions({
      input: appId
        ? {
            params: {
              app_id: appId,
              workflow_id: workflowId,
            },
          }
        : skipToken,
      retry: false,
      // The dialog shows every failed precheck, refetches included, in place of the result.
      meta: { errorToast: false },
    })
  const precheckQuery = useQuery(precheckQueryOptions)
  const precheck = precheckQuery.data
  const precheckPassed =
    precheckQuery.isSuccess && !precheckQuery.isFetching && precheck?.unsupported_nodes.length === 0

  const deploymentOptionsQueryOptions =
    consoleQuery.enterprise.appDeploy.deploymentService.getWorkflowDeploymentOptions.queryOptions({
      input: appId
        ? {
            params: {
              app_id: appId,
              environment_id: environmentId,
              workflow_id: workflowId,
            },
          }
        : skipToken,
      enabled: precheckPassed,
      retry: false,
      // The dialog shows every failed load, refetches included, in place of the options.
      meta: { errorToast: false },
    })
  const deploymentOptionsQuery = useQuery(deploymentOptionsQueryOptions)

  const isPrechecking = Boolean(appId) && (precheckQuery.isLoading || precheckQuery.isFetching)
  const isLoadingDeploymentOptions =
    precheckPassed && (deploymentOptionsQuery.isLoading || deploymentOptionsQuery.isFetching)
  const isPrecheckBlocked =
    precheckQuery.isSuccess &&
    !precheckQuery.isFetching &&
    Boolean(precheck?.unsupported_nodes.length)
  const deploymentOptionsReady =
    precheckPassed && deploymentOptionsQuery.isSuccess && !deploymentOptionsQuery.isFetching

  return {
    canDeploy: deploymentOptionsReady,
    deploymentOptions: deploymentOptionsReady ? deploymentOptionsQuery.data : undefined,
    deploymentOptionsError: precheckPassed ? deploymentOptionsQuery.error : null,
    isLoadingDeploymentOptions,
    isPrecheckBlocked,
    isPrechecking,
    precheck,
    precheckError: precheckQuery.error,
  }
}

export type DeploymentConfigurationQueryState = ReturnType<typeof useDeploymentConfigurationQueries>
