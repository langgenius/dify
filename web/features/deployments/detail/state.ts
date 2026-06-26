'use client'

import { skipToken } from '@tanstack/react-query'
import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../route-state'
import { deploymentStatusPollingInterval } from '../shared/domain/runtime-status'

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
