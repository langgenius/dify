'use client'

import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { deploymentStatusPollingInterval } from '../shared/domain/runtime-status'

export const deploymentDetailAppInstanceIdAtom = atom('')
export const deploymentSourceAppIdAtom = atom('')

export const deploymentDetailAppInstanceQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentDetailAppInstanceIdAtom)

  return consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: {
      params: { appInstanceId },
    },
    enabled: Boolean(appInstanceId),
  })
})

export const deploymentDetailOverviewQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentDetailAppInstanceIdAtom)

  return consoleQuery.enterprise.appInstanceService.getAppInstanceOverview.queryOptions({
    input: {
      params: { appInstanceId },
    },
    enabled: Boolean(appInstanceId),
  })
})

export const deploymentEnvironmentDeploymentsQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentDetailAppInstanceIdAtom)

  return consoleQuery.enterprise.deploymentService.listEnvironmentDeployments.queryOptions({
    input: {
      params: { appInstanceId },
    },
    enabled: Boolean(appInstanceId),
    refetchInterval: query => deploymentStatusPollingInterval(query.state.data?.environmentDeployments),
  })
})

export const deploymentSourceAppQueryAtom = atomWithQuery((get) => {
  const sourceAppId = get(deploymentSourceAppIdAtom)

  return consoleQuery.apps.byAppId.get.queryOptions({
    input: { params: { app_id: sourceAppId } },
    enabled: Boolean(sourceAppId),
  })
})
