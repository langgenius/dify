'use client'

import type { ReactNode } from 'react'
import { DeploymentOperationStatus } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom, useHydrateAtoms } from 'jotai/utils'
import { isEnvironmentDeploymentInProgress } from '@/app/components/app/deploy/state'
import { consoleQuery } from '@/service/client'

export const BUILT_IN_ENVIRONMENT_ID = 'built-in'
const PUBLISHER_DEPLOYMENT_POLLING_INTERVAL = 3000

export type PublisherEnvironmentDeploymentPolling = {
  environmentId: string
  operationId: string
}

const appPublisherAppIdAtom = atom<string | null>(null)
const appPublisherEnvironmentQueryEnabledAtom = atom(false)
const appPublisherOpenStateAtom = atom(false)
const selectedEnvironmentByAppIdAtom = atom<Record<string, string>>({})
const locallyJoinedEnvironmentIdsByAppIdAtom = atom<Record<string, string[]>>({})
const environmentDeploymentPollingByAppIdAtom = atom<
  Record<string, PublisherEnvironmentDeploymentPolling>
>({})

const clearPublisherEnvironmentDeploymentPollingAtom = atom(null, (get, set) => {
  const appId = get(appPublisherAppIdAtom)
  if (!appId) return

  set(environmentDeploymentPollingByAppIdAtom, (current) => {
    if (!current[appId]) return current

    const next = { ...current }
    delete next[appId]
    return next
  })
})

export const appPublisherOpenAtom = atom(
  (get) => get(appPublisherOpenStateAtom),
  (get, set, open: boolean) => {
    const isReopening = open && !get(appPublisherOpenStateAtom)
    if (isReopening && get(appPublisherEnvironmentQueryEnabledAtom)) {
      const appId = get(appPublisherAppIdAtom)
      const selectedEnvironmentId = appId
        ? (get(selectedEnvironmentByAppIdAtom)[appId] ?? BUILT_IN_ENVIRONMENT_ID)
        : BUILT_IN_ENVIRONMENT_ID

      if (appId && selectedEnvironmentId !== BUILT_IN_ENVIRONMENT_ID) {
        set(clearPublisherEnvironmentDeploymentPollingAtom)
        set(selectedEnvironmentByAppIdAtom, (current) => ({
          ...current,
          [appId]: BUILT_IN_ENVIRONMENT_ID,
        }))
      }
    }

    set(appPublisherOpenStateAtom, open)
    if (!open) set(clearPublisherEnvironmentDeploymentPollingAtom)
  },
)

appPublisherOpenAtom.onMount = (setOpen) => () => {
  setOpen(false)
}

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

export const selectedPublisherEnvironmentIdAtom = atom(
  (get) => {
    const appId = get(appPublisherAppIdAtom)
    if (!appId) return BUILT_IN_ENVIRONMENT_ID

    return get(selectedEnvironmentByAppIdAtom)[appId] ?? BUILT_IN_ENVIRONMENT_ID
  },
  (get, set, environmentId: string) => {
    const appId = get(appPublisherAppIdAtom)
    if (!appId) return
    if (get(selectedPublisherEnvironmentIdAtom) === environmentId) return

    set(clearPublisherEnvironmentDeploymentPollingAtom)
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

export const publisherEnvironmentDeploymentPollingAtom = atom((get) => {
  const appId = get(appPublisherAppIdAtom)
  if (!appId) return

  return get(environmentDeploymentPollingByAppIdAtom)[appId]
})

export const startPublisherEnvironmentDeploymentPollingAtom = atom(
  null,
  (get, set, polling: PublisherEnvironmentDeploymentPolling) => {
    const appId = get(appPublisherAppIdAtom)
    if (!appId) return

    set(environmentDeploymentPollingByAppIdAtom, (current) => ({
      ...current,
      [appId]: polling,
    }))
  },
)

export const finishPublisherEnvironmentDeploymentPollingAtom = atom(
  null,
  (get, set, polling: PublisherEnvironmentDeploymentPolling) => {
    const appId = get(appPublisherAppIdAtom)
    if (!appId) return

    set(environmentDeploymentPollingByAppIdAtom, (current) => {
      const activePolling = current[appId]
      if (
        activePolling?.environmentId !== polling.environmentId ||
        activePolling.operationId !== polling.operationId
      )
        return current

      const next = { ...current }
      delete next[appId]
      return next
    })
  },
)

export function isDeploymentOperationTerminal(status?: DeploymentOperationStatus) {
  return (
    status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED ||
    status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED
  )
}

const selectedEnvironmentDeploymentDiscoveryEnabledAtom = atom((get) => {
  const appId = get(appPublisherAppIdAtom)
  const enabled = get(appPublisherEnvironmentQueryEnabledAtom)
  const open = get(appPublisherOpenAtom)
  const environmentId = get(selectedPublisherEnvironmentIdAtom)
  const selectedEnvironment = get(selectedPublisherEnvironmentAtom)
  const polling = get(publisherEnvironmentDeploymentPollingAtom)

  return (
    enabled &&
    open &&
    Boolean(appId) &&
    environmentId !== BUILT_IN_ENVIRONMENT_ID &&
    selectedEnvironment?.in_use === false &&
    polling?.environmentId !== environmentId
  )
})

const selectedEnvironmentDeploymentsDiscoveryQueryAtom = atomWithQuery((get) => {
  const appId = get(appPublisherAppIdAtom)
  const discoveryEnabled = get(selectedEnvironmentDeploymentDiscoveryEnabledAtom)

  return consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions(
    {
      input:
        discoveryEnabled && appId
          ? {
              params: {
                app_id: appId,
              },
            }
          : skipToken,
      enabled: discoveryEnabled,
      staleTime: 0,
    },
  )
})

const selectedEnvironmentDeploymentsDiscoveryDataAtom = selectAtom(
  selectedEnvironmentDeploymentsDiscoveryQueryAtom,
  (query) => query.data?.environment_deployments,
)

const selectedEnvironmentDeploymentsDiscoveryIsLoadingAtom = selectAtom(
  selectedEnvironmentDeploymentsDiscoveryQueryAtom,
  (query) => query.isLoading,
)

const selectedEnvironmentDeploymentsDiscoveryIsErrorAtom = selectAtom(
  selectedEnvironmentDeploymentsDiscoveryQueryAtom,
  (query) => query.isError,
)

const selectedEnvironmentHasDeploymentAtom = atom((get) => {
  const environmentId = get(selectedPublisherEnvironmentIdAtom)

  return Boolean(
    get(selectedEnvironmentDeploymentsDiscoveryDataAtom)?.some(
      (deployment) => deployment.environment.id === environmentId,
    ),
  )
})

const selectedEnvironmentDeploymentQueryAtom = atomWithQuery((get) => {
  const appId = get(appPublisherAppIdAtom)
  const enabled = get(appPublisherEnvironmentQueryEnabledAtom)
  const open = get(appPublisherOpenAtom)
  const environmentId = get(selectedPublisherEnvironmentIdAtom)
  const selectedEnvironment = get(selectedPublisherEnvironmentAtom)
  const polling = get(publisherEnvironmentDeploymentPollingAtom)
  const shouldFetch =
    enabled &&
    open &&
    Boolean(appId) &&
    environmentId !== BUILT_IN_ENVIRONMENT_ID &&
    (selectedEnvironment?.in_use === true ||
      polling?.environmentId === environmentId ||
      get(selectedEnvironmentHasDeploymentAtom))

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
    refetchInterval: (query) => {
      if (query.state.status === 'error' || query.state.fetchFailureCount > 0) return false

      const deployment = query.state.data?.environment_deployment
      if (polling?.environmentId !== environmentId)
        return isEnvironmentDeploymentInProgress(deployment)
          ? PUBLISHER_DEPLOYMENT_POLLING_INTERVAL
          : false

      const operation = deployment?.deployment?.latest_operation
      const operationFinished =
        operation?.id === polling.operationId && isDeploymentOperationTerminal(operation.status)

      return operationFinished && !isEnvironmentDeploymentInProgress(deployment)
        ? false
        : PUBLISHER_DEPLOYMENT_POLLING_INTERVAL
    },
    staleTime: 0,
  })
})

const selectedEnvironmentDeploymentDataAtom = selectAtom(
  selectedEnvironmentDeploymentQueryAtom,
  (query) => query.data?.environment_deployment,
)

const selectedEnvironmentDeploymentQueryIsLoadingAtom = selectAtom(
  selectedEnvironmentDeploymentQueryAtom,
  (query) => query.isLoading,
)

const selectedEnvironmentDeploymentQueryIsErrorAtom = selectAtom(
  selectedEnvironmentDeploymentQueryAtom,
  (query) => query.isError,
)

export const selectedEnvironmentDeploymentAtom = selectedEnvironmentDeploymentDataAtom
export const selectedEnvironmentDeploymentIsLoadingAtom = atom(
  (get) =>
    get(selectedEnvironmentDeploymentQueryIsLoadingAtom) ||
    (get(selectedEnvironmentDeploymentDiscoveryEnabledAtom) &&
      get(selectedEnvironmentDeploymentsDiscoveryIsLoadingAtom)),
)
export const selectedEnvironmentDeploymentIsErrorAtom = atom(
  (get) =>
    get(selectedEnvironmentDeploymentQueryIsErrorAtom) ||
    (get(selectedEnvironmentDeploymentDiscoveryEnabledAtom) &&
      get(selectedEnvironmentDeploymentsDiscoveryIsErrorAtom)),
)
