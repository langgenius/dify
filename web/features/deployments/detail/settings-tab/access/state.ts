'use client'

import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { deploymentDetailAppInstanceIdAtom } from '../../state'

export const accessSettingsQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentDetailAppInstanceIdAtom)

  return consoleQuery.enterprise.accessService.getAccessSettings.queryOptions({
    input: {
      params: { appInstanceId },
    },
    enabled: Boolean(appInstanceId),
  })
})

export const developerApiSettingsQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentDetailAppInstanceIdAtom)

  return consoleQuery.enterprise.accessService.getDeveloperApiSettings.queryOptions({
    input: {
      params: { appInstanceId },
    },
    enabled: Boolean(appInstanceId),
  })
})
