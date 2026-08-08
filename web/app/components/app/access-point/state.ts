'use client'

import type { ReactNode } from 'react'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom, useHydrateAtoms } from 'jotai/utils'
import { consoleQuery } from '@/service/client'

export const BUILT_IN_ENVIRONMENT_ID = 'built-in'

const accessPointAppIdAtom = atom<string | null>(null)
const environmentQueryEnabledAtom = atom(false)

export function AccessPointStateBoundary({
  appId,
  children,
  environmentQueryEnabled,
}: {
  appId: string
  children: ReactNode
  environmentQueryEnabled: boolean
}) {
  useHydrateAtoms(
    [
      [accessPointAppIdAtom, appId],
      [environmentQueryEnabledAtom, environmentQueryEnabled],
    ] as const,
    {
      dangerouslyForceHydrate: true,
    },
  )

  return children
}

const appEnvironmentsQueryAtom = atomWithQuery((get) => {
  const appId = get(accessPointAppIdAtom)
  const enabled = get(environmentQueryEnabledAtom)

  return consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
    input: appId
      ? {
          params: {
            app_id: appId,
          },
        }
      : skipToken,
    enabled,
  })
})

const appEnvironmentsAtom = selectAtom(appEnvironmentsQueryAtom, (query) => query.data?.data)

export const inUseAppEnvironmentsAtom = atom(
  (get) =>
    get(appEnvironmentsAtom)?.filter(
      (environment) => environment.in_use && environment.id !== BUILT_IN_ENVIRONMENT_ID,
    ) ?? [],
)
