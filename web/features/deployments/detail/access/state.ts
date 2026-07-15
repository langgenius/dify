'use client'

import { skipToken } from '@tanstack/react-query'
import { atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
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

export const accessSettingsAtom = selectAtom(accessSettingsQueryAtom, (query) => query.data)
export const accessSettingsIsLoadingAtom = selectAtom(
  accessSettingsQueryAtom,
  (query) => query.isLoading,
)
export const accessSettingsIsErrorAtom = selectAtom(
  accessSettingsQueryAtom,
  (query) => query.isError,
)
