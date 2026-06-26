'use client'

import { skipToken } from '@tanstack/react-query'
import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../../route-state'

export const accessSettingsQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)

  return consoleQuery.enterprise.accessService.getAccessSettings.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
        }
      : skipToken,
    enabled: Boolean(appInstanceId),
  })
})

export const developerApiSettingsQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)

  return consoleQuery.enterprise.accessService.getDeveloperApiSettings.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
        }
      : skipToken,
    enabled: Boolean(appInstanceId),
  })
})
