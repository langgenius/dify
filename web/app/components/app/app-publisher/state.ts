'use client'

import type { ReactNode } from 'react'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom, useHydrateAtoms } from 'jotai/utils'
import { consoleQuery } from '@/service/client'

export const BUILT_IN_ENVIRONMENT_ID = 'built-in'

const appPublisherAppIdAtom = atom<string | null>(null)
const appPublisherEnvironmentQueryEnabledAtom = atom(false)
const selectedEnvironmentByAppIdAtom = atom<Record<string, string>>({})
const locallyJoinedEnvironmentIdsByAppIdAtom = atom<Record<string, string[]>>({})

export function AppPublisherStateBoundary({
  appId,
  children,
  environmentQueryEnabled,
}: {
  appId?: string
  children: ReactNode
  environmentQueryEnabled: boolean
}) {
  useHydrateAtoms(
    [
      [appPublisherAppIdAtom, appId ?? null],
      [appPublisherEnvironmentQueryEnabledAtom, environmentQueryEnabled],
    ] as const,
    {
      dangerouslyForceHydrate: true,
    },
  )

  return children
}

const appPublisherEnvironmentsQueryAtom = atomWithQuery((get) => {
  const appId = get(appPublisherAppIdAtom)
  const enabled = get(appPublisherEnvironmentQueryEnabledAtom)

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

const appPublisherEnvironmentsDataAtom = selectAtom(
  appPublisherEnvironmentsQueryAtom,
  (query) => query.data?.data,
)

export const appPublisherEnvironmentsAtom = atom(
  (get) =>
    get(appPublisherEnvironmentsDataAtom)?.filter(
      (environment) => environment.id !== BUILT_IN_ENVIRONMENT_ID,
    ) ?? [],
)

export const appPublisherEnvironmentsIsLoadingAtom = selectAtom(
  appPublisherEnvironmentsQueryAtom,
  (query) => query.isLoading,
)

export const appPublisherEnvironmentsIsErrorAtom = selectAtom(
  appPublisherEnvironmentsQueryAtom,
  (query) => query.isError,
)

export const selectedPublisherEnvironmentIdAtom = atom(
  (get) => {
    const appId = get(appPublisherAppIdAtom)
    if (!appId) return BUILT_IN_ENVIRONMENT_ID

    return get(selectedEnvironmentByAppIdAtom)[appId] ?? BUILT_IN_ENVIRONMENT_ID
  },
  (get, set, environmentId: string) => {
    const appId = get(appPublisherAppIdAtom)
    if (!appId) return

    set(selectedEnvironmentByAppIdAtom, (current) => ({
      ...current,
      [appId]: environmentId,
    }))
  },
)

export const selectedPublisherEnvironmentAtom = atom((get) => {
  const environmentId = get(selectedPublisherEnvironmentIdAtom)

  return get(appPublisherEnvironmentsAtom).find((environment) => environment.id === environmentId)
})

export const joinedPublisherEnvironmentIdsAtom = atom((get) => {
  const appId = get(appPublisherAppIdAtom)
  const locallyJoinedEnvironmentIds = appId
    ? (get(locallyJoinedEnvironmentIdsByAppIdAtom)[appId] ?? [])
    : []
  const locallyJoinedEnvironmentIdSet = new Set(locallyJoinedEnvironmentIds)

  return get(appPublisherEnvironmentsAtom)
    .filter(
      (environment) => environment.in_use || locallyJoinedEnvironmentIdSet.has(environment.id),
    )
    .map((environment) => environment.id)
})

export const addPublisherEnvironmentAtom = atom(null, (get, set, environmentId: string) => {
  const appId = get(appPublisherAppIdAtom)
  if (!appId) return

  set(locallyJoinedEnvironmentIdsByAppIdAtom, (current) => {
    const joinedEnvironmentIds = current[appId] ?? []
    if (joinedEnvironmentIds.includes(environmentId)) return current

    return {
      ...current,
      [appId]: [...joinedEnvironmentIds, environmentId],
    }
  })
  set(selectedPublisherEnvironmentIdAtom, environmentId)
})

const selectedEnvironmentDeploymentQueryAtom = atomWithQuery((get) => {
  const appId = get(appPublisherAppIdAtom)
  const enabled = get(appPublisherEnvironmentQueryEnabledAtom)
  const environmentId = get(selectedPublisherEnvironmentIdAtom)
  const selectedEnvironment = get(selectedPublisherEnvironmentAtom)
  const shouldFetch =
    enabled &&
    Boolean(appId) &&
    environmentId !== BUILT_IN_ENVIRONMENT_ID &&
    selectedEnvironment?.in_use === true

  return consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryOptions({
    input:
      shouldFetch && appId
        ? {
            params: {
              app_id: appId,
              environment_id: environmentId,
            },
          }
        : skipToken,
    enabled: shouldFetch,
  })
})

export const selectedEnvironmentDeploymentAtom = selectAtom(
  selectedEnvironmentDeploymentQueryAtom,
  (query) => query.data?.environment_deployment,
)

export const selectedEnvironmentDeploymentIsLoadingAtom = selectAtom(
  selectedEnvironmentDeploymentQueryAtom,
  (query) => query.isLoading,
)

export const selectedEnvironmentDeploymentIsErrorAtom = selectAtom(
  selectedEnvironmentDeploymentQueryAtom,
  (query) => query.isError,
)
