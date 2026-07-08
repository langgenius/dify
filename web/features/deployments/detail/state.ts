'use client'

import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { nextPathnameAtom } from '@/app/components/next-route-state/atoms'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../route-state'
import {
  deploymentStatusPollingInterval,
  hasRuntimeInstanceDeployment,
} from '../shared/domain/runtime-status'
import { isInstanceDetailTabKey } from './tabs'

export const deploymentDetailActiveTabAtom = atom((get) => {
  const pathnameSegments = get(nextPathnameAtom).split('/').filter(Boolean)
  const deploymentsSegmentIndex = pathnameSegments.indexOf('deployments')
  const selectedSegment = deploymentsSegmentIndex >= 0
    ? pathnameSegments[deploymentsSegmentIndex + 2]
    : undefined

  return isInstanceDetailTabKey(selectedSegment) ? selectedSegment : 'overview'
})

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

export const deploymentDetailAppInstanceAtom = selectAtom(deploymentDetailAppInstanceQueryAtom, query => query.data)
export const deploymentDetailAppInstanceIsLoadingAtom = selectAtom(deploymentDetailAppInstanceQueryAtom, query => query.isLoading)
export const deploymentDetailAppInstanceIsErrorAtom = selectAtom(deploymentDetailAppInstanceQueryAtom, query => query.isError)

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

export const deploymentEnvironmentDeploymentsAtom = selectAtom(deploymentEnvironmentDeploymentsQueryAtom, query => query.data)
export const deploymentEnvironmentDeploymentsIsLoadingAtom = selectAtom(deploymentEnvironmentDeploymentsQueryAtom, query => query.isLoading)
export const deploymentEnvironmentDeploymentsIsErrorAtom = selectAtom(deploymentEnvironmentDeploymentsQueryAtom, query => query.isError)

export const deploymentRuntimeInstanceRowsAtom = atom((get) => {
  return get(deploymentEnvironmentDeploymentsAtom)?.environmentDeployments.filter(hasRuntimeInstanceDeployment) ?? []
})
