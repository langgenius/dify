'use client'

import { skipToken } from '@tanstack/react-query'
import { atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../../route-state'

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

export const developerApiSettingsAtom = selectAtom(developerApiSettingsQueryAtom, query => query.data)
export const developerApiSettingsIsLoadingAtom = selectAtom(developerApiSettingsQueryAtom, query => query.isLoading)
export const developerApiSettingsIsErrorAtom = selectAtom(developerApiSettingsQueryAtom, query => query.isError)
