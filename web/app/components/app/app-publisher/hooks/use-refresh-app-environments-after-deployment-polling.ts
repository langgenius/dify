'use client'

import { DeploymentOperationStatus } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'
import { isEnvironmentDeploymentInProgress } from '@/app/components/app/deploy/state'
import { consoleQuery } from '@/service/client'
import {
  appPublisherOpenAtom,
  finishPublisherEnvironmentDeploymentPollingAtom,
  isDeploymentOperationTerminal,
  publisherEnvironmentDeploymentPollingAtom,
  selectedEnvironmentDeploymentAtom,
  selectedPublisherEnvironmentAtom,
} from '../state'

export function useRefreshAppEnvironmentsAfterPublisherDeploymentPolling(appId?: string) {
  const queryClient = useQueryClient()
  const operationsNeedingEnvironmentRefreshRef = useRef(new Set<string>())
  const refreshedOperationKeysRef = useRef(new Set<string>())
  const open = useAtomValue(appPublisherOpenAtom)
  const polling = useAtomValue(publisherEnvironmentDeploymentPollingAtom)
  const environment = useAtomValue(selectedPublisherEnvironmentAtom)
  const deployment = useAtomValue(selectedEnvironmentDeploymentAtom)
  const finishPolling = useSetAtom(finishPublisherEnvironmentDeploymentPollingAtom)

  useEffect(() => {
    if (
      !appId ||
      !open ||
      !environment ||
      !deployment ||
      deployment.environment.id !== environment.id
    )
      return

    const operation = deployment?.deployment?.latest_operation
    const operationKey = operation ? `${appId}:${environment.id}:${operation.id}` : undefined
    if (polling) {
      const pollingOperationKey = `${appId}:${polling.environmentId}:${polling.operationId}`
      operationsNeedingEnvironmentRefreshRef.current.add(pollingOperationKey)
      if (
        polling.environmentId !== environment.id ||
        operation?.id !== polling.operationId ||
        !isDeploymentOperationTerminal(operation.status) ||
        isEnvironmentDeploymentInProgress(deployment)
      )
        return

      const finishCurrentPolling = () => finishPolling(polling)
      if (operation.status !== DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED) {
        operationsNeedingEnvironmentRefreshRef.current.delete(pollingOperationKey)
        finishCurrentPolling()
        return
      }
      operationsNeedingEnvironmentRefreshRef.current.delete(pollingOperationKey)
      refreshedOperationKeysRef.current.add(pollingOperationKey)

      const appEnvironmentsQuery =
        consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
          input: {
            params: {
              app_id: appId,
            },
          },
        })

      void queryClient
        .invalidateQueries({ queryKey: appEnvironmentsQuery.queryKey })
        .then(finishCurrentPolling, finishCurrentPolling)
      return
    }

    if (isEnvironmentDeploymentInProgress(deployment)) {
      if (operationKey) operationsNeedingEnvironmentRefreshRef.current.add(operationKey)
      return
    }

    if (
      operationKey &&
      operation?.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED &&
      operationsNeedingEnvironmentRefreshRef.current.has(operationKey) &&
      !refreshedOperationKeysRef.current.has(operationKey)
    ) {
      operationsNeedingEnvironmentRefreshRef.current.delete(operationKey)
      refreshedOperationKeysRef.current.add(operationKey)
      const appEnvironmentsQuery =
        consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
          input: {
            params: {
              app_id: appId,
            },
          },
        })

      void queryClient.invalidateQueries({ queryKey: appEnvironmentsQuery.queryKey })
      return
    }
    if (
      operationKey &&
      operation?.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED
    )
      operationsNeedingEnvironmentRefreshRef.current.delete(operationKey)

    const deploymentIsInUse = Boolean(deployment.deployment?.current_version)
    if (environment.in_use === deploymentIsInUse) return
    if (operationKey) refreshedOperationKeysRef.current.add(operationKey)

    const appEnvironmentsQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
        input: {
          params: {
            app_id: appId,
          },
        },
      })

    void queryClient.invalidateQueries({ queryKey: appEnvironmentsQuery.queryKey })
  }, [appId, deployment, environment, finishPolling, open, polling, queryClient])
}
