'use client'

import type { ReactNode } from 'react'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom, useHydrateAtoms } from 'jotai/utils'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import {
  appWorkflowQueryOptions,
  appWorkflowVersionsInfiniteQueryOptions,
} from '@/service/workflow-queries'
import { hasDeploymentsRequiringPolling } from './utils/environment-deployment'
import { toDeploymentVersion } from './utils/version'

const DEPLOYMENT_STATUS_POLLING_INTERVAL = 3000

const appDeployAppIdAtom = atom<string | null>(null)
const defaultWorkflowVersionNameAtom = atom('')

type DeploymentVersionSource = Parameters<typeof toDeploymentVersion>[0]
type DeploymentVersionCacheEntry = {
  defaultName: string
  latestWorkflowId?: string
  version: ReturnType<typeof toDeploymentVersion>
}

const deploymentVersionCache = new WeakMap<DeploymentVersionSource, DeploymentVersionCacheEntry>()

function toStableDeploymentVersion(
  source: DeploymentVersionSource,
  defaultName: string,
  latestWorkflowId?: string,
) {
  const cached = deploymentVersionCache.get(source)
  if (cached?.defaultName === defaultName && cached.latestWorkflowId === latestWorkflowId)
    return cached.version

  const version = toDeploymentVersion(source, defaultName, latestWorkflowId)
  deploymentVersionCache.set(source, {
    defaultName,
    latestWorkflowId,
    version,
  })

  return version
}

export function AppDeployStateBoundary({
  appId,
  children,
}: {
  appId: string
  children: ReactNode
}) {
  const { t } = useTranslation('workflow')

  useHydrateAtoms(
    [
      [appDeployAppIdAtom, appId],
      [defaultWorkflowVersionNameAtom, t(($) => $['versionHistory.defaultName'])],
    ] as const,
    {
      dangerouslyForceHydrate: true,
    },
  )

  return children
}

const latestPublishedWorkflowQueryAtom = atomWithQuery((get) => {
  return appWorkflowQueryOptions(get(appDeployAppIdAtom))
})

const latestPublishedWorkflowAtom = selectAtom(
  latestPublishedWorkflowQueryAtom,
  (query) => query.data,
)

export const latestAppWorkflowVersionAtom = atom((get) => {
  const workflow = get(latestPublishedWorkflowAtom)
  if (!workflow) return

  return toStableDeploymentVersion(workflow, get(defaultWorkflowVersionNameAtom), workflow.id)
})

export const latestAppWorkflowVersionIsErrorAtom = selectAtom(
  latestPublishedWorkflowQueryAtom,
  (query) => query.isError,
)

export const latestAppWorkflowVersionIsRetryingAtom = selectAtom(
  latestPublishedWorkflowQueryAtom,
  (query) => query.isError && query.isFetching,
)

export const latestAppWorkflowVersionRefetchAtom = selectAtom(
  latestPublishedWorkflowQueryAtom,
  (query) => query.refetch,
)

const appWorkflowVersionsQueryAtom = atomWithInfiniteQuery((get) => {
  return appWorkflowVersionsInfiniteQueryOptions(get(appDeployAppIdAtom))
})

const appWorkflowVersionsDataAtom = selectAtom(appWorkflowVersionsQueryAtom, (query) => query.data)

export const appWorkflowVersionsAtom = atom((get) => {
  const latestWorkflowId = get(latestPublishedWorkflowAtom)?.id
  const defaultName = get(defaultWorkflowVersionNameAtom)
  const pages = get(appWorkflowVersionsDataAtom)?.pages ?? []

  return pages.flatMap((page) =>
    page.items
      .filter((workflow) => workflow.version !== 'draft')
      .map((workflow) => toStableDeploymentVersion(workflow, defaultName, latestWorkflowId)),
  )
})

export const appWorkflowVersionsErrorAtom = selectAtom(
  appWorkflowVersionsQueryAtom,
  (query) => query.error,
)

export const appWorkflowVersionsFetchNextPageAtom = selectAtom(
  appWorkflowVersionsQueryAtom,
  (query) => query.fetchNextPage,
)

export const appWorkflowVersionsHasNextPageAtom = selectAtom(
  appWorkflowVersionsQueryAtom,
  (query) => query.hasNextPage,
)

export const appWorkflowVersionsIsFetchingAtom = selectAtom(
  appWorkflowVersionsQueryAtom,
  (query) => query.isFetching,
)

export const appWorkflowVersionsIsFetchingNextPageAtom = selectAtom(
  appWorkflowVersionsQueryAtom,
  (query) => query.isFetchingNextPage,
)

export const appWorkflowVersionsIsLoadingAtom = selectAtom(
  appWorkflowVersionsQueryAtom,
  (query) => query.isLoading,
)

const appEnvironmentsQueryAtom = atomWithQuery((get) => {
  const appId = get(appDeployAppIdAtom)

  return consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
    input: appId
      ? {
          params: {
            app_id: appId,
          },
        }
      : skipToken,
  })
})

const appEnvironmentsAtom = selectAtom(appEnvironmentsQueryAtom, (query) => query.data?.data)

export const appEnvironmentsIsErrorAtom = selectAtom(
  appEnvironmentsQueryAtom,
  (query) => query.isError,
)

export const appEnvironmentsIsLoadingAtom = selectAtom(
  appEnvironmentsQueryAtom,
  (query) => query.isLoading,
)

export const appEnvironmentsIsRetryingAtom = selectAtom(
  appEnvironmentsQueryAtom,
  (query) => query.isError && query.isFetching,
)

export const appEnvironmentsRefetchAtom = selectAtom(
  appEnvironmentsQueryAtom,
  (query) => query.refetch,
)

export const appEnvironmentUsageAtom = atom((get) => {
  const environments = get(appEnvironmentsAtom)
  if (!environments) return

  return {
    total: environments.length,
    used: environments.filter((environment) => environment.in_use).length,
  }
})

export const undeployedAppEnvironmentsAtom = atom((get) =>
  get(appEnvironmentsAtom)?.filter((environment) => environment.in_use === false),
)

const appEnvironmentDeploymentsQueryAtom = atomWithQuery((get) => {
  const appId = get(appDeployAppIdAtom)

  return consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions(
    {
      input: appId
        ? {
            params: {
              app_id: appId,
            },
          }
        : skipToken,
      refetchInterval: (query) => {
        const deployments = query.state.data?.environment_deployments ?? []
        return hasDeploymentsRequiringPolling(deployments)
          ? DEPLOYMENT_STATUS_POLLING_INTERVAL
          : false
      },
    },
  )
})

export const appEnvironmentDeploymentsAtom = selectAtom(
  appEnvironmentDeploymentsQueryAtom,
  (query) => query.data?.environment_deployments,
)

export const appEnvironmentDeploymentsIsLoadingAtom = selectAtom(
  appEnvironmentDeploymentsQueryAtom,
  (query) => query.isLoading,
)

export const appEnvironmentDeploymentsIsErrorAtom = selectAtom(
  appEnvironmentDeploymentsQueryAtom,
  (query) => query.isError,
)

export const appEnvironmentDeploymentsIsRetryingAtom = selectAtom(
  appEnvironmentDeploymentsQueryAtom,
  (query) =>
    query.isError && (query.data?.environment_deployments.length ?? 0) === 0 && query.isFetching,
)

export const appEnvironmentDeploymentsRefetchAtom = selectAtom(
  appEnvironmentDeploymentsQueryAtom,
  (query) => query.refetch,
)
