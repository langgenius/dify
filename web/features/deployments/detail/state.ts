'use client'

import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithMutation, atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../route-state'
import { deploymentStatusPollingInterval } from '../shared/domain/runtime-status'

export const deploymentSourceAppIdAtom = atom<string | undefined>(undefined)

export const deploymentDetailAppInstanceQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)

  return consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
        }
      : skipToken,
    enabled: Boolean(appInstanceId),
  })
})

export const deploymentDetailOverviewQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)

  return consoleQuery.enterprise.appInstanceService.getAppInstanceOverview.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
        }
      : skipToken,
    enabled: Boolean(appInstanceId),
  })
})

export const deploymentEnvironmentDeploymentsQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)

  return consoleQuery.enterprise.deploymentService.listEnvironmentDeployments.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
        }
      : skipToken,
    enabled: Boolean(appInstanceId),
    refetchInterval: query => deploymentStatusPollingInterval(query.state.data?.environmentDeployments),
  })
})

export const deploymentSourceAppQueryAtom = atomWithQuery((get) => {
  const sourceAppId = get(deploymentSourceAppIdAtom)

  return consoleQuery.apps.byAppId.get.queryOptions({
    input: sourceAppId
      ? { params: { app_id: sourceAppId } }
      : skipToken,
    enabled: Boolean(sourceAppId),
  })
})

export function createUndeployDeploymentMutationAtom() {
  return atomWithMutation(() =>
    consoleQuery.enterprise.deploymentService.undeploy.mutationOptions(),
  )
}
