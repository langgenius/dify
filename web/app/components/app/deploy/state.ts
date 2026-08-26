'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactNode } from 'react'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
  DeploymentStatus,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
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
import { toDeploymentVersion } from './version'

const DEPLOYMENT_STATUS_POLLING_INTERVAL = 3000

type EnvironmentDeploymentActionKind =
  | 'changeVersion'
  | 'deployLatest'
  | 'redeploy'
  | 'retry'
  | 'undeploy'

export type EnvironmentDeploymentAction = {
  disabled: boolean
  kind: EnvironmentDeploymentActionKind
}

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

export function isDeploymentOperationInProgress(deployment?: EnvironmentDeployment) {
  return (
    deployment?.deployment?.latest_operation?.status ===
    DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS
  )
}

export function shouldPollEnvironmentDeployment(deployment?: EnvironmentDeployment) {
  if (isDeploymentOperationInProgress(deployment)) return true

  const status = deployment?.deployment?.status
  return (
    status === DeploymentStatus.DEPLOYMENT_STATUS_STARTING ||
    status === DeploymentStatus.DEPLOYMENT_STATUS_STOPPING
  )
}

export function hasDeploymentsRequiringPolling(deployments: EnvironmentDeployment[]) {
  return deployments.some(shouldPollEnvironmentDeployment)
}

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

function deploymentActions(
  kinds: EnvironmentDeploymentActionKind[],
  disabled = false,
  deployLatestDisabled = false,
): EnvironmentDeploymentAction[] {
  return kinds.map((kind) => ({
    disabled: disabled || (kind === 'deployLatest' && deployLatestDisabled),
    kind,
  }))
}

function isLatestDeployOperationFailed(row: EnvironmentDeployment) {
  const operation = row.deployment?.latest_operation

  return (
    operation?.type === DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_DEPLOY &&
    operation.status === DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED
  )
}

export function getEnvironmentDeploymentActions(
  row: EnvironmentDeployment,
  { deployLatestDisabled = false }: { deployLatestDisabled?: boolean } = {},
): EnvironmentDeploymentAction[] {
  const deployment = row.deployment
  const actions = (kinds: EnvironmentDeploymentActionKind[], disabled = false) =>
    deploymentActions(kinds, disabled, deployLatestDisabled)

  if (!deployment) {
    return actions(['deployLatest', 'changeVersion'])
  }

  const hasCurrentVersion = Boolean(deployment.current_version)
  if (isDeploymentOperationInProgress(row)) {
    return actions(
      hasCurrentVersion
        ? ['changeVersion', 'redeploy', 'undeploy']
        : ['deployLatest', 'changeVersion'],
      true,
    )
  }

  if (isLatestDeployOperationFailed(row)) {
    const hasRetryVersion = Boolean(
      deployment.latest_operation?.target_version ?? deployment.current_version,
    )
    if (!hasRetryVersion) return actions(['changeVersion'])

    return actions(
      hasCurrentVersion ? ['retry', 'changeVersion', 'undeploy'] : ['retry', 'changeVersion'],
    )
  }

  if (deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_UNDEPLOYED) {
    return actions(['deployLatest', 'changeVersion'])
  }

  if (deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_RUNNING) {
    if ((deployment.versions_behind ?? 0) > 0) {
      return actions(['deployLatest', 'changeVersion', 'redeploy', 'undeploy'])
    }

    return actions(['changeVersion', 'redeploy', 'undeploy'])
  }

  if (
    deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_STARTING ||
    deployment.status === DeploymentStatus.DEPLOYMENT_STATUS_STOPPING
  ) {
    return actions(
      hasCurrentVersion
        ? ['changeVersion', 'redeploy', 'undeploy']
        : ['deployLatest', 'changeVersion'],
      true,
    )
  }

  return hasCurrentVersion ? actions(['redeploy', 'undeploy']) : actions(['changeVersion'])
}
