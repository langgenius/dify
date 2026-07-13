'use client'

import { skipToken } from '@tanstack/react-query'
import { atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../../route-state'

export const deploymentOverviewQueryAtom = atomWithQuery((get) => {
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

export const deploymentOverviewAtom = selectAtom(deploymentOverviewQueryAtom, (query) => query.data)
export const deploymentOverviewIsLoadingAtom = selectAtom(
  deploymentOverviewQueryAtom,
  (query) => query.isLoading,
)
export const deploymentOverviewIsErrorAtom = selectAtom(
  deploymentOverviewQueryAtom,
  (query) => query.isError,
)
